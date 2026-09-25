/**
 * Daily tasks: the recurrence rules and which tasks fall due on a day.
 *
 * A recurring task is one record carrying a rule, not a row per day --
 * nothing has to run overnight to generate tomorrow's list. What a worker
 * ticks off is an occurrence, the pair (task, date), and ticks are stored
 * per occurrence so "was Tuesday's sweep skipped?" has an answer.
 */
import { dayOfWeek, shiftDays } from './dates.js';

export const RECURRENCE = [
  { id: 'none',     label: 'One-off',    blurb: 'Due once, on the date you pick.' },
  { id: 'daily',    label: 'Every day',  blurb: 'Comes back every day, weekends included.' },
  { id: 'weekdays', label: 'Mon-Fri',    blurb: 'Comes back each working day.' },
  { id: 'weekly',   label: 'Every week', blurb: 'Comes back on the day of the week you pick.' }
];
export const RECURRENCE_IDS = RECURRENCE.map(r => r.id);

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const isRecurring = task => !!task && task.recurrence !== 'none';

export function recurrenceLabel(task){
  if(task.recurrence === 'weekly') return `Every ${WEEKDAYS[Number(task.weekday)] || 'week'}`;
  return (RECURRENCE.find(r => r.id === task.recurrence) || RECURRENCE[0]).label;
}

/**
 * Does `task` fall due on `iso`? A recurring task never reaches back
 * before the day it was set up; a one-off is due on its date whether or
 * not that day has passed, so an overdue one stays on the list.
 */
export function isDueOn(task, iso){
  if(!task || task.active === false) return false;
  const started = !task.startsOn || iso >= task.startsOn;
  switch(task.recurrence){
    case 'daily':    return started;
    case 'weekdays': { const d = dayOfWeek(iso); return started && d >= 1 && d <= 5; }
    case 'weekly':   return started && dayOfWeek(iso) === Number(task.weekday);
    default:         return task.dueDate === iso;
  }
}

export const occurrenceKey = (taskId, iso) => `${taskId}|${iso}`;

/** Only one-offs can be overdue: a missed recurring day is history, not
 *  something still owed today. */
export function isOverdue(task, doneKeys, today){
  if(task.active === false || isRecurring(task) || !task.dueDate || task.dueDate >= today) return false;
  return !doneKeys.has(occurrenceKey(task.id, task.dueDate));
}

export const HISTORY_DAYS = 30;

/**
 * The span of ticks worth loading: the last month, stretched back to
 * cover any still-open one-off older than that -- otherwise its tick
 * would fall outside the window and it would read as overdue forever.
 */
export function completionWindow(tasks, today){
  let from = shiftDays(today, -HISTORY_DAYS);
  for(const t of tasks){
    if(t.active !== false && !isRecurring(t) && t.dueDate && t.dueDate < from) from = t.dueDate;
  }
  return { from, to: today };
}

/**
 * Checks a task's fields for shape: a one-off needs its date, a weekly
 * task its weekday, and a recurring task a start date. Returns an error
 * message or null. Used by the server before writing and by the form
 * before sending.
 */
export function taskProblem(t){
  if(!t.title || !String(t.title).trim()) return 'Give the task a title.';
  if(!RECURRENCE_IDS.includes(t.recurrence)) return 'Pick how often it comes back.';
  if(t.recurrence === 'none' && !t.dueDate) return 'Pick the day it is due.';
  if(t.recurrence === 'weekly' && !(Number.isInteger(t.weekday) && t.weekday >= 0 && t.weekday <= 6)){
    return 'Pick the day of the week.';
  }
  if(t.recurrence !== 'none' && !t.startsOn) return 'Pick the day it starts.';
  return null;
}
