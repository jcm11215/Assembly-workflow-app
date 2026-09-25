// The Home dashboard's numbers: shared filters, each chart counted
// without its own filter, and the completed-per-week series.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dashboard, dueBucket, describeFilters, NO_FILTERS, UNASSIGNED } from '../../web/lib/dashboard.js';

const TODAY = '2026-09-23'; // a Wednesday
const job = over => ({ id: 'j', jobNumber: 'J', customer: 'Acme', stage: 'layout', priority: 'Medium', dueDate: '2026-10-30',
  assignedTo: 'u1', assignedName: 'Dana Reyes', percentComplete: 0, completedAt: '', ...over });

const jobs = [
  job({ id: 'a', dueDate: '2026-09-20' }),                                  // layout, overdue, Dana
  job({ id: 'b', dueDate: '2026-09-27', priority: 'High' }),               // layout, due in 7 days
  job({ id: 'c', stage: 'drive', assignedTo: 'u2', assignedName: 'Sam Ortiz' }), // drive, later
  job({ id: 'd', stage: 'ready', dueDate: '', assignedTo: null, assignedName: '' }), // no date, unassigned
  job({ id: 'e', stage: 'complete', completedAt: '2026-09-22T15:00:00Z' }),
  job({ id: 'f', stage: 'complete', completedAt: '2026-09-10T15:00:00Z', assignedTo: 'u2' })
];
const blockers = [{ jobId: 'c', status: 'Open' }, { jobId: 'a', status: 'Resolved' }];

test('due buckets', () => {
  assert.equal(dueBucket(job({ dueDate: '2026-09-22' }), TODAY), 'overdue');
  assert.equal(dueBucket(job({ dueDate: '2026-09-23' }), TODAY), 'd7');
  assert.equal(dueBucket(job({ dueDate: '2026-09-30' }), TODAY), 'd7');
  assert.equal(dueBucket(job({ dueDate: '2026-10-01' }), TODAY), 'd14');
  assert.equal(dueBucket(job({ dueDate: '2026-10-23' }), TODAY), 'd30');
  assert.equal(dueBucket(job({ dueDate: '2026-10-24' }), TODAY), 'later');
  assert.equal(dueBucket(job({ dueDate: '' }), TODAY), 'none');
});

test('with no filters: every open job, split by stage, lead and due date', () => {
  const d = dashboard(jobs, blockers, NO_FILTERS, TODAY);
  assert.deepEqual(d.tiles, { open: 4, soon: 1, overdue: 1, blocked: 1 });
  assert.deepEqual(d.jobs.slice(0, 2).map(j => j.id), ['a', 'c'], 'overdue first, then blocked');
  const layout = d.stages.find(s => s.id === 'layout');
  assert.deepEqual(layout.values, { overdue: 1, soon: 1, later: 0 });
  assert.equal(d.stages.length, 7, 'every open stage, empty ones too');
  assert.deepEqual(d.leads.map(l => [l.label, l.total]), [['Dana Reyes', 2], ['Sam Ortiz', 1], ['Unassigned', 1]]);
  assert.deepEqual(d.due.map(b => b.value), [1, 1, 0, 0, 1, 1]);
  assert.deepEqual(d.leadOptions.map(o => o.id), ['u1', 'u2', UNASSIGNED]);
});

test('a chart keeps all its bars when one is picked; the rest narrow to it', () => {
  const d = dashboard(jobs, blockers, { ...NO_FILTERS, stage: 'layout' }, TODAY);
  assert.deepEqual(d.jobs.map(j => j.id).sort(), ['a', 'b']);
  assert.equal(d.stages.find(s => s.id === 'drive').total, 1, 'the stage chart ignores its own filter');
  assert.deepEqual(d.leads.map(l => l.label), ['Dana Reyes']);
  assert.deepEqual(d.tiles, { open: 2, soon: 1, overdue: 1, blocked: 0 });

  const lead = dashboard(jobs, blockers, { ...NO_FILTERS, lead: UNASSIGNED }, TODAY);
  assert.deepEqual(lead.jobs.map(j => j.id), ['d']);
  assert.equal(lead.leads.length, 3, 'the lead chart ignores its own filter');

  const late = dashboard(jobs, blockers, { ...NO_FILTERS, due: 'overdue', priority: 'Medium' }, TODAY);
  assert.deepEqual(late.jobs.map(j => j.id), ['a']);
  assert.equal(late.tiles.soon, 0, 'the High-priority job due soon is filtered out');
});

test('completed per week: this week last, lead and priority filters apply', () => {
  const d = dashboard(jobs, blockers, NO_FILTERS, TODAY);
  assert.equal(d.completed.length, 8);
  assert.deepEqual(d.completed.at(-1), { id: '2026-09-21', label: 'This week', value: 1, current: true });
  assert.equal(d.completed.at(-3).value, 1, 'the week of Sep 7');
  const sam = dashboard(jobs, blockers, { ...NO_FILTERS, lead: 'u2' }, TODAY);
  assert.deepEqual(sam.completed.map(w => w.value), [0, 0, 0, 0, 0, 1, 0, 0]);
});

test('filters in words', () => {
  const words = describeFilters({ lead: 'u1', priority: 'High', stage: 'qc', due: 'd7', blocked: true }, [{ id: 'u1', label: 'Dana Reyes' }]);
  assert.deepEqual(words.map(w => w.label), ['Stage: Ready for QC', 'Due: Next 7 days', 'Blocked', 'Lead: Dana Reyes', 'High priority']);
});
