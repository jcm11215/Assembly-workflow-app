/**
 * Daily tasks: the rules that decide what is owed on a given day.
 *
 * This is the part worth testing hard. A recurring task is one row and
 * many days, so every "is this due?" answer is computed, never stored --
 * and the timezone traps in date-only math are exactly the kind that
 * look fine in one place and put Monday's task on Sunday in another.
 */
import {
  COMPLETION_WINDOW_DAYS, completedKeySet, completionWindow, dayOfWeek,
  isDone, isDueOn, isOverdue, isRecurring, occurrenceKey, recurrenceLabel,
  shiftDays, tasksDueOn
} from '../src/models/taskMeta.js';

let pass = 0, fail = 0;
const t = (n, c) => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n)); };

// 2026-09-14 is a Monday; 09-19 Saturday; 09-20 Sunday.
const MON = '2026-09-14', TUE = '2026-09-15', WED = '2026-09-16';
const SAT = '2026-09-19', SUN = '2026-09-20';

console.log('=== the calendar underneath (date-only, local) ===');
t('Monday is day 1', dayOfWeek(MON) === 1);
t('Saturday is day 6', dayOfWeek(SAT) === 6);
t('Sunday is day 0', dayOfWeek(SUN) === 0);
t('shiftDays moves forward', shiftDays(MON, 2) === WED);
t('shiftDays moves back', shiftDays(WED, -2) === MON);
t('shiftDays crosses a month end', shiftDays('2026-09-30', 1) === '2026-10-01');
t('shiftDays crosses a year end', shiftDays('2026-12-31', 1) === '2027-01-01');
t('shiftDays handles a leap day', shiftDays('2028-02-28', 1) === '2028-02-29');

console.log('=== one-off tasks ===');
const oneOff = { id: 'a', recurrence: 'none', dueDate: WED };
t('due on its date', isDueOn(oneOff, WED));
t('not due the day before', !isDueOn(oneOff, TUE));
t('not due the day after', !isDueOn(oneOff, SAT));
// A one-off that slipped must stay on the list rather than quietly vanish.
t('still due on its own date once that date has passed', isDueOn(oneOff, WED));

console.log('=== daily ===');
const daily = { id: 'b', recurrence: 'daily', startsOn: TUE };
t('due the day it starts', isDueOn(daily, TUE));
t('due the next day', isDueOn(daily, WED));
t('due at the weekend too', isDueOn(daily, SUN));
t('NOT due before it was set up', !isDueOn(daily, MON));

console.log('=== weekdays ===');
const weekdays = { id: 'c', recurrence: 'weekdays', startsOn: MON };
t('due Monday', isDueOn(weekdays, MON));
t('due Wednesday', isDueOn(weekdays, WED));
t('not due Saturday', !isDueOn(weekdays, SAT));
t('not due Sunday', !isDueOn(weekdays, SUN));

console.log('=== weekly ===');
const weekly = { id: 'd', recurrence: 'weekly', weekday: 2, startsOn: MON };
t('due on its weekday (Tuesday)', isDueOn(weekly, TUE));
t('not due on other days', !isDueOn(weekly, WED));
t('due again the following week', isDueOn(weekly, shiftDays(TUE, 7)));
t('weekday given as a string still works', isDueOn({ ...weekly, weekday: '2' }, TUE));

console.log('=== a stopped task is due on no day at all ===');
t('stopped daily task is not due', !isDueOn({ ...daily, active: false }, WED));
t('stopped one-off is not due', !isDueOn({ ...oneOff, active: false }, WED));
t('active:true is due as normal', isDueOn({ ...daily, active: true }, WED));

console.log('=== tasksDueOn filters the set ===');
const all = [oneOff, daily, weekdays, weekly, { ...daily, id: 'e', active: false }];
t('Wednesday: one-off + daily + weekdays', tasksDueOn(all, WED).map(x => x.id).join(',') === 'a,b,c');
t('Saturday: daily only', tasksDueOn(all, SAT).map(x => x.id).join(',') === 'b');

console.log('=== completions are per occurrence, not per task ===');
const completions = [
  { taskId: 'b', dueOn: TUE },
  { taskId: 'b', dueOn: WED }
];
const keys = completedKeySet(completions);
t('key pairs task with day', occurrenceKey('b', TUE) === 'b|' + TUE);
t('Tuesday reads as done', isDone(keys, 'b', TUE));
t('Wednesday reads as done', isDone(keys, 'b', WED));
// The whole reason completions are their own rows: a skipped day stays
// visible instead of being overwritten by the next day's tick.
t('the SKIPPED Thursday still reads as not done', !isDone(keys, 'b', shiftDays(WED, 1)));
t('a different task is unaffected', !isDone(keys, 'c', TUE));

console.log('=== overdue is a one-off idea only ===');
const today = SAT;
t('un-ticked one-off from before today is overdue',
  isOverdue({ id: 'a', recurrence: 'none', dueDate: WED }, new Set(), today));
t('ticked one-off is NOT overdue',
  !isOverdue({ id: 'a', recurrence: 'none', dueDate: WED },
             completedKeySet([{ taskId: 'a', dueOn: WED }]), today));
t('one-off due today is not yet overdue',
  !isOverdue({ id: 'a', recurrence: 'none', dueDate: today }, new Set(), today));
t('one-off due later is not overdue',
  !isOverdue({ id: 'a', recurrence: 'none', dueDate: shiftDays(today, 3) }, new Set(), today));
// A missed recurring day is history, not something still owed now.
t('a missed recurring day is never overdue', !isOverdue(daily, new Set(), today));
t('a stopped one-off is not overdue',
  !isOverdue({ id: 'a', recurrence: 'none', dueDate: WED, active: false }, new Set(), today));

console.log('=== the completion window covers what the views ask about ===');
const plainWindow = completionWindow([daily], SAT);
t('window ends today', plainWindow.to === SAT);
t('window reaches back the standard span',
  plainWindow.from === shiftDays(SAT, -COMPLETION_WINDOW_DAYS));

// Without this stretch, a task due long ago and ticked off the same day
// would come back with its tick out of range, read as never done, and
// sit in the overdue list forever.
const ancient = { id: 'old', recurrence: 'none', dueDate: '2026-01-05' };
const stretched = completionWindow([daily, ancient], SAT);
t('window stretches back to cover an old open one-off', stretched.from === '2026-01-05');
t('a STOPPED old one-off does not stretch the window',
  completionWindow([{ ...ancient, active: false }], SAT).from === shiftDays(SAT, -COMPLETION_WINDOW_DAYS));
t('an old RECURRING task does not stretch the window',
  completionWindow([{ ...daily, startsOn: '2026-01-05' }], SAT).from === shiftDays(SAT, -COMPLETION_WINDOW_DAYS));

console.log('=== labels ===');
t('one-off label', recurrenceLabel(oneOff) === 'One-off');
t('daily label', recurrenceLabel(daily) === 'Every day');
t('weekdays label', recurrenceLabel(weekdays) === 'Mon-Fri');
t('weekly names the day', recurrenceLabel(weekly) === 'Every Tuesday');
t('isRecurring tells the two kinds apart', !isRecurring(oneOff) && isRecurring(daily));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
