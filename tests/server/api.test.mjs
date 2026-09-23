import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './harness.mjs';
import { PROCEDURE, STAGE_STEPS } from '../../shared/procedure.js';

let srv, admin, assembler, trainee;

before(async () => {
  srv = await startServer();
  admin = await srv.user('boss', 'admin', 'Boss Person');
  assembler = await srv.user('dana', 'assembler', 'Dana A');
  trainee = await srv.user('tim', 'trainee', 'Tim B');
});
after(() => srv.close());

async function newJob(fields = {}){
  const res = await admin.post('/api/jobs', { jobNumber: `J-${Math.random().toString(36).slice(2, 8)}`, customer: 'Acme', ...fields });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data.job;
}

async function tickStage(c, job, stage){
  let latest = job;
  for(const step of STAGE_STEPS[stage]){
    for(let i = 0; i < PROCEDURE[step].items.length; i++){
      const res = await c.put(`/api/jobs/${job.id}/checklist/${step}-${i}`, { done: true });
      assert.equal(res.status, 200);
      latest = res.data.job;
    }
  }
  return latest;
}

/* ---------------- sessions ---------------- */

test('signed-out requests are refused', async () => {
  const res = await srv.client().get('/api/state');
  assert.equal(res.status, 401);
});

test('writes without the app header are refused', async () => {
  const res = await assembler.raw('POST', '/api/blockers', { jobId: 'x' }, { 'X-Requested-With': '' });
  assert.equal(res.status, 403);
});

test('a wrong password is refused, and repeated misses lock the login', async () => {
  const c = srv.client();
  for(let i = 0; i < 8; i++){
    const res = await c.post('/api/session', { login: 'dana', password: 'nope-nope' });
    assert.equal(res.status, 401);
  }
  const locked = await c.post('/api/session', { login: 'dana', password: 'correct horse battery' });
  assert.equal(locked.status, 429);
});

test('state carries everything the app shows', async () => {
  const res = await assembler.get('/api/state');
  assert.equal(res.status, 200);
  for(const k of ['me', 'team', 'jobs', 'blockers', 'notes', 'errors', 'tasks', 'completions', 'ai']) assert.ok(k in res.data, k);
  assert.equal(res.data.me.login, 'dana');
});

test('sign-up needs a live access code and makes a trainee', async () => {
  const c = srv.client();
  const bad = await c.post('/api/signup', { fullName: 'New Person', login: 'newbie', password: 'password123', accessCode: 'WRONG' });
  assert.equal(bad.status, 400);
  const made = await admin.post('/api/admin/codes', { label: 'test' });
  const ok = await c.post('/api/signup', { fullName: 'New Person', login: 'newbie', password: 'password123', accessCode: made.data.code });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.user.role, 'trainee');
  assert.equal((await c.get('/api/state')).status, 200);
});

/* ---------------- jobs ---------------- */

test('only admins create jobs; job numbers are unique', async () => {
  const denied = await assembler.post('/api/jobs', { jobNumber: 'X-1' });
  assert.equal(denied.status, 403);
  const job = await newJob({ jobNumber: 'DUP-1' });
  assert.equal(job.stage, 'ready');
  const dup = await admin.post('/api/jobs', { jobNumber: 'dup-1' });
  assert.equal(dup.status, 409);
});

test('an edit based on an old version is refused with the current job', async () => {
  const job = await newJob();
  const first = await admin.patch(`/api/jobs/${job.id}`, { version: job.version, customer: 'First' });
  assert.equal(first.status, 200);
  const stale = await admin.patch(`/api/jobs/${job.id}`, { version: job.version, customer: 'Second' });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.code, 'stale');
  assert.equal(stale.data.job.customer, 'First');
});

test('assemblers may update progress but not job details', async () => {
  const job = await newJob();
  const details = await assembler.patch(`/api/jobs/${job.id}`, { version: job.version, customer: 'Nope' });
  assert.equal(details.status, 403);
  const pct = await assembler.patch(`/api/jobs/${job.id}`, { version: job.version, percentComplete: 40 });
  assert.equal(pct.status, 200);
  assert.equal(pct.data.job.percentComplete, 40);
});

