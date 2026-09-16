/** Daily tasks: today's list, the full set, and the add/edit form. */

import { requestRender as render } from '../app/bus.js';
import { isLeadOrAdmin } from '../auth/permissions.js';
import { listProfiles } from '../auth/profileService.js';
import { currentUserId } from '../db/supabaseClient.js';
import { logActivity, reloadTasks } from '../db/repository.js';
import {
  completeOccurrence, createTask, deleteTask,
  setActive, uncompleteOccurrence, updateTask
} from '../db/tasksRepo.js';
import {
  RECURRENCE, WEEKDAYS, completedKeySet, isDone, isOverdue,
  isRecurring, recurrenceLabel, tasksDueOn
} from '../models/taskMeta.js';
import { state } from '../state/store.js';
import { closeModal, openModal } from '../ui/components/modal.js';
import { showToast } from '../ui/components/toast.js';
import { fmtDate, todayISO } from '../utils/date.js';
import { escapeHtml } from '../utils/dom.js';

export const TASK_FILTERS = [
  { id: 'today',   label: 'Today' },
  { id: 'mine',    label: 'Mine' },
  { id: 'all',     label: 'All' },
  { id: 'stopped', label: 'Stopped' }
];

/**
 * The roster, for the assignee picker. Fetched once per session rather
 * than per render -- rendering is synchronous, and a dropdown that has
 * to await cannot be built inside it.
 */
let roster = null;
let rosterLoading = false;

function ensureRoster(){
  if(roster || rosterLoading) return;
  rosterLoading = true;
  listProfiles()
    .then(list => { roster = list.filter(p => p.active !== false); })
    .catch(e => { console.error('could not load the team roster', e); roster = []; })
    .finally(() => { rosterLoading = false; });
}

export function renderTasks(){
  ensureRoster();
  const canManage = isLeadOrAdmin();
  document.getElementById('content').innerHTML = `
    <div class="sticky-bar">
      <div class="chip-row" id="taskFilterChips">
        ${TASK_FILTERS.map(f => `<button class="chip ${state.taskFilter === f.id ? 'active' : ''}" data-action="filter-tasks" data-filter="${f.id}">${f.label}</button>`).join('')}
      </div>
    </div>
    <div id="taskCardsList"></div>
    ${canManage ? `<div class="fab-row"><button class="btn btn-primary btn-block" data-action="new-task">+ Add Task</button></div>` : ''}
  `;
  updateTasksList();
}

export function updateTasksList(){
  const today = todayISO();
  const done = completedKeySet(state.taskCompletions);
  const filter = state.taskFilter || 'today';
  const me = currentUserId();

  let html;
  if(filter === 'stopped'){
    const stopped = state.tasks.filter(t => t.active === false);
    html = stopped.length
      ? stopped.map(t => definitionCardHtml(t)).join('')
      : emptyState('&#9209;', 'No stopped tasks.');
  } else if(filter === 'all'){
    const live = state.tasks.filter(t => t.active !== false);
    html = live.length
      ? live.map(t => definitionCardHtml(t)).join('')
      : emptyState('&#128203;', 'No tasks set up yet.');
  } else {
    // Today / Mine: occurrences, not definitions -- what is owed today.
    let due = tasksDueOn(state.tasks, today);
    const overdue = state.tasks.filter(t => isOverdue(t, done, today));
    let list = [...overdue, ...due];
    if(filter === 'mine'){
      list = list.filter(t => t.assignedTo && t.assignedTo === me);
    }
    html = list.length
      ? list.map(t => {
          const on = isRecurring(t) ? today : t.dueDate;
          return occurrenceCardHtml(t, on, isDone(done, t.id, on), on < today);
        }).join('')
      : emptyState('&#9989;', filter === 'mine' ? 'Nothing assigned to you today.' : 'Nothing due today.');
  }
  document.getElementById('taskCardsList').innerHTML = html;
}

function emptyState(icon, text){
  return `<div class="empty-state"><div class="big">${icon}</div>${text}</div>`;
}

function metaLine(t){
  const bits = [];
  if(t.jobNumber) bits.push(escapeHtml(t.jobNumber));
  bits.push(t.assigneeName ? escapeHtml(t.assigneeName) : 'Anyone');
  bits.push(recurrenceLabel(t));
  return bits.join(' &middot; ');
}

