import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkStageMove, stageProgress, parseChecklistKey, checklistItemLabel, nextStage, prevStage, PROCEDURE, STAGE_STEPS } from '../../shared/procedure.js';
import { can, ROLES } from '../../shared/roles.js';
import { shiftDays, dayOfWeek, daysUntil, isISODate } from '../../shared/dates.js';

const allTicked = stage => Object.fromEntries(STAGE_STEPS[stage].flatMap(s => PROCEDURE[s].items.map((_, i) => [`${s}-${i}`, { by: 'x' }])));

test('a forward move needs the current stage checklist finished', () => {
  const job = { stage: 'ready', checklist: {} };
  assert.equal(checkStageMove(job, 'layout', 'assembler').code, 'checklist');
  assert.ok(checkStageMove({ ...job, checklist: allTicked('ready') }, 'layout', 'assembler').ok);
});

test('stages cannot be skipped, but moving back is always allowed', () => {
  assert.equal(checkStageMove({ stage: 'ready', checklist: allTicked('ready') }, 'bearings', 'admin').code, 'skip');
  assert.ok(checkStageMove({ stage: 'final', checklist: {} }, 'ready', 'trainee').ok);
});

test('sign-off stages need no checklist, but trainees cannot enter QC or Complete', () => {
  assert.ok(checkStageMove({ stage: 'testing', checklist: {} }, 'qc', 'assembler').ok);
  assert.equal(checkStageMove({ stage: 'testing', checklist: {} }, 'qc', 'trainee').code, 'trainee_signoff');
  assert.equal(checkStageMove({ stage: 'qc', checklist: {} }, 'complete', 'trainee').code, 'trainee_signoff');
  assert.ok(checkStageMove({ stage: 'qc', checklist: {} }, 'testing', 'trainee').ok);
});

test('unknown and same-stage moves are refused', () => {
  assert.equal(checkStageMove({ stage: 'ready', checklist: {} }, 'painting', 'admin').code, 'unknown_stage');
  assert.equal(checkStageMove({ stage: 'ready', checklist: {} }, 'ready', 'admin').code, 'same_stage');
});

test('checklist progress counts only the stage\'s own steps', () => {
  assert.deepEqual(stageProgress({}, 'ready'), { done: 0, total: 10 });
  assert.deepEqual(stageProgress({ '0-0': {}, '2-0': {} }, 'ready'), { done: 1, total: 10 });
  assert.deepEqual(stageProgress({}, 'testing'), { done: 0, total: 0 });
});

test('checklist keys are validated against the procedure', () => {
  assert.deepEqual(parseChecklistKey('2-4'), { step: 2, item: 4 });
  assert.equal(parseChecklistKey('2-5'), null);
  assert.equal(parseChecklistKey('9-0'), null);
  assert.equal(parseChecklistKey('x'), null);
  assert.match(checklistItemLabel('2-1'), /^Assemble Troughs \/ Verify proper orientation/);
});

test('next and previous stage stop at the ends', () => {
  assert.equal(nextStage('ready'), 'layout');
  assert.equal(nextStage('complete'), null);
  assert.equal(prevStage('ready'), null);
});

test('roles: only admins manage; everyone works jobs', () => {
  for(const r of ROLES) assert.ok(can(r, 'job.work'));
  assert.ok(can('admin', 'job.manage'));
  assert.ok(!can('assembler', 'job.manage'));
  assert.ok(!can('trainee', 'team.manage'));
  assert.ok(!can('assembler', 'no.such.permission'));
});

test('dates stay on the local calendar', () => {
  assert.equal(dayOfWeek('2026-09-14'), 1);
  assert.equal(shiftDays('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDays('2028-02-28', 1), '2028-02-29');
  assert.equal(daysUntil('2026-09-20', '2026-09-22'), -2);
  assert.ok(isISODate('2026-02-28'));
  assert.ok(!isISODate('2026-2-8'));
  assert.ok(!isISODate(''));
});
