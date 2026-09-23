/**
 * Every change the app makes, as one function each. Each sends one request
 * and merges the server's answer into the store straight away -- the live
 * echo of the same change arrives a moment later and changes nothing.
 *
 * Failures are thrown as ApiError for the caller to show. A job edit that
 * lost a race (someone else changed it first) comes back as `stale` with
 * the current job, which is applied before the error is rethrown.
 */
import { api } from './api.js';
import { setState, upsert, without } from './store.js';

/* ---------------- loading ---------------- */

export async function reloadState(){
  const data = await api.get('/api/state');
  setState({ ...data, phase: 'ready', loadedAt: Date.now() });
  return data;
}

/** Merges a job, unless the copy already held is newer (see `rev`). */
export function applyJob(job){
  setState(s => {
    const held = s.jobs.find(j => j.id === job.id);
    if(held && held.rev > job.rev) return null;
    return { jobs: upsert(s.jobs, job) };
  });
  return job;
}

async function withStale(promise){
  try {
    return await promise;
  } catch (err) {
    if(err.isStale && err.data.job) applyJob(err.data.job);
    throw err;
  }
}

/* ---------------- session ---------------- */

export const signIn = (login, password) => api.post('/api/session', { login, password });
export const signUp = fields => api.post('/api/signup', fields);
export const setUp = fields => api.post('/api/setup', fields);
export const signOut = () => api.del('/api/session');
export const changePassword = (current, next) => api.post('/api/me/password', { current, next });

/* ---------------- jobs ---------------- */

export async function createJob(fields){
  const { job } = await api.post('/api/jobs', fields);
  return applyJob(job);
}

/** `fields` is any of jobNumber, customer, description, dueDate,
 *  priority, assignedTo, percentComplete. */
export async function updateJob(job, fields){
  const res = await withStale(api.patch(`/api/jobs/${job.id}`, { version: job.version, ...fields }));
  return applyJob(res.job);
}

export async function deleteJob(job){
  await api.del(`/api/jobs/${job.id}`);
  setState(s => ({
    jobs: without(s.jobs, job.id),
    blockers: s.blockers.filter(b => b.jobId !== job.id),
    notes: s.notes.filter(n => n.jobId !== job.id),
    errors: s.errors.filter(e => e.jobId !== job.id),
    tasks: s.tasks.filter(t => t.jobId !== job.id)
  }));
}

export async function moveStage(job, to){
  const res = await withStale(api.post(`/api/jobs/${job.id}/stage`, { from: job.stage, to }));
  return applyJob(res.job);
}

export async function setChecklistItem(job, key, done){
  const res = await api.put(`/api/jobs/${job.id}/checklist/${key}`, { done });
  return applyJob(res.job);
}

/* ---------------- blueprints ---------------- */

/**
 * Saves a scan: parts and thumbnail first, then the original file. The
 * parts are the part that matters, so a failed file upload is reported
 * back (`fileSaved: false`) rather than losing the scan.
 */
export async function saveScan(job, { components, file, thumbnail, scanner = null }){
  const created = await api.post(`/api/jobs/${job.id}/blueprints`, {
    components,
    scanner,
    thumbnail: thumbnail || null,
    fileName: file ? file.name : null,
    mimeType: file ? file.type : null
  });
  applyJob(created.job);
  if(!file) return { blueprint: created.blueprint, fileSaved: true };
  try {
    const up = await api.put(`/api/blueprints/${created.blueprint.id}/file`, file, { contentType: file.type || 'application/octet-stream' });
    applyJob(up.job);
    return { blueprint: up.blueprint, fileSaved: true };
  } catch (e) {
    console.error('blueprint file upload failed', e);
    return { blueprint: created.blueprint, fileSaved: false };
  }
}

