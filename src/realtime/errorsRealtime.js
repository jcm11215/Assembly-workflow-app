/**
 * Realtime sync for logged errors. Same shape as blockersRealtime: no
 * version column, so patch-by-id is a straight replace, which matches
 * how errors are actually used (logged once, later marked corrected --
 * not edited field-by-field by two people at once).
 */
import { subscribeTable } from './realtimeClient.js';
import { state } from '../state/store.js';
import { rowToJobError } from '../db/mappers.js';
import { requestRender } from '../app/bus.js';

let unsubscribe = null;

/** The bare row has job_id but not the joined job_number the UI shows --
 *  resolve it from jobs already held locally. */
function jobNumberFor(jobId){
  const job = state.jobs.find(j => j.id === jobId);
  return job ? job.jobNumber : '';
}

export function handleJobErrorEvent({ type, record, oldRecord }){
  if(type === 'DELETE'){
    const id = (oldRecord && oldRecord.id) || (record && record.id);
    if(!id) return;
    const before = state.jobErrors.length;
    state.jobErrors = state.jobErrors.filter(e => e.id !== id);
    if(state.jobErrors.length !== before) requestRender();
    return;
  }
  if(!record) return;
  const idx = state.jobErrors.findIndex(e => e.id === record.id);
  const mapped = rowToJobError({ ...record, job_number: jobNumberFor(record.job_id) });
  // The reporter's name only ever arrives with the joined read, so keep
  // whatever we already had rather than blanking it on an update.
  if(idx === -1) state.jobErrors.unshift(mapped);
  else state.jobErrors[idx] = { ...mapped, reportedBy: mapped.reportedBy || state.jobErrors[idx].reportedBy };
  requestRender();
}

export function startErrorsRealtime(){
  stopErrorsRealtime();
  unsubscribe = subscribeTable('job_errors', handleJobErrorEvent);
}

export function stopErrorsRealtime(){
  if(unsubscribe){ unsubscribe(); unsubscribe = null; }
}
