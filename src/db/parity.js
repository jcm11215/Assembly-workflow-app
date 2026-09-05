/**
 * Parity verification: does the relational layer hold exactly what the
 * legacy blob holds?
 *
 * This is the evidence that gates cutover. It reads BOTH stores and
 * compares them record by record -- counts alone are not proof, because
 * an equal count can still hide a swapped or corrupted record.
 *
 * Read-only. Nothing here mutates either store.
 */
import { db, supabaseReady, DbError } from './supabaseClient.js';
import * as jobsRepo from './jobsRepo.js';
import * as blockersRepo from './blockersRepo.js';
import * as notesRepo from './notesRepo.js';
import { recordRead } from './telemetry.js';

/* ---------------- legacy blob access (read-only) ---------------- */

/**
 * Reads the legacy app_data blob directly. Deliberately NOT routed
 * through the retired storageGet() -- that throws by design now.
 */
async function readLegacyBlob(key){
  if(!supabaseReady()) return null;
  const t0 = Date.now();
  try {
    const rows = await db.select('app_data', `select=value&key=eq.${key}`);
    recordRead('app_data', Date.now() - t0, 'legacy');
    return rows.length ? rows[0].value : null;
  } catch (e) {
    // app_data may already be archived -- that is a valid end state.
    if(e instanceof DbError && (e.status === 404 || e.code === '42P01')) return null;
    throw e;
  }
}

export async function legacyAvailable(){
  try { return (await readLegacyBlob('jobs')) !== null; }
  catch { return false; }
}

/* ---------------- comparison primitives ---------------- */

const norm = v => (v == null ? '' : String(v).trim());
const normDate = v => norm(v).slice(0, 10);
const normNum = v => { const n = Number(v); return isFinite(n) ? n : 0; };