/** Parts-list edits. Each answers with the updated job. */
export async function addComponent(blueprintId, fields){
  return applyJob((await api.post(`/api/blueprints/${blueprintId}/components`, fields)).job);
}
export async function updateComponent(id, fields){
  return applyJob((await api.patch(`/api/components/${id}`, fields)).job);
}
export async function deleteComponent(id){
  return applyJob((await api.del(`/api/components/${id}`)).job);
}
export async function reorderComponents(blueprintId, ids){
  return applyJob((await api.put(`/api/blueprints/${blueprintId}/order`, { ids })).job);
}

/* ---------------- blockers ---------------- */

export async function reportBlocker(fields){
  const { blocker } = await api.post('/api/blockers', fields);
  setState(s => ({ blockers: upsert(s.blockers, blocker, { prepend: true }) }));
  return blocker;
}

export async function setBlockerStatus(blocker, status){
  const res = await api.patch(`/api/blockers/${blocker.id}`, { status });
  setState(s => ({ blockers: upsert(s.blockers, res.blocker) }));
  return res.blocker;
}

export async function deleteBlocker(blocker){
  await api.del(`/api/blockers/${blocker.id}`);
  setState(s => ({ blockers: without(s.blockers, blocker.id) }));
}

/* ---------------- notes ---------------- */

export async function addNotes({ jobId, date, entries }){
  const { notes } = await api.post('/api/notes', { jobId, date, entries });
  setState(s => ({ notes: notes.reduce((list, n) => upsert(list, n, { prepend: true }), s.notes) }));
  return notes;
}

export async function deleteNote(note){
  await api.del(`/api/notes/${note.id}`);
  setState(s => ({ notes: without(s.notes, note.id) }));
}

/* ---------------- errors ---------------- */

export async function logError(fields){
  const { error } = await api.post('/api/errors', fields);
  setState(s => ({ errors: upsert(s.errors, error, { prepend: true }) }));
  return error;
}

export async function setErrorStatus(error, status, correction){
  const res = await api.patch(`/api/errors/${error.id}`, correction === undefined ? { status } : { status, correction });
  setState(s => ({ errors: upsert(s.errors, res.error) }));
  return res.error;
}

export async function deleteError(error){
  await api.del(`/api/errors/${error.id}`);
  setState(s => ({ errors: without(s.errors, error.id) }));
}

/* ---------------- tasks ---------------- */

export async function saveTask(existing, fields){
  const { task } = existing
    ? await api.patch(`/api/tasks/${existing.id}`, fields)
    : await api.post('/api/tasks', fields);
  setState(s => ({ tasks: upsert(s.tasks, task, { prepend: true }) }));
  return task;
}

export async function setTaskActive(task, active){
  const res = await api.patch(`/api/tasks/${task.id}`, { active });
  setState(s => ({ tasks: upsert(s.tasks, res.task) }));
}

export async function deleteTask(task){
  await api.del(`/api/tasks/${task.id}`);
  setState(s => ({ tasks: without(s.tasks, task.id), completions: s.completions.filter(c => c.taskId !== task.id) }));
}

export async function tickTask(task, date, done){
  if(done){
    const { completion } = await api.put(`/api/tasks/${task.id}/done/${date}`);
    setState(s => ({
      completions: [completion, ...s.completions.filter(c => !(c.taskId === task.id && c.dueOn === date))]
    }));
  } else {
    await api.del(`/api/tasks/${task.id}/done/${date}`);
    setState(s => ({ completions: s.completions.filter(c => !(c.taskId === task.id && c.dueOn === date)) }));
  }
}

/* ---------------- activity ---------------- */

export async function loadActivity(params = {}){
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
  return api.get(`/api/activity${qs ? `?${qs}` : ''}`);
}

/** For the few things only the app knows about (an AI action, a scan
 *  that failed in the browser). Never throws: logging must not break
 *  the work it records. */
export function logActivity(action, detail, entity){
  return api.post('/api/activity', { action, detail, entity }).catch(e => console.error('activity log failed', e));
}
