/**
 * MIGRATION ADAPTER.
 *
 * Presents the exact function names and signatures the UI already calls
 * -- loadAll, persistJobs, persistBlockers, persistNotes,
 * reloadFromStorage, logActivity -- but routes them to the relational
 * repositories instead of app_data blobs.
 *
 *      old UI  ->  this adapter  ->  relational tables
 *
 * The key behavioural change is hidden here: persistJobs() used to
 * rewrite every job. It now diffs local state against a last-known
 * snapshot and writes ONLY the records that actually changed, each with
 * an optimistic-concurrency guard. Callers do not change.
 *
 * Phase 7 (Realtime) removes the polling in reloadFromStorage(); Phase 4
 * lets UI modules call the repos directly and retires this file.
 */
import { state } from '../state/store.js';
import { showToast } from '../ui/components/toast.js';
import { requestRender } from '../app/bus.js';
import { supabaseReady, db } from './supabaseClient.js';
import { tracked, recordStaleConflict, recordFailure } from './telemetry.js';
import { USE_RELATIONAL_READS, USE_LEGACY_FALLBACK, getMode, MODE } from './cutover.js';

import * as jobsRepo from './jobsRepo.js';
import * as blockersRepo from './blockersRepo.js';
import * as notesRepo from './notesRepo.js';
import * as checklistRepo from './checklistRepo.js';
import * as activityRepo from './activityRepo.js';
import * as blueprintsRepo from './blueprintsRepo.js';

// Namespace re-exports removed in Phase 11: every consumer imports each
// repo directly from its own file (db/jobsRepo.js etc.); nothing imported
// them from here.
export { StaleWriteError } from './jobsRepo.js';

/* ------------------------------------------------------------------ *
 * Snapshot: what we believe the server holds. Diffing against this is
 * what turns "save everything" into "save what changed".
 * ------------------------------------------------------------------ */
let snapshot = { jobs: new Map(), blockers: new Map(), notes: new Map() };

function snap(list){
  const m = new Map();
  (list || []).forEach(x => m.set(x.id, JSON.stringify(x)));
  return m;
}
function changedRecords(list, prev){
  return (list || []).filter(x => prev.get(x.id) !== JSON.stringify(x));
}

/* ------------------------------------------------------------------ *
 * Load
 * ------------------------------------------------------------------ */
export async function loadAll(){
  if(!supabaseReady()){
    state.jobs = []; state.blockers = []; state.notes = [];
    return;
  }

  // Which store the UI is served from is governed by the cutover mode.
  // Writes always go relational, so legacy can never drift forward.
  if(!USE_RELATIONAL_READS()){
    const legacy = await loadLegacyBlobs();
    if(legacy){
      state.jobs = legacy.jobs; state.blockers = legacy.blockers; state.notes = legacy.notes;
      snapshot = { jobs: snap(legacy.jobs), blockers: snap(legacy.blockers), notes: snap(legacy.notes) };
      return;
    }
    // No legacy blob (already archived) -- fall through to relational.
  }

  const [jobs, blockers, notes] = await Promise.all([
    tracked('jobs', 'read', () => jobsRepo.listJobs()),
    tracked('blockers', 'read', () => blockersRepo.listBlockers()),
    tracked('notes', 'read', () => notesRepo.listNotes())
  ]);
  state.jobs = jobs;
  state.blockers = blockers;
  state.notes = notes;
  snapshot = { jobs: snap(jobs), blockers: snap(blockers), notes: snap(notes) };
}

/**
 * Read-only access to the legacy blob, used while reads have not been
 * cut over. Returns null once app_data is gone.
 */
async function loadLegacyBlobs(){
  if(!USE_LEGACY_FALLBACK()) return null;
  try {
    const rows = await db.select('app_data', 'select=key,value&key=in.(jobs,blockers,notes)');
    if(!rows.length) return null;
    const byKey = {};
    rows.forEach(r => { byKey[r.key] = Array.isArray(r.value) ? r.value : []; });
    if(!byKey.jobs) return null;
    return { jobs: byKey.jobs, blockers: byKey.blockers || [], notes: byKey.notes || [] };
  } catch { return null; }
}

/* ------------------------------------------------------------------ *
 * Persist -- same names the UI already calls
 * ------------------------------------------------------------------ */

/**
 * Writes only jobs whose content changed, one row each, version-guarded.
 * On a stale write the local copy is refreshed from the server and the
 * person is told plainly -- far better than the blob layer's behaviour of
 * silently discarding someone else's edit.
 */
export async function persistJobs(){
  if(!supabaseReady()) return false;
  const dirty = changedRecords(state.jobs, snapshot.jobs);

  let ok = true;
  for(const job of dirty){
    try {
      const prevJson = snapshot.jobs.get(job.id);
      const prev = prevJson ? JSON.parse(prevJson) : null;

      if(!prev){
        const created = await tracked('jobs', 'write', () => jobsRepo.createJob(job));
        job.id = created.id;
        job.version = created.version;
      } else {
        await syncChecklist(job, prev);
        const updated = await tracked('jobs', 'write',
          () => jobsRepo.updateJob(job, jobsRowPatch(job)));
        job.version = updated.version;
        job.updatedAt = updated.updated_at;
      }
      snapshot.jobs.set(job.id, JSON.stringify(job));
    } catch (e) {
      ok = false;
      if(e && e.isStale){
        showToast(e.message, 6000);
        await loadAll();
        requestRender();
        return false;
      }
      console.error('persistJobs failed', job.jobNumber, e);
      showToast(`Could not save ${job.jobNumber}: ${e.message}`, 6000);
    }
  }
  // Deletions: present in snapshot but gone from state. Mirrors
  // persistBlockers()'s handling below -- jobs never had this until this
  // fix, meaning a "deleted" job previously only disappeared from the
  // local browser view and silently reappeared on the next full reload
  // from another device.
  for(const id of [...snapshot.jobs.keys()]){
    if(!state.jobs.some(j => j.id === id)){
      try { await tracked('jobs', 'write', () => jobsRepo.deleteJob(id)); snapshot.jobs.delete(id); }
      catch (e) { console.error('job delete failed', e); ok = false; }
    }
  }
  return ok;
}