test('stage moves: checklist gate, no skipping, backwards always allowed', async () => {
  let job = await newJob();
  const gated = await assembler.post(`/api/jobs/${job.id}/stage`, { from: 'ready', to: 'layout' });
  assert.equal(gated.status, 400);
  assert.equal(gated.data.code, 'checklist');

  const skip = await assembler.post(`/api/jobs/${job.id}/stage`, { from: 'ready', to: 'bearings' });
  assert.equal(skip.status, 400);

  job = await tickStage(assembler, job, 'ready');
  assert.equal(job.checklist['0-0'].by, 'Dana A');
  const moved = await assembler.post(`/api/jobs/${job.id}/stage`, { from: 'ready', to: 'layout' });
  assert.equal(moved.status, 200);
  assert.equal(moved.data.job.stage, 'layout');
  assert.equal(moved.data.job.percentComplete, 15);
  assert.equal(moved.data.job.lastMovedByName, 'Dana A');

  const stale = await trainee.post(`/api/jobs/${job.id}/stage`, { from: 'ready', to: 'layout' });
  assert.equal(stale.status, 409);

  const back = await trainee.post(`/api/jobs/${job.id}/stage`, { from: 'layout', to: 'ready' });
  assert.equal(back.status, 200);
});

test('trainees cannot sign a job into QC; assemblers can', async () => {
  const job = await newJob();
  srv.db.run("update jobs set stage = 'testing' where id = ?", job.id);
  const denied = await trainee.post(`/api/jobs/${job.id}/stage`, { from: 'testing', to: 'qc' });
  assert.equal(denied.status, 400);
  assert.equal(denied.data.code, 'trainee_signoff');
  const ok = await assembler.post(`/api/jobs/${job.id}/stage`, { from: 'testing', to: 'qc' });
  assert.equal(ok.status, 200);
});

test('deleting a job removes its blockers and notes, admin only', async () => {
  const job = await newJob();
  await assembler.post('/api/blockers', { jobId: job.id, issue: 'Missing bearing' });
  await assembler.post('/api/notes', { jobId: job.id, entries: [{ type: 'Progress', body: 'Started' }] });
  assert.equal((await assembler.delete(`/api/jobs/${job.id}`)).status, 403);
  assert.equal((await admin.delete(`/api/jobs/${job.id}`)).status, 200);
  const state = (await admin.get('/api/state')).data;
  assert.ok(!state.jobs.some(j => j.id === job.id));
  assert.ok(!state.blockers.some(b => b.jobId === job.id));
  assert.ok(!state.notes.some(n => n.jobId === job.id));
});

/* ---------------- blockers, notes, errors ---------------- */

test('anyone reports a blocker; only admins resolve it', async () => {
  const job = await newJob();
  const made = await trainee.post('/api/blockers', { jobId: job.id, issue: 'Wrong gearbox', severity: 'High' });
  assert.equal(made.status, 201);
  assert.equal(made.data.blocker.reportedByName, 'Tim B');
  const denied = await trainee.patch(`/api/blockers/${made.data.blocker.id}`, { status: 'Resolved' });
  assert.equal(denied.status, 403);
  const ok = await admin.patch(`/api/blockers/${made.data.blocker.id}`, { status: 'Resolved' });
  assert.equal(ok.data.blocker.status, 'Resolved');
  assert.equal(ok.data.blocker.resolvedByName, 'Boss Person');
});

