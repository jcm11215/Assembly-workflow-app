/**
 * Daily tasks: what is owed today (and anything overdue), the full set of
 * tasks, and the form to add or change one.
 */
import { html, useState } from '../vendor/index.js';
import { useStore } from '../lib/store.js';
import { saveTask, setTaskActive, deleteTask, tickTask } from '../lib/actions.js';
import { useCan } from '../lib/permissions.js';
import { fmtDate } from '../lib/format.js';
import { todayISO } from '../../shared/dates.js';
import { RECURRENCE, WEEKDAYS, isDueOn, isOverdue, isRecurring, occurrenceKey, recurrenceLabel, taskProblem } from '../../shared/tasks.js';
import { Chips, Empty, Field, Select, AsyncButton, PageHeader, submitting } from '../ui/kit.js';
import { Icon } from '../ui/icons.js';
import { openModal, Sheet, confirmAction, toast, toastError } from '../ui/overlays.js';

const FILTERS = [
  { id: 'today', label: 'Today' },
  { id: 'mine', label: 'Mine' },
  { id: 'all', label: 'All tasks' },
  { id: 'stopped', label: 'Stopped' }
];

/** The occurrences owed as of today: overdue one-offs first, then today's. */
function owedToday(tasks, doneKeys, today){
  const overdue = tasks.filter(t => isOverdue(t, doneKeys, today)).map(t => ({ task: t, on: t.dueDate }));
  const due = tasks.filter(t => isDueOn(t, today)).map(t => ({ task: t, on: today }));
  return [...overdue, ...due];
}

function useDoneKeys(){
  const completions = useStore(s => s.completions);
  const byKey = new Map(completions.map(c => [occurrenceKey(c.taskId, c.dueOn), c]));
  return byKey;
}

export function Tasks(){
  const tasks = useStore(s => s.tasks);
  const me = useStore(s => s.me);
  const canManage = useCan('task.manage');
  const done = useDoneKeys();
  const [filter, setFilter] = useState('today');
  const today = todayISO();

  let body;
  if(filter === 'today' || filter === 'mine'){
    let owed = owedToday(tasks, done, today);
    if(filter === 'mine') owed = owed.filter(o => o.task.assignedTo === me.id);
    body = owed.length
      ? owed.map(o => html`<${Occurrence} key=${o.task.id + o.on} task=${o.task} on=${o.on} done=${done.get(occurrenceKey(o.task.id, o.on))} today=${today} />`)
      : html`<div class="card"><${Empty} icon="checkCircle">${filter === 'mine' ? 'Nothing assigned to you today.' : 'Nothing due today.'}<//></div>`;
  } else {
    const list = tasks.filter(t => (filter === 'stopped' ? !t.active : t.active));
    body = list.length
      ? list.map(t => html`<${Definition} key=${t.id} task=${t} canManage=${canManage} />`)
      : html`<div class="card"><${Empty} icon="tasks">${filter === 'stopped' ? 'No stopped tasks.' : 'No tasks set up yet.'}<//></div>`;
  }

  return html`
    <${PageHeader} title="Tasks" sub="One-off and recurring shop tasks"
                   actions=${canManage && html`<button class="btn btn-primary" onClick=${() => openModal(TaskForm)}><${Icon} name="plus" />Add task</button>`} />
    <div class="toolbar"><${Chips} label="Show" options=${FILTERS} value=${filter} onChange=${setFilter} /></div>
    <div class="list">${body}</div>`;
}

/** What's owed today, for the Home screen's card. */
export function TodayTasks(){
  const tasks = useStore(s => s.tasks);
  const canManage = useCan('task.manage');
  const done = useDoneKeys();
  const today = todayISO();
  const owed = owedToday(tasks, done, today);
  if(!owed.length){
    return html`
      <div class="calm"><${Icon} name="checkCircle" size=${22} />
        <span>Nothing due today.${canManage && html` <button class="link-btn" onClick=${() => openModal(TaskForm)}>Add a task</button>`}</span>
      </div>`;
  }
  return html`${owed.map(o => html`<${Occurrence} key=${o.task.id + o.on} task=${o.task} on=${o.on} done=${done.get(occurrenceKey(o.task.id, o.on))} today=${today} compact />`)}`;
}

function metaLine(t){
  return [t.jobNumber, t.assignedName || 'Anyone', recurrenceLabel(t)].filter(Boolean).join(' · ');
}

/** One thing owed on one day, with the tick that settles it. */
function Occurrence({ task, on, done, today, compact }){
  const late = on < today && !done;
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try { await tickTask(task, on, !done); }
    catch (e) { toastError(e); }
    finally { setBusy(false); }
  };
  return html`
    <div class=${`task${done ? ' done' : ''}${late ? ' late' : ''}${compact ? ' compact' : ''}`}>
      <button class="tick" onClick=${toggle} disabled=${busy} aria-pressed=${!!done} title=${done ? 'Undo' : 'Mark done'}>${done && html`<${Icon} name="check" size=${14} />`}</button>
      <div class="task-body">
        <div class="task-title">${task.title}</div>
        ${!compact && task.details && html`<div class="task-details">${task.details}</div>`}
        <div class="task-meta">
          ${metaLine(task)}
          ${late && html` · <b class="late-tag">due ${fmtDate(on)}</b>`}
          ${done && html` · done by ${done.doneByName}`}
        </div>
      </div>
    </div>`;
}

