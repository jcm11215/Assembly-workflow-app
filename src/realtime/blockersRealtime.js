/**
 * Realtime sync for blockers. No version column on this table, so
 * patch-by-id is a straight replace -- last write wins, which matches
 * blockers' actual usage pattern (status changes, not concurrent field
 * edits to the same record).
 */
import { subscribeTable } from './realtimeClient.js';
import { state } from '../state/store.js';
import { rowToBlocker } from '../db/mappers.js';
import { requestRender } from '../app/bus.js';

let unsubscribe = null;

/** The bare table row has job_id but not the joined job_number the UI
 *  expects -- resolve it from jobs already held locally. */
function jobNumberFor(jobId){
  const job = state.jobs.find(j => j.id === jobId);
  return job ? job.jobNumber : '';
}

export function handleBlockerEvent({ type, record, oldRecord }){
  if(type === 'DELETE'){
    const id = (oldRecord && oldRecord.id) || (record && record.id);
    if(!id) return;
    const before = state.blockers.length;
    state.blockers = state.blockers.filter(b => b.id !== id);
    if(state.blockers.length !== before) requestRender();
    return;
  }
  if(!record) return;
  const mapped = rowToBlocker({ ...record, job_number: jobNumberFor(record.job_id) });
  const idx = state.blockers.findIndex(b => b.id === mapped.id);
  if(idx === -1) state.blockers.push(mapped);
  else state.blockers[idx] = mapped;
  requestRender();
}

export function startBlockersRealtime(){
  stopBlockersRealtime();
  unsubscribe = subscribeTable('blockers', handleBlockerEvent);
}

export function stopBlockersRealtime(){
  if(unsubscribe){ unsubscribe(); unsubscribe = null; }
}
