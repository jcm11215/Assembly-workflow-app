/**
 * Daily tasks: the recurrence vocabulary and the rules that decide which
 * tasks are due on a given day.
 *
 * A recurring task is ONE row, not one row per day. Nothing generates
 * future rows -- there is no server-side scheduler in this app, and a
 * generator would have to run somewhere to keep them coming. Instead a
 * task carries a rule, and the day's list is worked out on the spot from
 * that rule. A task is therefore a definition; what a worker ticks off
 * is an *occurrence*: the pair (task, date).
 *
 * Completions are stored per occurrence rather than as a `done` flag on
 * the task, which is what makes "was the Tuesday sweep skipped?" a
 * question with an answer. A flag would be overwritten every morning and
 * the history lost.
 */

/** The offered rules, in the order the picker shows them. */
export const RECURRENCE = [
  { id: 'none',     label: 'One-off',    blurb: 'Due once, on the date you pick.' },
  { id: 'daily',    label: 'Every day',  blurb: 'Comes back every day, weekends included.' },
  { id: 'weekdays', label: 'Mon-Fri',    blurb: 'Comes back each working day.' },
  { id: 'weekly',   label: 'Every week', blurb: 'Comes back on the day of the week you pick.' }
];

export const RECURRENCE_IDS = RECURRENCE.map(r => r.id);

export const WEEKDAYS = [
  { id: 0, label: 'Sunday',    short: 'Sun' },
  { id: 1, label: 'Monday',    short: 'Mon' },
  { id: 2, label: 'Tuesday',   short: 'Tue' },
  { id: 3, label: 'Wednesday', short: 'Wed' },
  { id: 4, label: 'Thursday',  short: 'Thu' },
  { id: 5, label: 'Friday',    short: 'Fri' },
  { id: 6, label: 'Saturday',  short: 'Sat' }
];

export function recurrenceLabel(task){
  if(!task) return '';
  if(task.recurrence === 'weekly'){
    const d = WEEKDAYS.find(w => w.id === Number(task.weekday));
    return d ? `Every ${d.label}` : 'Every week';
  }
  const r = RECURRENCE.find(r => r.id === task.recurrence);
  return r ? r.label : 'One-off';
}

export function isRecurring(task){
  return !!task && task.recurrence && task.recurrence !== 'none';
}

/**
 * Day of week for an ISO date, parsed as LOCAL midnight.
 *
 * `new Date('2026-09-16')` is parsed as UTC midnight, which is the
 * previous day in every timezone west of Greenwich -- that alone would
 * put a Monday task on Sunday's list for this shop. The explicit time
 * suffix is what the rest of the app's date helpers use, for the same
 * reason.
 */
export function dayOfWeek(iso){
  return new Date(`${iso}T00:00:00`).getDay();
}

/** Is `iso` on or after `start`? Plain string compare is safe for ISO dates. */
function onOrAfter(iso, start){
  return !start || iso >= start;
}

/**
 * Does this task fall due on this date?
 *
 * A recurring task never reaches back before the day it was set up:
 * without `startsOn`, adding "sweep the bays, every day" on Friday would
 * retroactively show every day of the shop's history as missed.
 */
export function isDueOn(task, iso){
  if(!task || !iso) return false;
  if(task.active === false) return false;

  switch(task.recurrence){
    case 'daily':
      return onOrAfter(iso, task.startsOn);
    case 'weekdays': {
      const d = dayOfWeek(iso);
      return d >= 1 && d <= 5 && onOrAfter(iso, task.startsOn);
    }
    case 'weekly':
      return dayOfWeek(iso) === Number(task.weekday) && onOrAfter(iso, task.startsOn);
    default:
      // One-off. Its date is the only day it is ever due, and it is due
      // then whether or not that day has passed -- an overdue one-off
      // must stay on the list, not vanish the next morning.
      return task.dueDate === iso;
  }
}

/** The tasks due on `iso`, in a stable order. */
export function tasksDueOn(tasks, iso){
  return (tasks || []).filter(t => isDueOn(t, iso));
}

/**
 * A one-off whose day has passed and which was never ticked off. Only
 * one-offs can be overdue: a missed recurring day is history, not
 * something still owed today -- "sweep the bays" from last Tuesday is
 * not a job you do now.
 */
export function isOverdue(task, completedKeys, todayIso){
  if(!task || isRecurring(task) || task.active === false) return false;
  if(!task.dueDate || task.dueDate >= todayIso) return false;
  return !completedKeys.has(occurrenceKey(task.id, task.dueDate));
}

/** `iso` shifted by whole days, staying on the local calendar. */
export function shiftDays(iso, delta){
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + delta);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** How many days of history the views actually show. */
export const COMPLETION_WINDOW_DAYS = 30;

/**
 * The span of ticks worth fetching. The history grows without bound, so
 * it is a window rather than the lot -- but the window is stretched back
 * to cover any still-open one-off older than it.
 *
 * Without that stretch a task due two months ago and ticked off the same
 * day would come back with its tick out of range, read as never done,
 * and be reported as overdue forever.
 */
export function completionWindow(tasks, todayIso){
  let from = shiftDays(todayIso, -COMPLETION_WINDOW_DAYS);
  for(const t of tasks || []){
    if(!isRecurring(t) && t.active !== false && t.dueDate && t.dueDate < from){
      from = t.dueDate;
    }
  }
  return { from, to: todayIso };
}

/** Identifies one occurrence: this task, on this day. */
export function occurrenceKey(taskId, iso){
  return `${taskId}|${iso}`;
}

/** Builds the lookup the views use to ask "is this one ticked off?". */
export function completedKeySet(completions){
  return new Set((completions || []).map(c => occurrenceKey(c.taskId, c.dueOn)));
}

export function isDone(completedKeys, taskId, iso){
  return completedKeys.has(occurrenceKey(taskId, iso));
}
