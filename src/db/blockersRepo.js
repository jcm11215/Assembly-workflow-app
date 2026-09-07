/**
 * Blockers repository. Individual inserts/updates replace the
 * whole-array persistBlockers() write.
 */
import { db, currentUserId } from './supabaseClient.js';
import { rowToBlocker, blockerToRow } from './mappers.js';

const SEL = 'select=id,job_id,issue,department,severity,status,reported_at,resolved_at,' +
            'reported_by,jobs(job_number)';

function flatten(row){
  return rowToBlocker({
    ...row,
    job_number: row.jobs ? row.jobs.job_number : ''
  });
}

export async function listBlockers(){
  const rows = await db.select('blockers', `${SEL}&order=reported_at.desc`);
  return rows.map(flatten);
}

/** `blocker.jobNumber` comes from the UI; resolve it to a job_id here. */
export async function createBlocker(blocker){
  const jobId = blocker.jobId || await resolveJobId(blocker.jobNumber);
  if(!jobId) throw new Error(`Unknown job "${blocker.jobNumber}"`);
  const row = blockerToRow(blocker, jobId);
  row.reported_by = currentUserId();
  const [created] = await db.insert('blockers', row);
  return flatten({ ...created, jobs: { job_number: blocker.jobNumber } });
}

/** Status change. resolved_by/resolved_at are stamped by a DB trigger. */
export async function setStatus(blockerId, status){
  const [updated] = await db.update('blockers', `id=eq.${blockerId}`, { status });
  return updated;
}

export async function deleteBlocker(blockerId){
  await db.remove('blockers', `id=eq.${blockerId}`);
}

async function resolveJobId(jobNumber){
  if(!jobNumber) return null;
  const rows = await db.select('jobs', `select=id&job_number=eq.${encodeURIComponent(jobNumber)}`);
  return rows.length ? rows[0].id : null;
}