/** The task itself, as managed on the All / Stopped views. */
function Definition({ task, canManage }){
  const remove = async () => {
    const ok = await confirmAction({
      title: 'Delete task',
      message: `Delete "${task.title}"? Everything already ticked off against it goes too. To keep that history, Stop it instead.`,
      confirmLabel: 'Delete task', danger: true
    });
    if(ok) deleteTask(task).then(() => toast('Task deleted.'), toastError);
  };
  return html`
    <div class=${`task${task.active ? '' : ' stopped'}`}>
      <div class="task-body">
        <div class="task-title">${task.title}</div>
        ${task.details && html`<div class="task-details">${task.details}</div>`}
        <div class="task-meta">${metaLine(task)}${!isRecurring(task) && task.dueDate ? ` · ${fmtDate(task.dueDate)}` : ''}</div>
        ${canManage && html`
          <div class="card-actions">
            <button class="btn btn-sm" onClick=${() => openModal(TaskForm, { task })}>Edit</button>
            <${AsyncButton} class="btn btn-sm" onClick=${() => setTaskActive(task, !task.active)}>${task.active ? 'Stop' : 'Resume'}<//>
            <button class="btn btn-sm btn-danger-outline" onClick=${remove}>Delete</button>
          </div>`}
      </div>
    </div>`;
}

export function TaskForm({ task, close }){
  const jobs = useStore(s => s.jobs);
  const team = useStore(s => s.team.filter(u => u.active));
  const t = task || { title: '', details: '', jobId: '', assignedTo: '', recurrence: 'none', dueDate: todayISO(), weekday: 1, startsOn: todayISO() };
  const [recurrence, setRecurrence] = useState(t.recurrence);

  const submit = submitting(async f => {
    const fields = {
      title: f.title.trim(),
      details: f.details.trim(),
      jobId: f.jobId || null,
      assignedTo: f.assignedTo || null,
      recurrence: f.recurrence,
      dueDate: f.recurrence === 'none' ? f.dueDate : null,
      weekday: f.recurrence === 'weekly' ? Number(f.weekday) : null,
      startsOn: f.recurrence === 'none' ? null : (f.startsOn || todayISO())
    };
    const problem = taskProblem(fields);
    if(problem) throw new Error(problem);
    await saveTask(task, fields);
    toast(task ? 'Task saved.' : 'Task added.', { kind: 'ok' });
    close();
  });

  return html`
    <${Sheet} title=${task ? 'Edit task' : 'Add task'} close=${close}>
      <form onSubmit=${submit}>
        <${Field} label="Task"><input name="title" required defaultValue=${t.title} placeholder="e.g. Sweep the assembly bays" /><//>
        <${Field} label="Details (optional)"><textarea name="details" rows="2" defaultValue=${t.details}></textarea><//>
        <${Field} label="Job (optional)">
          <${Select} name="jobId" value=${t.jobId || ''}
                     options=${[{ value: '', label: 'Shop-wide -- not a job' }, ...jobs.map(j => ({ value: j.id, label: `${j.jobNumber} -- ${j.customer}` }))]} />
        <//>
        <${Field} label="Assign to (optional)">
          <${Select} name="assignedTo" value=${t.assignedTo || ''}
                     options=${[{ value: '', label: 'Anyone -- whoever picks it up' }, ...team.map(u => ({ value: u.id, label: u.fullName }))]} />
        <//>
        <${Field} label="Repeat" hint=${RECURRENCE.find(r => r.id === recurrence).blurb}>
          <${Select} name="recurrence" value=${t.recurrence} onChange=${e => setRecurrence(e.currentTarget.value)}
                     options=${RECURRENCE.map(r => ({ value: r.id, label: r.label }))} />
        <//>
        ${recurrence === 'none' && html`<${Field} label="Due date"><input type="date" name="dueDate" required defaultValue=${t.dueDate || todayISO()} /><//>`}
        ${recurrence === 'weekly' && html`
          <${Field} label="Which day">
            <${Select} name="weekday" value=${t.weekday ?? 1} options=${WEEKDAYS.map((d, i) => ({ value: i, label: d }))} />
          <//>`}
        ${recurrence !== 'none' && html`<${Field} label="Starting"><input type="date" name="startsOn" defaultValue=${t.startsOn || todayISO()} /><//>`}
        <button type="submit" class="btn btn-primary btn-block">${task ? 'Save task' : 'Add task'}</button>
      </form>
    <//>`;
}
