/**
 * Daily tasks repository.
 *
 * Two tables behind one module, because they are never useful apart: a
 * task without its ticks cannot say whether it was done, and a tick
 * without its task is a row of two ids.
 */
import { db, currentUserId } from './supabaseClient.js';
import { rowToTask, taskToRow, rowToTaskCompletion } from './mappers.js';

const TASK_SEL = 'select=id,title,details,job_id,assigned_to,recurrence,due_date,weekday,' +
                 'starts_on,active,created_at,jobs(job_number),profiles!shop_tasks_assigned_to_fkey(full_name)';

const DONE_SEL = 'select=id,task_id,due_on,done_by,done_at,profiles(full_name)';

function flattenTask(row){
  return rowToTask({
    ...row,
    job_number: row.jobs ? row.jobs.job_number : '',
    assignee_name: row.profiles ? row.profiles.full_name : ''
  });
}

function flattenCompletion(row){
  return rowToTaskCompletion({
    ...row,
    done_by_name: row.profiles ? row.profiles.full_name : ''
  });
}

export async function listTasks(){
  const rows = await db.select('shop_tasks', `${TASK_SEL}&order=created_at.desc`);
  return rows.map(flattenTask);
}

/**
 * Ticks are only ever read for a window of days. The whole history grows
 * without bound and the views never show more than a few days of it, so
 * the range is a parameter rather than something to filter client-side.
 */
export async function listCompletions(fromIso, toIso){
  const rows = await db.select(
    'shop_task_completions',
    `${DONE_SEL}&due_on=gte.${fromIso}&due_on=lte.${toIso}&order=due_on.desc`
  );
  return rows.map(flattenCompletion);
}

export async function createTask(task){
  const jobId = task.jobId || (task.jobNumber ? await resolveJobId(task.jobNumber) : null);
  const row = taskToRow(task, jobId);
  row.created_by = currentUserId();
  const [created] = await db.insert('shop_tasks', row);
  return flattenTask({
    ...created,
    jobs: task.jobNumber ? { job_number: task.jobNumber } : null,
    profiles: task.assigneeName ? { full_name: task.assigneeName } : null
  });
}

export async function updateTask(taskId, task){
  const jobId = task.jobId || (task.jobNumber ? await resolveJobId(task.jobNumber) : null);
  const [updated] = await db.update('shop_tasks', `id=eq.${taskId}`, taskToRow(task, jobId));
  return flattenTask({
    ...updated,
    jobs: task.jobNumber ? { job_number: task.jobNumber } : null,
    profiles: task.assigneeName ? { full_name: task.assigneeName } : null
  });
}

/** Stopping a recurring task keeps it, and its history, out of the way. */
export async function setActive(taskId, active){
  const [updated] = await db.update('shop_tasks', `id=eq.${taskId}`, { active });
  return updated;
}

export async function deleteTask(taskId){
  await db.remove('shop_tasks', `id=eq.${taskId}`);
}

/**
 * Tick one occurrence off. Upsert rather than insert: two people tapping
 * the same row at once is one fact, and the table's unique constraint
 * would otherwise turn the second tap into an error in someone's face.
 */
export async function completeOccurrence(taskId, dueOn){
  const [row] = await db.upsert('shop_task_completions', {
    task_id: taskId,
    due_on: dueOn,
    done_by: currentUserId()
  }, 'task_id,due_on');
  return rowToTaskCompletion(row);
}

/** Undo a tick -- the mis-tap case. RLS decides whose ticks may go. */
export async function uncompleteOccurrence(taskId, dueOn){
  await db.remove('shop_task_completions', `task_id=eq.${taskId}&due_on=eq.${dueOn}`);
}

async function resolveJobId(jobNumber){
  if(!jobNumber) return null;
  const rows = await db.select('jobs', `select=id&job_number=eq.${encodeURIComponent(jobNumber)}`);
  return rows.length ? rows[0].id : null;
}
