// The app's own logic, without a browser: job selectors, the store's
// out-of-order guard, the assistant's parse/permission/rule checks, and a
// whole scan through the pipeline with the AI endpoint stood in for.
import './stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setState, getState } from '../../web/lib/store.js';
import { applyJob } from '../../web/lib/actions.js';
import { dueStatus, metrics, focusOrder, jobFilters } from '../../web/lib/jobs.js';
import { parseActions, propose } from '../../web/assistant/plan.js';
import { readDrawing, scanSummary } from '../../web/scan/pipeline.js';
import { PROCEDURE, STAGE_STEPS } from '../../shared/procedure.js';

const TODAY = '2026-09-22';
const job = (over) => ({ id: 'j1', jobNumber: 'J-1', customer: 'Acme', stage: 'ready', priority: 'Medium', dueDate: '2026-10-30',
                         percentComplete: 0, checklist: {}, version: 1, rev: 1, assignedName: '', blueprint: null, ...over });

/* ---------------- selectors ---------------- */

test('due status: overdue, soon, ok, complete', () => {
  assert.equal(dueStatus(job({ dueDate: '2026-09-20' }), TODAY), 'overdue');
  assert.equal(dueStatus(job({ dueDate: '2026-09-24' }), TODAY), 'soon');
  assert.equal(dueStatus(job({}), TODAY), 'ok');
  assert.equal(dueStatus(job({ stage: 'complete', dueDate: '2026-01-01' }), TODAY), 'complete');
  assert.equal(dueStatus(job({ dueDate: '' }), TODAY), 'ok');
});

test('metrics and filters agree; blocked counts jobs, not blockers', () => {
  const jobs = [job({ id: 'a', dueDate: '2026-09-20' }), job({ id: 'b', stage: 'layout', dueDate: '2026-09-25' }), job({ id: 'c', stage: 'complete' })];
  const blockers = [{ jobId: 'a', status: 'Open' }, { jobId: 'a', status: 'In Progress' }, { jobId: 'b', status: 'Resolved' }];
  const m = metrics(jobs, blockers, TODAY);
  assert.deepEqual(m, { open: 2, inProgress: 1, ready: 1, blocked: 1, dueThisWeek: 1, overdue: 1 });
  assert.deepEqual(Object.fromEntries(jobFilters(blockers, TODAY).map(x => [x.id, jobs.filter(x.test).length])).open, 2);
  const f = Object.fromEntries(jobFilters(blockers, TODAY).map(x => [x.id, jobs.filter(x.test).map(j => j.id)]));
  assert.deepEqual(f.blocked, ['a']);
  assert.deepEqual(f.overdue, ['a']);
  assert.deepEqual(f.week, ['b']);
});

test('focus puts an overdue, blocked job first and leaves complete jobs out', () => {
  const jobs = [job({ id: 'a', priority: 'High' }), job({ id: 'b', dueDate: '2026-09-10' }), job({ id: 'c', stage: 'complete' })];
  const order = focusOrder(jobs, [{ jobId: 'b', status: 'Open' }], TODAY).map(j => j.id);
  assert.deepEqual(order, ['b', 'a']);
});

/* ---------------- the store ---------------- */

test('an older copy of a job never overwrites a newer one', () => {
  setState({ jobs: [job({ rev: 5, percentComplete: 50 })] });
  applyJob(job({ rev: 4, percentComplete: 10 }));
  assert.equal(getState().jobs[0].percentComplete, 50);
  applyJob(job({ rev: 6, percentComplete: 60 }));
  assert.equal(getState().jobs[0].percentComplete, 60);
});

/* ---------------- the assistant ---------------- */

test('parseActions keeps known actions, drops unknown fields, reports the rest', () => {
  const r = parseActions('```json\n[{"action":"advance_stage","jobNumber":"J-1","sneaky":1},{"action":"launch_rocket"},{"action":"create_blocker","jobNumber":"J-1"},{"action":"unsupported","reason":"a question"}]\n```');
  assert.deepEqual(r.steps, [{ action: 'advance_stage', params: { jobNumber: 'J-1' } }]);
  assert.equal(r.skipped.length, 3);
  assert.ok(parseActions('not json').error);
});