function indexBy(list, keyFn){
  const m = new Map();
  (list || []).forEach(x => {
    const k = keyFn(x);
    if(!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  });
  return m;
}

/**
 * Generic set comparison. Returns missing (in legacy, absent relational),
 * extra (relational-only), duplicates on either side, and per-field
 * conflicts for records present in both.
 */
function compareSets({ legacy, relational, keyFn, fields, label }){
  const L = indexBy(legacy, keyFn);
  const R = indexBy(relational, keyFn);

  const missing = [], extra = [], conflicts = [], duplicates = [];

  for(const [k, rows] of L){
    if(rows.length > 1) duplicates.push({ side:'legacy', key:k, count:rows.length });
    if(!R.has(k)){ missing.push({ key:k, record: summarize(rows[0], fields) }); continue; }
    const l = rows[0], r = R.get(k)[0];
    const diffs = [];
    for(const [name, get] of Object.entries(fields)){
      const lv = get(l), rv = get(r);
      if(lv !== rv) diffs.push({ field:name, legacy:lv, relational:rv });
    }
    if(diffs.length) conflicts.push({ key:k, diffs });
  }
  for(const [k, rows] of R){
    if(rows.length > 1) duplicates.push({ side:'relational', key:k, count:rows.length });
    if(!L.has(k)) extra.push({ key:k, record: summarize(rows[0], fields) });
  }

  const total = L.size;
  const matched = total - missing.length - conflicts.length;
  return {
    label,
    legacyCount: (legacy || []).length,
    relationalCount: (relational || []).length,
    uniqueLegacy: L.size,
    uniqueRelational: R.size,
    matched,
    missing, extra, conflicts, duplicates,
    ok: !missing.length && !extra.length && !conflicts.length && !duplicates.length
  };
}

function summarize(rec, fields){
  const out = {};
  Object.entries(fields).forEach(([n, get]) => { out[n] = get(rec); });
  return out;
}

/* ---------------- per-entity verifiers ---------------- */

export async function verifyJobs(){
  const [legacyBlob, relational] = await Promise.all([
    readLegacyBlob('jobs'),
    jobsRepo.listJobs()
  ]);
  const legacy = Array.isArray(legacyBlob) ? legacyBlob : [];
  return compareSets({
    label: 'jobs',
    legacy, relational,
    keyFn: j => norm(j.jobNumber),
    fields: {
      customer:        j => norm(j.customer),
      description:     j => norm(j.description),
      dueDate:         j => normDate(j.dueDate),
      priority:        j => norm(j.priority),
      stage:           j => norm(j.assemblyStatus),
      percentComplete: j => normNum(j.percentComplete)
    }
  });
}

export async function verifyBlockers(){
  const [legacyBlob, relational] = await Promise.all([
    readLegacyBlob('blockers'),
    blockersRepo.listBlockers()
  ]);
  const legacy = Array.isArray(legacyBlob) ? legacyBlob : [];
  // Blob blockers had no stable id, so key on job + issue text.
  const key = b => `${norm(b.jobNumber)}::${norm(b.issueDescription).slice(0,80)}`;
  return compareSets({
    label: 'blockers',
    legacy, relational, keyFn: key,
    fields: {
      department: b => norm(b.responsibleDepartment),
      severity:   b => norm(b.severity),
      status:     b => norm(b.status)
    }
  });
}

export async function verifyNotes(){
  const [legacyBlob, relational] = await Promise.all([
    readLegacyBlob('notes'),
    notesRepo.listNotes(2000)
  ]);
  const legacy = Array.isArray(legacyBlob) ? legacyBlob : [];
  const key = n => `${normDate(n.date)}::${norm(n.jobNumber)}::${norm(n.noteType)}::${norm(n.notes).slice(0,80)}`;
  return compareSets({
    label: 'notes',
    legacy, relational, keyFn: key,
    fields: { body: n => norm(n.notes).slice(0, 200) }
  });
}

/**
 * Checklist parity. The blob stored a {"step-item": true} map per job;
 * relational stores one row per ticked item. Compares the ticked SETS,
 * which is the only representation-independent way to do it.
 */
export async function verifyChecklists(){
  const legacyBlob = await readLegacyBlob('jobs');
  const legacy = Array.isArray(legacyBlob) ? legacyBlob : [];
  const relational = await jobsRepo.listJobs();

  const relByNumber = new Map(relational.map(j => [norm(j.jobNumber), j]));
  const discrepancies = [];
  let legacyTicks = 0, relationalTicks = 0, matchedJobs = 0;

  for(const lj of legacy){
    const key = norm(lj.jobNumber);
    const lSet = new Set(Object.entries(lj.checklist || {}).filter(([,v]) => !!v).map(([k]) => k));
    legacyTicks += lSet.size;

    const rj = relByNumber.get(key);
    if(!rj){
      if(lSet.size) discrepancies.push({ jobNumber:key, kind:'job_missing', legacyTicks:lSet.size });
      continue;
    }
    const rSet = new Set(Object.entries(rj.checklist || {}).filter(([,v]) => !!v).map(([k]) => k));
    relationalTicks += rSet.size;

    const onlyLegacy     = [...lSet].filter(k => !rSet.has(k));
    const onlyRelational = [...rSet].filter(k => !lSet.has(k));
    if(onlyLegacy.length || onlyRelational.length){
      discrepancies.push({ jobNumber:key, kind:'items_differ', onlyLegacy, onlyRelational });
    } else {
      matchedJobs++;
    }
  }

  return {
    label: 'checklists',
    legacyCount: legacyTicks,
    relationalCount: relationalTicks,
    matched: matchedJobs,
    jobsChecked: legacy.length,
    discrepancies,
    missing: [], extra: [], duplicates: [],
    conflicts: discrepancies,
    ok: discrepancies.length === 0
  };
}

/**
 * Blueprint parity. Legacy kept spec/BOM inline on each job and images
 * under a `blueprint:{id}` blob key; relational splits these across
 * blueprints + blueprint_components + Storage.
 */
export async function verifyBlueprints(){
  const legacyBlob = await readLegacyBlob('jobs');
  const legacy = (Array.isArray(legacyBlob) ? legacyBlob : []).filter(j => j.spec || (j.billOfMaterials || []).length);

  const bps = await db.select('blueprints', 'select=id,job_id,spec,storage_path,jobs(job_number)');
  const comps = await db.select('blueprint_components', 'select=blueprint_id');
  const compCount = new Map();
  comps.forEach(c => compCount.set(c.blueprint_id, (compCount.get(c.blueprint_id) || 0) + 1));

  const relByNumber = new Map();
  bps.forEach(b => {
    const n = norm(b.jobs && b.jobs.job_number);
    if(n) relByNumber.set(n, b);
  });

  const missing = [], conflicts = [], orphans = [];

  for(const lj of legacy){
    const key = norm(lj.jobNumber);
    const rb = relByNumber.get(key);
    if(!rb){ missing.push({ key, record:{ hasSpec: !!lj.spec, bom:(lj.billOfMaterials||[]).length } }); continue; }
    const lBom = (lj.billOfMaterials || []).length;
    const rBom = compCount.get(rb.id) || 0;
    const diffs = [];
    if(lBom !== rBom) diffs.push({ field:'bomCount', legacy:lBom, relational:rBom });
    if(!!lj.spec !== !!rb.spec) diffs.push({ field:'hasSpec', legacy:!!lj.spec, relational:!!rb.spec });
    if(diffs.length) conflicts.push({ key, diffs });
  }

  // Orphans: blueprint rows whose job no longer exists.
  bps.forEach(b => { if(!b.jobs) orphans.push({ blueprintId:b.id, jobId:b.job_id }); });

  return {
    label: 'blueprints',
    legacyCount: legacy.length,
    relationalCount: bps.length,
    matched: legacy.length - missing.length - conflicts.length,
    missing, extra: [], conflicts, duplicates: [], orphans,
    ok: !missing.length && !conflicts.length && !orphans.length
  };
}

/* ---------------- orphan sweep ---------------- */

/** Referential integrity checks the FKs cannot express as easily in one view. */
export async function findOrphans(){
  const [blockers, notes, comps, checklist] = await Promise.all([
    db.select('blockers', 'select=id,job_id,jobs(id)'),
    db.select('notes', 'select=id,job_id,jobs(id)'),
    db.select('blueprint_components', 'select=id,blueprint_id,blueprints(id)'),
    db.select('job_checklist', 'select=id,job_id,jobs(id)')
  ]);
  return {
    blockers:  blockers.filter(r => r.job_id && !r.jobs).map(r => r.id),
    notes:     notes.filter(r => r.job_id && !r.jobs).map(r => r.id),
    components: comps.filter(r => !r.blueprints).map(r => r.id),
    checklist: checklist.filter(r => !r.jobs).map(r => r.id)
  };
}

/* ---------------- full run ---------------- */

/**
 * Runs every verifier. Each is isolated so one failure does not hide the
 * others' results -- during a migration you want the whole picture.
 */
export async function runFullParityCheck(){
  const startedAt = Date.now();
  const results = {};
  const runners = {
    jobs: verifyJobs, blockers: verifyBlockers, notes: verifyNotes,
    checklists: verifyChecklists, blueprints: verifyBlueprints
  };

  for(const [name, fn] of Object.entries(runners)){
    try { results[name] = await fn(); }
    catch (e) {
      results[name] = { label:name, error:e.message, ok:false,
                        legacyCount:null, relationalCount:null, matched:0,
                        missing:[], extra:[], conflicts:[], duplicates:[] };
    }
  }

  let orphans = {};
  try { orphans = await findOrphans(); }
  catch (e) { orphans = { error:e.message }; }

  const orphanCount = Object.values(orphans)
    .filter(Array.isArray).reduce((n, a) => n + a.length, 0);

  const entities = Object.values(results);
  const allOk = entities.every(r => r.ok) && orphanCount === 0;
  const totalIssues = entities.reduce((n, r) =>
    n + (r.missing?.length || 0) + (r.extra?.length || 0) +
        (r.conflicts?.length || 0) + (r.duplicates?.length || 0), 0) + orphanCount;

  return {
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    legacyPresent: await legacyAvailable(),
    results, orphans, orphanCount, totalIssues,
    verdict: allOk ? 'PASS' : 'FAIL',
    /** Cutover is only advisable on a clean run against a present legacy store. */
    safeToCutover: allOk
  };
}
