import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_DEPARTMENTS, department, categoryLabel, isCategory, costSummary, totals, byDepartment, byCategory, byStageCaught, byJob } from '../../shared/errors.js';

const e = (over) => ({ jobId: 'j1', jobNumber: 'J-1', department: 'engineering', category: 'wrong_dimension',
                       status: 'Open', reworkHours: null, causedDelay: false, scrapped: false, foundAtStage: 'layout', ...over });

test('vocabulary: each department has categories; unknowns fall back', () => {
  for(const d of ERROR_DEPARTMENTS) assert.ok(d.categories.length && d.color);
  assert.equal(department('shipping').id, 'other');
  assert.equal(categoryLabel('engineering', 'retired_category'), 'retired_category');
  assert.ok(isCategory('purchasing', 'wrong_part'));
  assert.ok(!isCategory('engineering', 'wrong_part'), 'a category from the wrong department is refused');
});

test('cost summary names only what was recorded', () => {
  assert.equal(costSummary(e({})), '');
  assert.equal(costSummary(e({ reworkHours: 2, scrapped: true, causedDelay: true })), '2 h rework · material scrapped · delayed the job');
});

test('totals sum only timed errors and count each job once', () => {
  const t = totals([e({ reworkHours: 1.5 }), e({ reworkHours: 0.25, status: 'Corrected' }), e({ jobId: 'j2' })]);
  assert.deepEqual([t.total, t.open, t.corrected, t.reworkHours, t.timedCount, t.jobsAffected], [3, 2, 1, 1.75, 2, 2]);
  assert.deepEqual(totals([]).reworkHours, 0);
});

test('department rows follow the vocabulary order and add up', () => {
  const list = [e({}), e({ department: 'purchasing', category: 'wrong_part' })];
  const rows = byDepartment(list);
  assert.deepEqual(rows.map(r => r.id), ERROR_DEPARTMENTS.map(d => d.id));
  assert.equal(rows.reduce((n, r) => n + r.total, 0), list.length);
});

test('categories: commonest first, same id under two departments stays two rows', () => {
  const list = [e({}), e({}), e({ department: 'other', category: 'other' }), e({ category: 'other' })];
  const rows = byCategory(list);
  assert.equal(rows[0].category, 'wrong_dimension');
  assert.equal(rows[0].count, 2);
  assert.equal(rows.filter(r => r.category === 'other').length, 2);
  assert.equal(byCategory(list, 1).length, 1);
});

test('stage caught: stage order, empty stages dropped, unknown kept', () => {
  const rows = byStageCaught([e({ foundAtStage: 'final' }), e({ foundAtStage: 'ready' }), e({ foundAtStage: 'nowhere' })]);
  assert.deepEqual(rows.map(r => r.id), ['ready', 'final', 'unknown']);
});

test('jobs: worst first, deleted jobs still counted', () => {
  const rows = byJob([e({}), e({}), e({ jobId: 'j2', jobNumber: 'J-2' }), e({ jobId: null, jobNumber: '' })]);
  assert.equal(rows[0].jobNumber, 'J-1');
  assert.equal(rows[0].count, 2);
  assert.ok(rows.some(r => r.jobNumber === '(job deleted)'));
});
