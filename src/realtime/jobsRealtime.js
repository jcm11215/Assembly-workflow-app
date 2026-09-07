/**
 * Realtime sync for jobs.
 *
 * Patches state.jobs by id from postgres_changes events -- this is what
 * replaces the poll-and-replace-everything loop. `version` is the
 * concurrency guard: an incoming row older than what's already local (a
 * duplicate delivery, an out-of-order message, or an echo of our own
 * optimistic write we already applied) is dropped rather than reapplied.
 */
import { subscribeTable } from './realtimeClient.js';
import { state } from '../state/store.js';
import * as jobsRepo from '../db/jobsRepo.js';
import { requestRender } from '../app/bus.js';

let unsubscribe = null;

/**
 * Merges the columns a realtime jobs-row event actually carries onto the
 * existing UI object, preserving fields that row doesn't include
 * (checklist, spec, billOfMaterials, blueprint flags) so a stage-move
 * event from someone else never wipes locally-loaded blueprint data.
 */
export function patchJobFromRow(existing, row){
  existing.jobNumber = row.job_number;
  existing.customer = row.customer || '';
  existing.description = row.description || '';
  existing.dueDate = row.due_date || '';
  existing.priority = row.priority || 'Medium';
  existing.assemblyStatus = row.stage || existing.assemblyStatus;
  existing.percentComplete = row.percent_complete ?? existing.percentComplete;
  existing.version = row.version ?? existing.version;
  existing.updatedAt = row.updated_at || existing.updatedAt;
  existing.assignedTo = row.assigned_to !== undefined ? row.assigned_to : existing.assignedTo;
  return existing;
}

function hydrateAndAppendIfMissing(id){
  return jobsRepo.getJob(id).then(job => {
    if(job && !state.jobs.some(j => j.id === job.id)){
      state.jobs.push(job);
      requestRender();
    }
  }).catch(e => console.error('realtime: could not hydrate job', id, e));
}

export function handleJobEvent({ type, record, oldRecord }){
  if(type === 'INSERT'){
    if(!record || state.jobs.some(j => j.id === record.id)) return;
    // Jobs carry derived fields (checklist, spec, BOM) the bare row does
    // not -- fetch the fully hydrated record rather than construct a
    // partial one for a case that happens once per job, not per edit.
    hydrateAndAppendIfMissing(record.id);
    return;
  }

  if(type === 'DELETE'){
    const id = (oldRecord && oldRecord.id) || (record && record.id);
    if(!id) return;
    const before = state.jobs.length;
    state.jobs = state.jobs.filter(j => j.id !== id);
    if(state.jobs.length !== before) requestRender();
    return;
  }

  if(type === 'UPDATE'){
    if(!record) return;
    const existing = state.jobs.find(j => j.id === record.id);
    if(!existing){ hydrateAndAppendIfMissing(record.id); return; }

    const incomingVersion = record.version ?? 0;
    if(incomingVersion < (existing.version ?? 0)) return;   // stale -- drop it
    patchJobFromRow(existing, record);
    requestRender();
  }
}

export function startJobsRealtime(){
  stopJobsRealtime();
  unsubscribe = subscribeTable('jobs', handleJobEvent);
}

export function stopJobsRealtime(){
  if(unsubscribe){ unsubscribe(); unsubscribe = null; }
}