function jobsRowPatch(job){
  return {
    customer: job.customer || '',
    description: job.description || '',
    due_date: job.dueDate || null,
    priority: job.priority || 'Medium',
    stage: job.assemblyStatus || 'ready',
    percent_complete: Math.min(100, Math.max(0, Math.round(Number(job.percentComplete) || 0)))
  };
}

/** Diff the checklist map and write only the items that flipped. */
async function syncChecklist(job, prev){
  const now = job.checklist || {};
  const before = (prev && prev.checklist) || {};
  const keys = new Set([...Object.keys(now), ...Object.keys(before)]);
  const flipped = [...keys].filter(k => !!now[k] !== !!before[k]);
  for(const k of flipped){
    await tracked('job_checklist', 'write', () => checklistRepo.setItem(job.id, k, !!now[k]));
  }
}

export async function persistBlockers(){
  if(!supabaseReady()) return false;
  const dirty = changedRecords(state.blockers, snapshot.blockers);
  for(const b of dirty){
    try {
      if(!snapshot.blockers.has(b.id)){
        const created = await blockersRepo.createBlocker(b);
        b.id = created.id;
      } else {
        const prev = JSON.parse(snapshot.blockers.get(b.id));
        if(prev.status !== b.status) await blockersRepo.setStatus(b.id, b.status);
      }
      snapshot.blockers.set(b.id, JSON.stringify(b));
    } catch (e) {
      console.error('persistBlockers failed', e);
      showToast(`Could not save blocker: ${e.message}`, 6000);
      return false;
    }
  }
  // Deletions: present in snapshot but gone from state.
  for(const id of [...snapshot.blockers.keys()]){
    if(!state.blockers.some(b => b.id === id)){
      try { await blockersRepo.deleteBlocker(id); snapshot.blockers.delete(id); }
      catch (e) { console.error('blocker delete failed', e); }
    }
  }
  return true;
}

export async function persistNotes(){
  if(!supabaseReady()) return false;
  const dirty = changedRecords(state.notes, snapshot.notes);
  const created = dirty.filter(n => !snapshot.notes.has(n.id));
  if(!created.length) return true;
  try {
    const rows = await notesRepo.createNotes(created);
    rows.forEach((row, i) => {
      created[i].id = row.id;
      snapshot.notes.set(row.id, JSON.stringify(created[i]));
    });
    return true;
  } catch (e) {
    console.error('persistNotes failed', e);
    showToast(`Could not save note: ${e.message}`, 6000);
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Sync
 * ------------------------------------------------------------------ */
export function isFormActive(){
  const root = document.getElementById('modalRoot');
  const modalOpen = !!(root && root.innerHTML.trim());
  const a = document.activeElement;
  const typing = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
  return modalOpen || typing;
}

export async function reloadFromStorage(manual){
  if(!supabaseReady()) return;
  if(isFormActive()){
    if(manual) showToast('Finish editing, then sync');
    return;
  }
  const btn = manual ? document.getElementById('refreshBtn') : null;
  if(btn) btn.classList.add('spinning');
  try {
    await loadAll();
    requestRender();
    if(manual) showToast('Synced latest data');
  } catch (e) {
    console.error('sync failed', e);
    if(manual) showToast(`Sync failed: ${e.message}`, 5000);
  } finally {
    if(btn) setTimeout(() => btn.classList.remove('spinning'), 700);
  }
}

/* ------------------------------------------------------------------ *
 * Activity + blueprint images -- same names as before
 * ------------------------------------------------------------------ */
export const logActivity = (action, detail, entity) => activityRepo.log(action, detail, entity);
export const fetchActivityLog = (limit) => activityRepo.listActivity(limit);

export async function saveBlueprintImage(jobId, base64){
  const job = state.jobs.find(j => j.id === jobId);
  if(!job) return false;
  try {
    await blueprintsRepo.saveExtraction(jobId, {
      spec: job.spec ?? null,
      validation: job.validation ?? null,
      components: job.billOfMaterials || [],
      imageBase64: base64
    });
    return true;
  } catch (e) {
    console.error('saveBlueprintImage failed', e);
    return false;
  }
}

export async function fetchBlueprintImage(jobId){
  try { return await blueprintsRepo.getImage(jobId); }
  catch { return null; }
}

/* ------------------------------------------------------------------ *
 * storageGet()/storageSet() -- the Phase 3 migration safety net that
 * threw a clear error for any leftover blob-API call -- were removed
 * in Phase 11's dead-code sweep after confirming zero remaining
 * callers anywhere in the codebase. The migration they guarded against
 * is confirmed complete.
 * ------------------------------------------------------------------ */
export function flushPendingSaves(){ /* no-op: writes are immediate now */ }

/* ------------------------------------------------------------------ *
 * Phase 4 surface
 * ------------------------------------------------------------------ */
export { getMode, setMode, MODE, describeMode, revertToLegacy } from './cutover.js';
export { getStats as getRepoStats, resetStats as resetRepoStats } from './telemetry.js';
export { runFullParityCheck } from './parity.js';
export { simulateCutover } from './dryRun.js';
