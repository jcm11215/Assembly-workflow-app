/**
 * Checklist repository.
 *
 * This is the highest-frequency write in the app and was the worst
 * offender under blob storage: ticking one box rewrote the entire jobs
 * array. Now each item is its own row, so two assemblers working
 * different items on the same job never contend.
 *
 * The UI still reads `job.checklist` as a {"step-item": true} map --
 * toggleItem() writes a row and the caller patches that map locally,
 * so no UI code changes.
 */
import { db } from './supabaseClient.js';
import { parseChecklistKey } from './mappers.js';

/** Fetch checklist rows for many jobs at once, grouped by job id. */
export async function listChecklistForJobs(jobIds){
  if(!jobIds || !jobIds.length) return {};
  const rows = await db.select('job_checklist',
    `select=job_id,step_index,item_index,done,done_at&job_id=in.(${jobIds.join(',')})&done=is.true`);
  const byJob = {};
  rows.forEach(r => { (byJob[r.job_id] = byJob[r.job_id] || []).push(r); });
  return byJob;
}

export async function listChecklist(jobId){
  const byJob = await listChecklistForJobs([jobId]);
  return byJob[jobId] || [];
}

/**
 * Set one checklist item. Upsert on (job_id, step_index, item_index) so
 * repeated toggles are idempotent and concurrent writers to *different*
 * items never conflict. done_by/done_at are stamped server-side.
 */
export async function setItem(jobId, key, done){
  const parsed = parseChecklistKey(key);
  if(!parsed) throw new Error(`Malformed checklist key: ${key}`);
  await db.upsert('job_checklist',
    { job_id: jobId, ...parsed, done: !!done },
    'job_id,step_index,item_index',
    { returning: false });
  return true;
}

/** Bulk-set (used by the migration adapter when importing a legacy map). */
export async function setMany(jobId, checklistMap){
  const rows = Object.entries(checklistMap || {})
    .map(([k, v]) => {
      const p = parseChecklistKey(k);
      return p ? { job_id: jobId, ...p, done: !!v } : null;
    })
    .filter(Boolean);
  if(!rows.length) return 0;
  await db.upsert('job_checklist', rows, 'job_id,step_index,item_index', { returning: false });
  return rows.length;
}

/** How many items in the given procedure steps are done -- for gate checks. */
export async function countDone(jobId, stepIndexes){
  if(!stepIndexes || !stepIndexes.length) return 0;
  const rows = await db.select('job_checklist',
    `select=step_index&job_id=eq.${jobId}&done=is.true&step_index=in.(${stepIndexes.join(',')})`);
  return rows.length;
}

export async function clearForJob(jobId){
  await db.remove('job_checklist', `job_id=eq.${jobId}`);
}
