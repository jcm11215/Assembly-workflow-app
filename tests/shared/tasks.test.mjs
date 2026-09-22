import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDueOn, isOverdue, occurrenceKey, completionWindow, recurrenceLabel, isRecurring, taskProblem, HISTORY_DAYS } from '../../shared/tasks.js';
import { shiftDays } from '../../shared/dates.js';

// A known week: Mon 14 Sep 2026 .. Sun 20 Sep 2026.
const MON = '2026-09-14', TUE = '2026-09-15', WED = '2026-09-16', SAT = '2026-09-19', SUN = '2026-09-20';
const oneOff = { id: 'a', recurrence: 'none', dueDate: WED, active: true };
const daily = { id: 'b', recurrence: 'daily', startsOn: TUE, active: true };
const weekdays = { id: 'c', recurrence: 'weekdays', startsOn: MON, active: true };
const weekly = { id: 'd', recurrence: 'weekly', weekday: 2, startsOn: MON, active: true };

test('a one-off is due on its date only, even after it has passed', () => {
  assert.ok(isDueOn(oneOff, WED));
  assert.ok(!isDueOn(oneOff, TUE));
  assert.ok(!isDueOn(oneOff, SAT));
});

test('a daily task never reaches back before it was set up', () => {
  assert.ok(isDueOn(daily, TUE));
  assert.ok(isDueOn(daily, SUN));
  assert.ok(!isDueOn(daily, MON));
});

test('weekdays skips the weekend; weekly lands on its day each week', () => {
  assert.ok(isDueOn(weekdays, WED));
  assert.ok(!isDueOn(weekdays, SAT) && !isDueOn(weekdays, SUN));
  assert.ok(isDueOn(weekly, TUE) && !isDueOn(weekly, WED));
  assert.ok(isDueOn(weekly, shiftDays(TUE, 7)));
  assert.ok(isDueOn({ ...weekly, weekday: '2' }, TUE), 'a weekday stored as text still works');
});

test('a stopped task is never due or overdue', () => {
  assert.ok(!isDueOn({ ...daily, active: false }, WED));
  assert.ok(!isOverdue({ ...oneOff, active: false }, new Set(), SAT));
});

test('only an un-ticked one-off from before today is overdue', () => {
  assert.ok(isOverdue(oneOff, new Set(), SAT));
  assert.ok(!isOverdue(oneOff, new Set([occurrenceKey('a', WED)]), SAT));
  assert.ok(!isOverdue(oneOff, new Set(), WED), 'due today is not overdue yet');
  assert.ok(!isOverdue(daily, new Set(), SAT), 'a missed recurring day is history');
});

test('the tick window covers a month, stretched for an old open one-off', () => {
  assert.deepEqual(completionWindow([daily], SAT), { from: shiftDays(SAT, -HISTORY_DAYS), to: SAT });
  assert.equal(completionWindow([{ ...oneOff, dueDate: '2026-01-05' }], SAT).from, '2026-01-05');
  assert.equal(completionWindow([{ ...oneOff, dueDate: '2026-01-05', active: false }], SAT).from, shiftDays(SAT, -HISTORY_DAYS));
});

test('labels and kinds', () => {
  assert.equal(recurrenceLabel(oneOff), 'One-off');
  assert.equal(recurrenceLabel(weekdays), 'Mon-Fri');
  assert.equal(recurrenceLabel(weekly), 'Every Tuesday');
  assert.ok(!isRecurring(oneOff) && isRecurring(daily));
});

test('shape rules name what is missing', () => {
  assert.match(taskProblem({ title: '', recurrence: 'none', dueDate: WED }), /title/);
  assert.match(taskProblem({ title: 'x', recurrence: 'none' }), /day it is due/);
  assert.match(taskProblem({ title: 'x', recurrence: 'weekly', startsOn: MON }), /day of the week/);
  assert.match(taskProblem({ title: 'x', recurrence: 'daily' }), /starts/);
  assert.equal(taskProblem({ title: 'x', recurrence: 'weekly', weekday: 0, startsOn: MON }), null);
});
