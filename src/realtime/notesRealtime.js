/**
 * Realtime sync for notes. Notes are effectively append-only in normal
 * use (no edit UI beyond the 15-minute author window), so this mostly
 * handles INSERT; UPDATE/DELETE are still wired for completeness and to
 * reflect a lead's cleanup elsewhere.
 */
import { subscribeTable } from './realtimeClient.js';
import { state } from '../state/store.js';
import { rowToNote } from '../db/mappers.js';
import { requestRender } from '../app/bus.js';

let unsubscribe = null;

function jobNumberFor(jobId){
  if(!jobId) return '';
  const job = state.jobs.find(j => j.id === jobId);
  return job ? job.jobNumber : '';
}

export function handleNoteEvent({ type, record, oldRecord }){
  if(type === 'DELETE'){
    const id = (oldRecord && oldRecord.id) || (record && record.id);
    if(!id) return;
    const before = state.notes.length;
    state.notes = state.notes.filter(n => n.id !== id);
    if(state.notes.length !== before) requestRender();
    return;
  }
  if(!record) return;
  const mapped = rowToNote({ ...record, job_number: jobNumberFor(record.job_id) });
  const idx = state.notes.findIndex(n => n.id === mapped.id);
  if(idx === -1) state.notes.unshift(mapped);
  else state.notes[idx] = mapped;
  requestRender();
}

export function startNotesRealtime(){
  stopNotesRealtime();
  unsubscribe = subscribeTable('notes', handleNoteEvent);
}

export function stopNotesRealtime(){
  if(unsubscribe){ unsubscribe(); unsubscribe = null; }
}
