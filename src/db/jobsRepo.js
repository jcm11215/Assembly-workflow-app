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
import { rowToJob, jobToRow } from './mappers.js';
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
      _spec: bp.spec ?? null,
      _validation: bp.validation ?? null,
      _geometry: bp.geometry ?? null,
      _bom: bp.bom ?? [],
      _hasImage: !!bp.hasImage,
      _extractedAt: bp.extractedAt ?? null,
      _blueprintId: bp.id ?? null,
      _blueprintVersion: bp.version ?? null,
      _blueprintStatus: bp.status ?? null,
      _blueprintConfidence: bp.confidence ?? null,
      _blueprintReviewUrgency: bp.reviewUrgency ?? null,
      _blueprintAutoApproved: bp.autoApproved ?? false
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
    `select=id,job_id,version,spec,validation,storage_path,extracted_at,status,confidence,review_urgency,auto_approved&job_id=in.${inList}` +
    `&order=version.desc`);
  if(!bps.length) return {};

  // Keep the newest APPROVED version per job if one exists, else the
  // newest version overall -- same rule blueprintsRepo.getForJob() uses,
  // kept in sync here since listJobs() bypasses that per-job call for
  // performance (one batched query instead of N).
  const newestApproved = {}, newestAny = {};
  bps.forEach(b => {
    if(!newestAny[b.job_id]) newestAny[b.job_id] = b;
    if(b.status === 'approved' && !newestApproved[b.job_id]) newestApproved[b.job_id] = b;
  });
  const newest = { ...newestAny, ...newestApproved };

  const bpIds = Object.values(newest).map(b => b.id);
  const comps = bpIds.length
    ? await db.select('blueprint_components',
        `select=blueprint_id,item,specification,quantity,stage,installation_location,` +
        `source_page,source_callout,extraction_method,confidence` +
        `&blueprint_id=in.(${bpIds.join(',')})`)
    : [];

  const byBp = {};
  comps.forEach(c => { (byBp[c.blueprint_id] = byBp[c.blueprint_id] || []).push(c); });

  const out = {};
  Object.entries(newest).forEach(([jobId, b]) => {
    out[jobId] = {
      id: b.id,
      version: b.version ?? null,
      spec: b.spec ?? null,
      validation: b.validation ?? null,
      geometry: b.spec ? specToGeometry(b.spec) : null,
      bom: (byBp[b.id] || []).map(c => ({
        item: c.item,
        specification: c.specification || '',
        quantity: c.quantity ?? null,
        stage: c.stage || 'other',
        installation_location: c.installation_location || 'unknown',
        source_page: c.source_page ?? null,
        source_callout: c.source_callout || '',
        extraction_method: c.extraction_method || 'inferred',
        confidence: c.confidence != null ? Number(c.confidence) : null
      })),
      hasImage: !!b.storage_path,
      extractedAt: b.extracted_at,
      status: b.status,
      confidence: b.confidence != null ? Number(b.confidence) : null,
      reviewUrgency: b.review_urgency || null,
      autoApproved: !!b.auto_approved
    };
  });
  return out;
}

/** Mirrors specToLegacyGeometry() without importing the 3D module. */
function specToGeometry(spec){
  if(!spec) return null;
  const d = x => (x && x.status === 'ok' && x.normalized_in != null) ? x.normalized_in : null;
  const o = spec.overall || {}, s = spec.screw || {}, t = spec.trough || {};
  const L = d(o.overall_length);
  return {
    diameterIn: d(s.screw_diameter) || d(t.trough_width),
    lengthFt: L != null ? L / 12 : null,
    inclineDeg: d(o.incline_angle) != null ? o.incline_angle.value : null,
    hangerCount: (spec.hangers && spec.hangers.count != null) ? Number(spec.hangers.count) : null,
    shaftless: !!s.shaftless
  };
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
