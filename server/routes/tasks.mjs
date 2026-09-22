/**
 * Daily tasks and ticking their occurrences off.
 */
import { badRequest, forbidden, notFound } from '../http.mjs';
import { uuid, now } from '../db.mjs';
import { getTask, getCompletion } from '../records.mjs';
import { broadcast } from '../live.mjs';
import { can } from '../../shared/roles.js';
import { taskProblem, isDueOn } from '../../shared/tasks.js';
import { todayISO } from '../../shared/dates.js';
import * as v from '../validate.mjs';

/** The fields of a task from a form, cleaned, with only the ones that
 *  apply to its kind kept: a one-off has no weekday or start, a
 *  recurring task no due date. */
function taskFields(db, body){
  const recurrence = body.recurrence || 'none';
  const recurring = recurrence !== 'none';
  const t = {
    title: v.text(body.title, 'Title', { max: 200 }),
    details: v.text(body.details, 'Details', { max: 4000 }),
    jobId: body.jobId ? v.job(db, body.jobId).id : null,
    assignedTo: v.optionalUser(db, body.assignedTo),
    recurrence,
    dueDate: recurring ? null : v.optionalDate(body.dueDate, 'Due date'),
    weekday: recurrence === 'weekly' ? Number(body.weekday) : null,
    startsOn: recurring ? (v.optionalDate(body.startsOn, 'Start date') || todayISO()) : null,
    active: body.active === undefined ? true : v.bool(body.active)
  };
  const problem = taskProblem(t);
  if(problem) throw badRequest(problem);
  return t;
}

function loadTask(db, id){
  const task = getTask(db, id);
  if(!task) throw notFound('That task');
  return task;
}

export default function register(r){

  r.post('/api/tasks', async ctx => {
    const t = taskFields(ctx.db, await ctx.json());
    const id = uuid();
    ctx.db.run(`insert into tasks (id, title, details, job_id, assigned_to, recurrence, due_date, weekday, starts_on,
                                   active, created_by, created_at)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      id, t.title, t.details, t.jobId, t.assignedTo, t.recurrence, t.dueDate, t.weekday, t.startsOn, ctx.user.id, now());
    const task = getTask(ctx.db, id);
    ctx.log('Task added', { text: task.title }, { type: 'task', id });
    broadcast('task', task);
    ctx.status = 201;
    return { task };
  }, { perm: 'task.manage' });

  /** A full edit, or `{ active }` alone to stop or resume a task. */
  r.patch('/api/tasks/:id', async ctx => {
    const existing = loadTask(ctx.db, ctx.params.id);
    const body = await ctx.json();
    const onlyActive = Object.keys(body).length === 1 && 'active' in body;
    const t = onlyActive ? { ...existing, active: v.bool(body.active) } : taskFields(ctx.db, { ...existing, ...body });
    ctx.db.run(`update tasks set title = ?, details = ?, job_id = ?, assigned_to = ?, recurrence = ?, due_date = ?,
                  weekday = ?, starts_on = ?, active = ? where id = ?`,
      t.title, t.details, t.jobId, t.assignedTo, t.recurrence, t.dueDate || null, t.weekday, t.startsOn || null,
      t.active ? 1 : 0, existing.id);
    const task = getTask(ctx.db, existing.id);
    ctx.log(onlyActive ? (task.active ? 'Task resumed' : 'Task stopped') : 'Task updated', { text: task.title }, { type: 'task', id: task.id });
    broadcast('task', task);
    return { task };
  }, { perm: 'task.manage' });

  r.delete('/api/tasks/:id', ctx => {
    const task = loadTask(ctx.db, ctx.params.id);
    ctx.db.run('delete from tasks where id = ?', task.id);
    ctx.log('Task deleted', { text: task.title }, { type: 'task', id: task.id });
    broadcast('task-removed', { id: task.id });
  }, { perm: 'task.manage' });

  /* ---------------- ticks ---------------- */

  r.put('/api/tasks/:id/done/:date', ctx => {
    const task = loadTask(ctx.db, ctx.params.id);
    const date = v.date(ctx.params.date, 'Date');
    if(!isDueOn({ ...task, active: true }, date)) throw badRequest(`"${task.title}" is not due on ${date}.`);
    // Two people ticking the same row at once is one fact, not an error.
    ctx.db.run(`insert into task_completions (task_id, due_on, done_by, done_at) values (?, ?, ?, ?)
                on conflict(task_id, due_on) do nothing`, task.id, date, ctx.user.id, now());
    const completion = getCompletion(ctx.db, task.id, date);
    ctx.log('Task done', { text: `${task.title} (${date})` }, { type: 'task', id: task.id });
    broadcast('completion', completion);
    return { completion };
  }, { perm: 'task.tick' });

  /** Undo a tick -- the mis-tap case. Your own, or anyone's if admin. */
  r.delete('/api/tasks/:id/done/:date', ctx => {
    const task = loadTask(ctx.db, ctx.params.id);
    const completion = getCompletion(ctx.db, task.id, ctx.params.date);
    if(!completion) return;
    if(completion.doneBy !== ctx.user.id && !can(ctx.user.role, 'task.manage')){
      throw forbidden(`${completion.doneByName || 'Someone else'} ticked this one. Ask them or an admin to undo it.`);
    }
    ctx.db.run('delete from task_completions where task_id = ? and due_on = ?', task.id, completion.dueOn);
    ctx.log('Task un-ticked', { text: `${task.title} (${completion.dueOn})` }, { type: 'task', id: task.id });
    broadcast('completion-removed', { taskId: task.id, dueOn: completion.dueOn });
  }, { perm: 'task.tick' });
}