/** One thing owed on one day, with the tick that settles it. */
function occurrenceCardHtml(t, on, doneNow, late){
  return `
  <div class="task-card${doneNow ? ' done' : ''}${late && !doneNow ? ' late' : ''}" data-id="${t.id}">
    <button class="task-tick" data-action="toggle-task-done" data-id="${t.id}" data-date="${on}"
            aria-pressed="${doneNow}" title="${doneNow ? 'Undo' : 'Mark done'}">
      ${doneNow ? '&#10003;' : ''}
    </button>
    <div class="task-body">
      <div class="task-title">${escapeHtml(t.title)}</div>
      ${t.details ? `<div class="task-details">${escapeHtml(t.details)}</div>` : ''}
      <div class="task-meta">${metaLine(t)}${late && !doneNow ? ` &middot; <b class="task-late">due ${fmtDate(on)}</b>` : ''}</div>
    </div>
  </div>`;
}

/** The instruction itself, as managed on the All / Stopped views. */
function definitionCardHtml(t){
  const canManage = isLeadOrAdmin();
  return `
  <div class="task-card${t.active === false ? ' stopped' : ''}" data-id="${t.id}">
    <div class="task-body">
      <div class="task-title">${escapeHtml(t.title)}</div>
      ${t.details ? `<div class="task-details">${escapeHtml(t.details)}</div>` : ''}
      <div class="task-meta">${metaLine(t)}${!isRecurring(t) && t.dueDate ? ` &middot; ${fmtDate(t.dueDate)}` : ''}</div>
      ${canManage ? `
      <div class="job-card-actions">
        <button class="btn btn-outline btn-sm" data-action="edit-task" data-id="${t.id}">Edit</button>
        <button class="btn btn-outline btn-sm" data-action="toggle-task-active" data-id="${t.id}">${t.active === false ? 'Resume' : 'Stop'}</button>
        <button class="btn btn-outline btn-sm" data-action="delete-task" data-id="${t.id}">Delete</button>
      </div>` : ''}
    </div>
  </div>`;
}

/* ================= FORM ================= */

