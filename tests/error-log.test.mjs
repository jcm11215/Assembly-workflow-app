// The engineering/purchasing error log: its vocabulary, its mapping to
// and from the database, and the cross-job rollup. The rollup is the
// reason the log exists, so its arithmetic is what gets tested hardest --
// a total that double-counts or treats "nobody timed it" as zero would
// send the shop after the wrong department.
import './stub.mjs';
const meta = await import('../src/models/errorMeta.js');
const roll = await import('../src/errors/rollup.js');
const { rowToJobError, jobErrorToRow } = await import('../src/db/mappers.js');

let pass = 0, fail = 0;
const t = (n, fn) => {
  try { fn(); pass++; console.log('  PASS ' + n); }
  catch (e) { fail++; console.log('  FAIL ' + n + ' -> ' + e.constructor.name + ': ' + e.message); }
};
const eq = (a, b, what) => { if (a !== b) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const err = (o) => ({
  id: o.id || 'e' + Math.random(), jobNumber: o.job || 'SC-1', department: o.dept || 'engineering',
  category: o.cat || 'wrong_dimension', description: 'x', foundAtStage: o.stage || 'layout',
  reworkHours: o.hours === undefined ? null : o.hours, causedDelay: !!o.delay,
  scrapped: !!o.scrap, status: o.status || 'Open'
});

console.log('=== the vocabulary ===');
t('every department has categories and a colour', () => {
  for (const d of meta.ERROR_DEPARTMENTS) {
    if (!d.categories.length) throw new Error(d.id + ' has no categories');
    if (!/^#[0-9a-f]{6}$/i.test(d.color)) throw new Error(d.id + ' has no colour');
  }
});
t('the three department ids match what the database will accept', () => {
  // The CHECK constraint on job_errors.department lists exactly these.
  eq(meta.ERROR_DEPARTMENTS.map(d => d.id).join(), 'engineering,purchasing,other', 'ids');
});
t('an unknown department falls back rather than throwing', () => {
  eq(meta.errorDepartmentLabel('shipping'), 'Other', 'label');
  if (!meta.errorDepartmentColor('nonsense')) throw new Error('no colour');
});
t('a category from a later-removed vocabulary still reads as something', () => {
  eq(meta.errorCategoryLabel('engineering', 'some_old_id'), 'some_old_id', 'label');
});
t('validators refuse a category from the wrong department', () => {
  // A purchasing error cannot be a "wrong dimension on the drawing".
  if (meta.isErrorCategory('purchasing', 'wrong_dimension')) throw new Error('accepted a mismatched category');
  if (!meta.isErrorCategory('purchasing', 'wrong_part')) throw new Error('refused a valid one');
  if (meta.isErrorDepartment('shipping')) throw new Error('accepted an unknown department');
});
t('the cost summary names only what was recorded', () => {
  eq(meta.errorCostSummary(err({ hours: 2.5, delay: true })), '2.5 h rework · delayed the job', 'both');
  eq(meta.errorCostSummary(err({})), '', 'nothing recorded reads as nothing');
});

console.log('\n=== database mapping ===');
t('an untimed rework field stays null, not zero', () => {
  // "Nobody timed it" and "it cost nothing" are different answers, and
  // averaging them together understates what errors cost.
  eq(jobErrorToRow({ reworkHours: '' }).rework_hours, null, 'empty string');
  eq(jobErrorToRow({ reworkHours: null }).rework_hours, null, 'null');
  eq(jobErrorToRow({ reworkHours: 'abc' }).rework_hours, null, 'unparseable');
  eq(jobErrorToRow({ reworkHours: '0' }).rework_hours, 0, 'a real zero is kept');
  eq(jobErrorToRow({ reworkHours: '2.5' }).rework_hours, 2.5, 'a number');
});
t('corrected_at is never sent from the app', () => {
  // It has to agree with status or the row CHECK rejects it, so the DB
  // trigger owns it.
  if ('corrected_at' in jobErrorToRow({ status: 'Corrected' })) throw new Error('app tried to set corrected_at');
});
t('checkbox flags become real booleans', () => {
  const row = jobErrorToRow({ causedDelay: 'on', scrapped: undefined });
  eq(row.caused_delay, true, 'checked');
  eq(row.scrapped, false, 'unchecked');
});
t('a row round-trips back to the shape the UI reads', () => {
  const e = rowToJobError({
    id: 'e1', job_id: 'j1', job_number: 'SC-4472', department: 'purchasing', category: 'wrong_part',
    description: 'Wrong bore', found_at_stage: 'bearings', rework_hours: '3.25', caused_delay: true,
    scrapped: false, status: 'Open', reported_at: '2026-09-01T10:00:00Z', reported_by_name: 'Dana'
  });
  eq(e.jobNumber, 'SC-4472', 'job number');
  eq(e.reworkHours, 3.25, 'hours come back as a number');
  eq(e.dateReported, '2026-09-01', 'date');
  eq(e.reportedBy, 'Dana', 'reporter');
});
t('a missing department defaults rather than becoming undefined', () => {
  eq(rowToJobError({ id: 'e1' }).department, 'other', 'department');
  eq(rowToJobError({ id: 'e1' }).foundAtStage, 'unknown', 'stage');
});

console.log('\n=== totals ===');
const sample = [
  err({ id: 'a', dept: 'engineering', cat: 'wrong_dimension', stage: 'layout',   hours: 2,    job: 'SC-1' }),
  err({ id: 'b', dept: 'engineering', cat: 'wrong_dimension', stage: 'final',    hours: 4.5,  job: 'SC-1', delay: true, status: 'Corrected' }),
  err({ id: 'c', dept: 'engineering', cat: 'missing_detail',  stage: 'layout',   job: 'SC-2' }),
  err({ id: 'd', dept: 'purchasing',  cat: 'wrong_part',      stage: 'bearings', hours: 1.25, job: 'SC-2', scrap: true }),
  err({ id: 'e', dept: 'purchasing',  cat: 'wrong_part',      stage: 'unknown',  job: 'SC-3', status: 'Corrected' })
];

t('counts open and corrected without overlap', () => {
  const tot = roll.errorTotals(sample);
  eq(tot.total, 5, 'total');
  eq(tot.open, 3, 'open');
  eq(tot.corrected, 2, 'corrected');
  eq(tot.open + tot.corrected, tot.total, 'the two must add to the total');
});
t('sums only the errors somebody timed, and says how many that was', () => {
  const tot = roll.errorTotals(sample);
  eq(tot.reworkHours, 7.75, 'hours');
  eq(tot.timedCount, 3, 'timed count -- so 7.75 h is not read as the cost of all five');
});
t('counts each affected job once', () => {
  eq(roll.errorTotals(sample).jobsAffected, 3, 'jobs');
});
t('counts delays and scrap separately', () => {
  const tot = roll.errorTotals(sample);
  eq(tot.delayed, 1, 'delayed');
  eq(tot.scrapped, 1, 'scrapped');
});
t('an empty log totals to zero rather than NaN', () => {
  const tot = roll.errorTotals([]);
  eq(tot.total, 0, 'total');
  eq(tot.reworkHours, 0, 'hours');
  eq(tot.jobsAffected, 0, 'jobs');
});
t('a missing list is treated as empty', () => {
  eq(roll.errorTotals(null).total, 0, 'total');
  eq(roll.byDepartment(null).length, meta.ERROR_DEPARTMENTS.length, 'departments still listed');
  eq(roll.byCategory(null).length, 0, 'categories');
});

console.log('\n=== by department ===');
t('splits the log by department and keeps the vocabulary order', () => {
  const rows = roll.byDepartment(sample);
  eq(rows.map(r => r.id).join(), 'engineering,purchasing,other', 'order is fixed, not by count');
  eq(rows[0].total, 3, 'engineering');
  eq(rows[1].total, 2, 'purchasing');
  eq(rows[2].total, 0, 'other');
});
t('department totals add up to the whole log', () => {
  eq(roll.byDepartment(sample).reduce((n, r) => n + r.total, 0), sample.length, 'sum');
});
t('each department carries its own rework hours', () => {
  const rows = roll.byDepartment(sample);
  eq(rows[0].reworkHours, 6.5, 'engineering');
  eq(rows[1].reworkHours, 1.25, 'purchasing');
});

console.log('\n=== what we get wrong most ===');
t('commonest category first, and empty ones left out', () => {
  const rows = roll.byCategory(sample);
  eq(rows.length, 3, 'only categories actually hit');
  eq(rows[0].count, 2, 'top count');
  if (!['wrong_dimension', 'wrong_part'].includes(rows[0].category)) throw new Error('wrong top row');
});
t('the same category under two departments stays two rows', () => {
  // "Something else" means different things in engineering and purchasing.
  const rows = roll.byCategory([
    err({ dept: 'engineering', cat: 'other' }), err({ dept: 'purchasing', cat: 'other' })
  ]);
  eq(rows.length, 2, 'rows');
});
t('carries the readable label and its department', () => {
  const row = roll.byCategory([err({ dept: 'purchasing', cat: 'ordered_late' })])[0];
  eq(row.label, 'Ordered too late', 'label');
  eq(row.departmentLabel, 'Purchasing', 'department');
});
t('a limit takes the top rows, not an arbitrary slice', () => {
  const rows = roll.byCategory(sample, 1);
  eq(rows.length, 1, 'length');
  eq(rows[0].count, 2, 'kept the commonest');
});

console.log('\n=== where they get caught ===');
t('stage order, not count order -- the shape of the run matters', () => {
  const rows = roll.byStageCaught(sample);
  eq(rows.map(r => r.id).join(), 'layout,bearings,final,unknown', 'order');
});
t('stages nobody caught anything at are left out', () => {
  const rows = roll.byStageCaught([err({ stage: 'final' })]);
  eq(rows.length, 1, 'one row');
  eq(rows[0].label, 'Final Assembly', 'label');
});
t('an unrecognised stage lands in "not recorded" rather than vanishing', () => {
  const rows = roll.byStageCaught([err({ stage: 'nonsense' })]);
  eq(rows.length, 1, 'row kept');
  eq(rows[0].id, 'unknown', 'bucket');
});
t('stage counts add up to the whole log', () => {
  eq(roll.byStageCaught(sample).reduce((n, r) => n + r.count, 0), sample.length, 'sum');
});
t('repeated calls do not accumulate counts', () => {
  // The stage rows are rebuilt per call; a shared array would double.
  roll.byStageCaught(sample);
  eq(roll.byStageCaught(sample).reduce((n, r) => n + r.count, 0), sample.length, 'still the same total');
});

console.log('\n=== jobs with the most ===');
t('worst job first, with its open count', () => {
  const rows = roll.byJob(sample);
  eq(rows[0].jobNumber, 'SC-1', 'worst');
  eq(rows[0].count, 2, 'count');
  eq(rows[0].open, 1, 'open');
});
t('an error whose job was deleted is still counted, not dropped', () => {
  const rows = roll.byJob([{ jobNumber: '', status: 'Open' }]);
  eq(rows[0].jobNumber, '(job deleted)', 'label');
});

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
