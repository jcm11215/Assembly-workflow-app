/**
 * Jobs repository. Replaces the whole-array `persistJobs()` write with
 * per-record updates guarded by optimistic concurrency.
 *
 * The blob layer's defining bug was that saving one job rewrote every
 * job, so two people editing different jobs silently clobbered each
 * other. Here each write targets one row AND asserts the version it was
 * based on, so a stale write is rejected instead of destroying data.
 */
import { db, DbError, currentUserId } from './supabaseClient.js';
import { rowToJob, jobToRow, rowToComponent } from './mappers.js';
import { listChecklistForJobs } from './checklistRepo.js';

const JOB_COLS = 'id,job_number,customer,description,due_date,priority,stage,' +
                 'percent_complete,assigned_to,last_moved_by,version,created_at,updated_at';

/** Thrown when a write was based on a version that is no longer current. */
export class StaleWriteError extends Error {
  constructor(jobNumber){
    super(`"${jobNumber}" was changed by someone else. Your view has been refreshed -- please redo that change.`);
    this.name = 'StaleWriteError';
    this.isStale = true;
  }
}

/**
 * Load all jobs, hydrated with checklist rows and blueprint-derived
 * fields, in the exact shape the UI already consumes.
 */
export async function listJobs(){
  const rows = await db.select('jobs', `select=${JOB_COLS}&order=due_date.asc.nullslast`);
  if(!rows.length) return [];

  const ids = rows.map(r => r.id);
  const [checklistByJob, bpByJob, names] = await Promise.all([
    listChecklistForJobs(ids),
    loadBlueprintFields(ids),
    loadProfileNames(rows)
  ]);

  return rows.map(r => {
    const bp = bpByJob[r.id] || {};
    return rowToJob({
      ...r,
      assigned_assembler_name: names[r.assigned_to] || '',
      last_moved_by_name: names[r.last_moved_by] || '',
      _bom: bp.bom ?? [],
      _hasImage: !!bp.hasImage,
      _thumbnail: bp.thumbnail ?? null,
      _extractedAt: bp.extractedAt ?? null,
      _blueprintId: bp.id ?? null,
      _blueprintVersion: bp.version ?? null
    }, checklistByJob[r.id] || []);
  });
}

export async function getJob(id){
  const rows = await db.select('jobs', `select=${JOB_COLS}&id=eq.${id}`);
  if(!rows.length) return null;
  const checklist = await listChecklistForJobs([id]);
  return rowToJob(rows[0], checklist[id] || []);
}

export async function findByJobNumber(jobNumber){
  const rows = await db.select('jobs',
    `select=id,job_number,version&job_number=eq.${encodeURIComponent(jobNumber)}`);
  return rows[0] || null;
}

/**
 * Create a job. Surfaces the DB unique constraint as a clear message --
 * this replaces the old client-side `state.jobs.some(...)` check, which
 * could not see other devices' concurrent inserts.
 */
export async function createJob(job){
  const row = jobToRow(job);
  row.created_by = currentUserId();
  try {
    const [created] = await db.insert('jobs', row);
    return rowToJob(created, []);
  } catch (e) {
    if(e instanceof DbError && e.isConflict){
      throw new DbError(`Job number "${job.jobNumber}" already exists.`, e.status, e.code);
    }
    throw e;
  }
}

/**
 * Update job fields with optimistic concurrency.
 * The filter includes `version=eq.<expected>`; if another device has
 * written since, zero rows match and we raise StaleWriteError rather
 * than overwriting their change.
 */
export async function updateJob(job, patch){
  const expected = job.version ?? 1;
  const body = patch ? { ...patch } : jobToRow(job);
  const filter = `id=eq.${job.id}&version=eq.${expected}`;
  const updated = await db.update('jobs', filter, body);
  if(!updated || !updated.length) throw new StaleWriteError(job.jobNumber);
  return updated[0];
}

/**
 * Stage change. The server trigger enforces the checklist gate and the
 * no-skip rule, so an illegal move is rejected even if a client somehow
 * bypasses validateStageTransition().
 */
export async function moveStage(job, toStage, percentComplete){
  const patch = { stage: toStage, last_moved_by: currentUserId() };
  if(percentComplete != null) patch.percent_complete = percentComplete;
  return updateJob(job, patch);
}

export async function deleteJob(id){
  await db.remove('jobs', `id=eq.${id}`);
}

/* ---------------- internal helpers ---------------- */

/** Pulls approved blueprint data so job.spec/billOfMaterials stay populated. */
async function loadBlueprintFields(jobIds){
  if(!jobIds.length) return {};
  const inList = `(${jobIds.join(',')})`;
  const bps = await db.select('blueprints',
    `select=id,job_id,version,storage_path,thumbnail_base64,extracted_at&job_id=in.${inList}` +
    `&order=version.desc`);
  if(!bps.length) return {};

  // Newest version per job -- no more approved/pending distinction, so
  // this is just the latest scan, full stop.
  const newest = {};
  bps.forEach(b => { if(!newest[b.job_id]) newest[b.job_id] = b; });

  const bpIds = Object.values(newest).map(b => b.id);
  const comps = bpIds.length
    ? await db.select('blueprint_components',
        `select=id,blueprint_id,item,specification,quantity,stage,installation_location,` +
        `source_page,source_callout,extraction_method,confidence,sort_order` +
        `&blueprint_id=in.(${bpIds.join(',')})&order=sort_order.asc`)
    : [];

  const byBp = {};
  comps.forEach(c => { (byBp[c.blueprint_id] = byBp[c.blueprint_id] || []).push(c); });

  const out = {};
  Object.entries(newest).forEach(([jobId, b]) => {
    out[jobId] = {
      id: b.id,
      version: b.version ?? null,
      bom: (byBp[b.id] || []).map(rowToComponent),
      hasImage: !!b.storage_path,
      thumbnail: b.thumbnail_base64 || null,
      extractedAt: b.extracted_at
    };
  });
  return out;
}

/** Resolves assigned_to / last_moved_by uuids to display names. */
async function loadProfileNames(rows){
  const ids = [...new Set(rows.flatMap(r => [r.assigned_to, r.last_moved_by]).filter(Boolean))];
  if(!ids.length) return {};
  const profiles = await db.select('profiles', `select=id,full_name&id=in.(${ids.join(',')})`);
  const map = {};
  profiles.forEach(p => { map[p.id] = p.full_name; });
  return map;
}