function aiReplies(fn){
  globalThis.fetch = async (url, opt) => {
    const body = JSON.parse(opt.body);
    const text = fn(body.system, body.content);
    return new Response(JSON.stringify({ text }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

test('proposals are checked against role and the stage rule before anything runs', async () => {
  setState({
    me: { id: 'u1', fullName: 'Tim', role: 'trainee' },
    team: [{ id: 'u1', fullName: 'Tim', role: 'trainee', active: true }],
    jobs: [job({ stage: 'testing' }), job({ id: 'j2', jobNumber: 'J-2', stage: 'ready' })],
    blockers: [], notes: [], errors: []
  });
  aiReplies(() => JSON.stringify([
    { action: 'advance_stage', jobNumber: 'J-1' },          // testing -> qc: trainee may not sign off
    { action: 'advance_stage', jobNumber: 'J-2' },          // checklist unfinished
    { action: 'assign_job', jobNumber: 'J-2', assignee: 'Tim' },   // admins only
    { action: 'create_note', jobNumber: 'J-2', notes: 'Started troughs' }
  ]));
  const plan = await propose('do things');
  const [signoff, gated, assign, note] = plan.steps;
  assert.match(signoff.reason, /Trainees/);
  assert.match(gated.reason, /checklist is 0\/10/);
  assert.match(assign.reason, /role/);
  assert.equal(note.blocked, false);
  assert.equal(note.preview, 'Add a Progress note to J-2: "Started troughs".');
  assert.ok(plan.runnable);
});

test('a checklist item is found by its own wording', async () => {
  setState({ me: { id: 'u1', role: 'assembler' }, jobs: [job({})] });
  aiReplies(() => JSON.stringify([{ action: 'toggle_checklist', jobNumber: 'j-1', item: 'inspect all components for damage' }]));
  const plan = await propose('tick it');
  assert.equal(plan.steps[0].blocked, false);
  assert.equal(plan.steps[0].resolved.key, `${STAGE_STEPS.ready[0]}-3`);
  assert.ok(PROCEDURE[0].items[3].startsWith('Inspect all components'));
});

/* ---------------- a whole scan ---------------- */

const REPLIES = {
  classify: JSON.stringify({ pages: [{ page: 1, view: 'general_assembly' }, { page: 2, view: 'bom' }] }),
  parts: JSON.stringify({
    jobNumber: '2024-017H', customer: 'EARTHCARE LLC',
    parts: [
      { balloon: 3, item: 'Motor', item_as_drawn: 'GEARMOTOR, 5HP', quantity: 1, installation_location: 'drive_end', source_page: 2, extraction_method: 'bom_table', confidence: 0.9 },
      { balloon: 7, item: 'Hanger Bearing', quantity: 2, installation_location: 'hanger', source_page: 2, extraction_method: 'bom_table', confidence: 0.9 },
      { balloon: 5, item: 'Bearing', item_as_drawn: 'FLG BRG 2-7/16', quantity: 2, installation_location: 'unknown', source_page: 2, extraction_method: 'bom_table', confidence: 0.9 },
      { balloon: 4, item: 'Trough Section', quantity: 4, installation_location: 'trough', source_page: 2, extraction_method: 'bom_table', confidence: 0.9 }
    ]
  }),
  callouts: JSON.stringify({ callouts: [
    { balloon: 3, source_page: 1, position: { x: 0.86, y: 0.42 }, confidence: 0.9 },
    { balloon: 7, source_page: 1, position: { x: 0.38, y: 0.5 }, confidence: 0.9 },
    { balloon: 5, source_page: 1, position: { x: 0.12, y: 0.5 }, end: 'tail_end', confidence: 0.9 },
    { balloon: 5, source_page: 1, position: { x: 0.55, y: 0.5 }, end: 'drive_end', confidence: 0.9 }
  ]}),
  // Carries the bad escape that sank a real scan.
  layout: '{"jobNumber":"2024-017H","description":"12\\" DIA X 20\\\' LG","orientation":{"drive_end_side":"right"}}'
};

test('a two-sheet drawing reads into located parts and a title block', async () => {
  const seen = [];
  let calloutPrompt = '';
  aiReplies((system) => {
    const which = /classify which kind of page/i.test(system) ? 'classify'
      : /BALLOON CALLOUT is a small circle/i.test(system) ? 'callouts'
      : /transcribe the parts table/i.test(system) ? 'parts' : 'layout';
    if(which === 'callouts') calloutPrompt = system;
    seen.push(which);
    return REPLIES[which];
  });
  const img = n => [{ type: 'text', text: `PDF page ${n}:` }, { type: 'image', source: { media_type: 'image/jpeg', data: `PAGE${n}` } }];
  const result = await readDrawing([...img(1), ...img(2)], { includeJobFields: true });

  // Parts before balloons: the balloon search is asked for exactly the
  // table's item numbers, knowing which side the drive is on.
  assert.ok(seen.indexOf('callouts') > seen.indexOf('parts'), 'balloons are looked for after the table is read');
  assert.deepEqual([...seen].sort(), ['callouts', 'classify', 'layout', 'parts']);
  assert.match(calloutPrompt, /- 3: GEARMOTOR, 5HP/);
  assert.match(calloutPrompt, /drive end of this conveyor is on the RIGHT/);
  assert.equal(result.titleBlock.jobNumber, '2024-017H');
  assert.equal(result.titleBlock.customer, 'EARTHCARE LLC');
  const motor = result.components.find(c => c.item === 'Motor');
  assert.deepEqual(motor.position, { x: 0.86, y: 0.42 });
  assert.equal(motor.source_page, 1);
  assert.ok(!result.components.some(c => /trough/i.test(c.item)), 'trough sections are not tracked parts');
  // The balloon search's own call on each end beats page thirds (x 0.55
  // is mid-page, but it said drive end) -- and parts come sorted the way
  // the parts list groups them: drive end, tail end, then the run.
  assert.deepEqual(result.components.map(c => [c.item, c.installation_location]), [
    ['Motor', 'drive_end'], ['Bearing', 'drive_end'], ['Bearing', 'tail_end'], ['Hanger Bearing', 'hanger']
  ]);
  assert.ok(!result.components.some(c => 'drawn_end' in c), 'working fields are not saved');
  assert.match(scanSummary(result.components, result.diagnostics), /^Found \d+ parts/);
});

test('a scan where every reading fails is an error, not an empty drawing', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'API key not valid', code: 'ai_failed' }),
    { status: 502, headers: { 'Content-Type': 'application/json' } });
  const img = [{ type: 'image', source: { media_type: 'image/jpeg', data: 'OTHER' } }];
  await assert.rejects(readDrawing(img), /API key not valid/);
});