export function taskFormHtml(task){
  const t = task || { title: '', details: '', jobNumber: '', assignedTo: '',
                      recurrence: 'none', dueDate: todayISO(), weekday: 1 };
  const people = roster || [];
  return `
  <div class="modal-sheet">
    <div class="modal-title">${task ? 'Edit Task' : 'Add Task'} <button class="modal-close" data-close-overlay>&times;</button></div>
    <form id="taskForm">
      <div class="field"><label>Task</label>
        <input required name="title" value="${escapeHtml(t.title)}" placeholder="e.g. Sweep the assembly bays"></div>
      <div class="field"><label>Details <span class="field-opt">(optional)</span></label>
        <textarea name="details" placeholder="Anything they need to know">${escapeHtml(t.details || '')}</textarea></div>
      <div class="field"><label>Job <span class="field-opt">(optional)</span></label>
        <select name="jobNumber">
          <option value="">Shop-wide -- not a job</option>
          ${state.jobs.map(j => `<option value="${escapeHtml(j.jobNumber)}" ${j.jobNumber === t.jobNumber ? 'selected' : ''}>${escapeHtml(j.jobNumber)} -- ${escapeHtml(j.customer)}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Assign to <span class="field-opt">(optional)</span></label>
        <select name="assignedTo">
          <option value="">Anyone -- whoever picks it up</option>
          ${people.map(p => `<option value="${escapeHtml(p.id)}" ${p.id === t.assignedTo ? 'selected' : ''}>${escapeHtml(p.full_name)}</option>`).join('')}
        </select>
        ${people.length ? '' : `<div class="field-hint">Team list still loading -- reopen this form to assign someone.</div>`}
      </div>
      <div class="field"><label>Repeat</label>
        <select name="recurrence" id="taskRecurrence">
          ${RECURRENCE.map(r => `<option value="${r.id}" ${r.id === t.recurrence ? 'selected' : ''}>${r.label}</option>`).join('')}
        </select>
      </div>
      <div class="field" id="taskDateField">
        <label>Due date</label>
        <input type="date" name="dueDate" value="${escapeHtml(t.dueDate || todayISO())}">
      </div>
      <div class="field" id="taskWeekdayField">
        <label>Which day</label>
        <select name="weekday">
          ${WEEKDAYS.map(w => `<option value="${w.id}" ${Number(t.weekday) === w.id ? 'selected' : ''}>${w.label}</option>`).join('')}
        </select>
      </div>
      <div class="fab-row"><button type="submit" class="btn btn-primary btn-block">${task ? 'Save Task' : 'Add Task'}</button></div>
    </form>
  </div>`;
}

/** Only the fields the chosen rule actually uses are on screen. */
function syncFormFields(){
  const rec = document.getElementById('taskRecurrence');
  if(!rec) return;
  const dateField = document.getElementById('taskDateField');
  const dayField = document.getElementById('taskWeekdayField');
  const oneOff = rec.value === 'none';
  if(dateField) dateField.style.display = oneOff ? '' : 'none';
  if(dayField) dayField.style.display = rec.value === 'weekly' ? '' : 'none';
}

export function openTaskForm(task){
  ensureRoster();
  openModal(taskFormHtml(task), () => taskFormHtml(task));
  syncFormFields();
  const rec = document.getElementById('taskRecurrence');
  if(rec) rec.addEventListener('change', syncFormFields);

  document.getElementById('taskForm').addEventListener('submit', async e => {
    e.preventDefault();
    const vals = Object.fromEntries(new FormData(e.target).entries());
    if(!vals.title || !vals.title.trim()){ showToast('Give the task a name'); return; }

    const record = {
      title: vals.title.trim(),
      details: (vals.details || '').trim(),
      jobNumber: vals.jobNumber || '',
      assignedTo: vals.assignedTo || null,
      recurrence: vals.recurrence || 'none',
      dueDate: vals.dueDate || todayISO(),
      weekday: Number(vals.weekday),
      startsOn: task && task.startsOn ? task.startsOn : todayISO(),
      active: task ? task.active !== false : true
    };
    const people = roster || [];
    const assignee = people.find(p => p.id === record.assignedTo);
    record.assigneeName = assignee ? assignee.full_name : '';

    try {
      if(task) await updateTask(task.id, record);
      else await createTask(record);
      await reloadTasks();
      logActivity(task ? 'Task updated' : 'Task added', {
        title: record.title,
        repeat: recurrenceLabel(record),
        assignedTo: record.assigneeName || 'Anyone',
        jobNumber: record.jobNumber || 'Shop-wide'
      });
      closeModal();
      showToast(task ? 'Task saved' : 'Task added');
      render();
    } catch (err) {
      console.error('could not save the task', err);
      showToast('Could not save that -- check the connection and try again', 4000);
    }
  });
}

/* ================= ACTIONS ================= */

export async function toggleTaskDone(taskId, dueOn){
  const t = state.tasks.find(x => x.id === taskId);
  if(!t) return;
  const done = completedKeySet(state.taskCompletions);
  const already = isDone(done, taskId, dueOn);
  try {
    if(already) await uncompleteOccurrence(taskId, dueOn);
    else await completeOccurrence(taskId, dueOn);
    await reloadTasks();
    logActivity(already ? 'Task un-ticked' : 'Task done', { title: t.title, day: dueOn });
    showToast(already ? 'Marked not done' : 'Nice one -- ticked off');
    render();
  } catch (err) {
    console.error('could not update the task', err);
    showToast('Could not update that -- check the connection', 4000);
  }
}

export async function toggleTaskActive(taskId){
  const t = state.tasks.find(x => x.id === taskId);
  if(!t) return;
  const next = t.active === false;
  try {
    await setActive(taskId, next);
    await reloadTasks();
    logActivity(next ? 'Task resumed' : 'Task stopped', { title: t.title });
    showToast(next ? 'Task resumed' : 'Task stopped');
    render();
  } catch (err) {
    console.error('could not change the task', err);
    showToast('Could not update that -- check the connection', 4000);
  }
}

export async function removeTask(taskId){
  const t = state.tasks.find(x => x.id === taskId);
  if(!t) return;
  try {
    await deleteTask(taskId);
    await reloadTasks();
    logActivity('Task deleted', { title: t.title });
    showToast('Task deleted');
    render();
  } catch (err) {
    console.error('could not delete the task', err);
    showToast('Could not delete that -- check the connection', 4000);
  }
}

export function editTask(taskId){
  const t = state.tasks.find(x => x.id === taskId);
  if(t) openTaskForm(t);
}
