/**
 * Logged engineering/purchasing errors.
 *
 * Reads the whole log, not per-job: the point of recording an error is
 * the pattern across jobs, and the central log page needs every row
 * anyway. A job's own errors are filtered out of that one list, so
 * opening a job costs no extra request.
 */
import { db, currentUserId } from './supabaseClient.js';
import { rowToJobError, jobErrorToRow } from './mappers.js';

const SEL = 'select=id,job_id,department,category,description,found_at_stage,rework_hours,' +
            'caused_delay,scrapped,status,correction,blocker_id,reported_by,reported_at,' +
            'corrected_at,jobs(job_number),profiles:reported_by(full_name)';

function flatten(row){
  return rowToJobError({
    ...row,
    job_number: row.jobs ? row.jobs.job_number : '',
    reported_by_name: row.profiles ? row.profiles.full_name : ''
  });
}

export async function listJobErrors(){
  const rows = await db.select('job_errors', `${SEL}&order=reported_at.desc`);
  return rows.map(flatten);
}

export async function createJobError(error){
  const row = jobErrorToRow(error);
  row.reported_by = currentUserId();
  const [created] = await db.insert('job_errors', row);
  return flatten(created);
}

/**
 * Marking an error corrected. corrected_at is stamped by the DB trigger,
 * so status is the only thing that moves.
 *
 * Returns the bare row, deliberately un-flattened: a PATCH response
 * carries no joined job number or reporter name, so flattening it would
 * hand back a record with those fields blanked. The caller merges the
 * few fields that changed into the copy it already holds.
 */
export async function setJobErrorStatus(errorId, status, correction){
  const patch = { status };
  if(correction !== undefined) patch.correction = correction || null;
  const [updated] = await db.update('job_errors', `id=eq.${errorId}`, patch);
  return updated || null;
}

export async function deleteJobError(errorId){
  await db.remove('job_errors', `id=eq.${errorId}`);
}