test('a note form saves each filled box as its own note', async () => {
  const res = await assembler.post('/api/notes', {
    jobId: null, date: '2026-09-01',
    entries: [{ type: 'Progress', body: 'Did a thing' }, { type: 'Issue', body: '' }, { type: 'NextSteps', body: 'Do more' }]
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.notes.length, 2);
  assert.equal(res.data.notes[0].jobNumber, '');
});

test('errors: vocabulary is enforced; closing needs an admin', async () => {
  const job = await newJob();
  const bad = await assembler.post('/api/errors', { jobId: job.id, department: 'engineering', category: 'wrong_part', description: 'x' });
  assert.equal(bad.status, 400);
  const made = await assembler.post('/api/errors', {
    jobId: job.id, department: 'engineering', category: 'wrong_dimension', description: 'Bore drawn 2in, needs 2-7/16', reworkHours: '1.5'
  });
  assert.equal(made.status, 201);
  assert.equal(made.data.error.reworkHours, 1.5);
  assert.equal((await assembler.patch(`/api/errors/${made.data.error.id}`, { status: 'Corrected' })).status, 403);
  const closed = await admin.patch(`/api/errors/${made.data.error.id}`, { status: 'Corrected', correction: 'Re-bored' });
  assert.equal(closed.data.error.status, 'Corrected');
  assert.ok(closed.data.error.correctedAt);
});

/* ---------------- tasks ---------------- */

test('tasks: shape rules, ticking, and who may undo a tick', async () => {
  const noDate = await admin.post('/api/tasks', { title: 'Sweep', recurrence: 'none' });
  assert.equal(noDate.status, 400);
  const made = await admin.post('/api/tasks', { title: 'Sweep bays', recurrence: 'daily', startsOn: '2026-01-01' });
  assert.equal(made.status, 201);
  const id = made.data.task.id;
  const tick = await trainee.put(`/api/tasks/${id}/done/2026-09-10`);
  assert.equal(tick.status, 200);
  assert.equal(tick.data.completion.doneByName, 'Tim B');
  assert.equal((await assembler.delete(`/api/tasks/${id}/done/2026-09-10`)).status, 403);
  assert.equal((await trainee.delete(`/api/tasks/${id}/done/2026-09-10`)).status, 200);
  const early = await trainee.put(`/api/tasks/${id}/done/2025-12-31`);
  assert.equal(early.status, 400);
});

/* ---------------- blueprints ---------------- */

test('a scan saves parts, then its file; both come back', async () => {
  const job = await newJob({ jobNumber: 'BP-100' });
  const denied = await assembler.post(`/api/jobs/${job.id}/blueprints`, { components: [] });
  assert.equal(denied.status, 403);

  const saved = await admin.post(`/api/jobs/${job.id}/blueprints`, {
    fileName: 'GA Drawing.pdf', mimeType: 'application/pdf',
    components: [
      { item: 'Drive shaft', specification: '2-7/16" C1045', quantity: 1, stage: 'drive', installation_location: 'drive_end', position: { x: 0.2, y: 0.3 } },
      { item: 'Hanger bearing', quantity: 3, stage: 'bearings', installation_location: 'hanger', balloon: '7' }
    ]
  });
  assert.equal(saved.status, 201, JSON.stringify(saved.data));
  const bp = saved.data.blueprint;
  assert.equal(bp.version, 1);
  assert.equal(bp.components.length, 2);
  assert.deepEqual(bp.components[0].position, { x: 0.2, y: 0.3 });
  assert.equal(bp.hasFile, false);

  const bytes = new TextEncoder().encode('%PDF-1.4 pretend');
  const up = await admin.put(`/api/blueprints/${bp.id}/file`, bytes, { 'Content-Type': 'application/pdf' });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  assert.equal(up.data.blueprint.hasFile, true);

  const file = await assembler.get(`/api/blueprints/${bp.id}/file`);
  assert.equal(file.status, 200);
  assert.equal(file.data.toString(), '%PDF-1.4 pretend');

  const second = await admin.post(`/api/jobs/${job.id}/blueprints`, { fileName: 'GA Drawing.pdf', mimeType: 'application/pdf', components: [] });
  assert.equal(second.data.blueprint.version, 2);
  const up2 = await admin.put(`/api/blueprints/${second.data.blueprint.id}/file`, bytes, { 'Content-Type': 'application/pdf' });
  assert.equal(up2.status, 200);
  const fs = await import('node:fs');
  assert.ok(fs.existsSync(`${srv.filesDir}/BP-100/GA Drawing.pdf`));
  assert.ok(fs.existsSync(`${srv.filesDir}/BP-100/GA Drawing (v2).pdf`));
});

test('hand-editing parts: add, edit, reorder, remove', async () => {
  const job = await newJob();
  const saved = await admin.post(`/api/jobs/${job.id}/blueprints`, { components: [{ item: 'A' }, { item: 'B' }] });
  const bpId = saved.data.blueprint.id;
  const added = await admin.post(`/api/blueprints/${bpId}/components`, { item: 'C', quantity: 2, stage: 'tail' });
  assert.equal(added.status, 201);
  assert.equal(added.data.component.installation_location, 'tail_end');
  assert.equal(added.data.component.extraction_method, 'manual');
  const edited = await admin.patch(`/api/components/${added.data.component.id}`, { stage: 'drive' });
  assert.equal(edited.data.component.installation_location, 'drive_end');

  const [a, b] = saved.data.blueprint.components;
  await admin.put(`/api/blueprints/${bpId}/order`, { ids: [added.data.component.id, b.id, a.id] });
  let latest = (await admin.get('/api/state')).data.jobs.find(j => j.id === job.id);
  assert.deepEqual(latest.blueprint.components.map(c => c.item), ['C', 'B', 'A']);

  await admin.delete(`/api/components/${a.id}`);
  latest = (await admin.get('/api/state')).data.jobs.find(j => j.id === job.id);
  assert.deepEqual(latest.blueprint.components.map(c => c.item), ['C', 'B']);
});

/* ---------------- activity & admin ---------------- */

test('non-admins see only their own activity', async () => {
  const mine = (await trainee.get('/api/activity')).data.entries;
  assert.ok(mine.length > 0);
  assert.ok(mine.every(e => e.actorName === 'Tim B'));
  const all = (await admin.get('/api/activity?limit=500')).data.entries;
  assert.ok(new Set(all.map(e => e.actorName)).size > 1);
});

test('the last active admin cannot be demoted or switched off', async () => {
  const me = (await admin.get('/api/state')).data.me;
  const res = await admin.patch(`/api/admin/users/${me.id}`, { role: 'assembler' });
  assert.equal(res.status, 409);
});

test('switching someone off ends their session', async () => {
  const c = await srv.user('leaving', 'assembler');
  const id = (await c.get('/api/state')).data.me.id;
  assert.equal((await admin.patch(`/api/admin/users/${id}`, { active: false })).status, 200);
  assert.equal((await c.get('/api/state')).status, 401);
  const again = await c.post('/api/session', { login: 'leaving', password: 'correct horse battery' });
  assert.equal(again.status, 403);
});

test('an admin can reset a password', async () => {
  const c = await srv.user('forgetful', 'assembler');
  const id = (await c.get('/api/state')).data.me.id;
  assert.equal((await admin.put(`/api/admin/users/${id}/password`, { password: 'brand new pass' })).status, 200);
  assert.equal((await c.get('/api/state')).status, 401);
  assert.equal((await c.post('/api/session', { login: 'forgetful', password: 'brand new pass' })).status, 200);
});

test('only admins change the AI settings, and everyone sees whether it is set up', async () => {
  assert.equal((await assembler.get('/api/settings/ai')).status, 403);
  assert.equal((await assembler.put('/api/settings/ai', { chatModel: 'x' })).status, 403);
  const saved = await admin.put('/api/settings/ai', { chatModel: 'qwen2.5:7b', visionModel: 'minicpm-v' });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.visionModel, 'minicpm-v');
  const state = (await assembler.get('/api/state')).data;
  assert.deepEqual(state.ai, { label: 'Local AI', ready: true });
});

test('only PDFs and images are accepted as drawing files', async () => {
  const job = await newJob();
  const saved = await admin.post(`/api/jobs/${job.id}/blueprints`, { fileName: 'x.html', mimeType: 'text/html', components: [] });
  const page = new TextEncoder().encode('<script>alert(1)</script>');
  const res = await admin.put(`/api/blueprints/${saved.data.blueprint.id}/file`, page, { 'Content-Type': 'text/html' });
  assert.equal(res.status, 400);
});

test('static files cannot be read outside the app folders', async () => {
  for(const p of ['/../server/config.mjs', '/%2e%2e/package.json', '/shared/../server/db.mjs', '/..%2fdata/assembly.db']){
    const res = await fetch(srv.url + p);
    assert.equal(res.status, 404, p);
  }
  assert.equal((await fetch(srv.url + '/shared/procedure.js')).status, 200);
});
