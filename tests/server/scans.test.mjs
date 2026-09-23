// Blueprint scans the server runs: they carry on with nobody watching,
// save themselves or wait for their new job, can be stopped and tried
// again, and pick up after a restart.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer } from './harness.mjs';
import { startFakeOllama } from '../fake-ollama.mjs';
import { REPLIES } from '../e2e/fake-ai.mjs';
import { resumeScans } from '../../server/scans.mjs';

let srv, ai, admin, other, assembler;
let behave = null;   // per test: what the AI does instead of answering

before(async () => {
  srv = await startServer();
  admin = await srv.user('boss', 'admin', 'Boss');
  other = await srv.user('jo', 'admin', 'Jo');
  assembler = await srv.user('dana', 'assembler', 'Dana');
  ai = await startFakeOllama({
    chat: async body => {
      if(behave){ const out = await behave(body); if(out !== undefined) return out; }
      const system = body.messages[0].content;
      return /BALLOON CALLOUT is a small circle/i.test(system) ? REPLIES.callouts
        : /transcribe the parts table/i.test(system) ? REPLIES.parts
        : /classify which kind of page/i.test(system) ? REPLIES.classify
        : REPLIES.layout;
    }
  });
  const set = await admin.put('/api/settings/ai', { url: ai.url, chatModel: 'fake-chat', visionModel: 'fake-vision' });
  assert.equal(set.status, 200, JSON.stringify(set.data));
});
after(async () => { ai.close(); await srv.close(); });

/** A two-sheet drawing's prepared pages; `tag` keeps each test's pages
 *  apart from the readings other tests left in the cache. */
const pages = tag => [1, 2].flatMap(n => [
  { type: 'text', text: `PDF page ${n}:` },
  { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from(`${tag}-${n}`).toString('base64') } }
]);

/** One upload: the settings and pages as JSON, then the file. */
function upload(c, meta, file = Buffer.from('%PDF-1.4 pretend')){
  const json = Buffer.from(JSON.stringify(meta));
  return c.raw('POST', `/api/scans?meta=${json.length}`, new Uint8Array(Buffer.concat([json, file])), { 'Content-Type': 'application/octet-stream' });
}

async function settled(id, ms = 5000){
  const end = Date.now() + ms;
  for(;;){
    const r = srv.db.get('select status from scans where id = ?', id);
    if(r && !['queued', 'running'].includes(r.status)) return r.status;
    if(Date.now() > end) throw new Error(`scan still ${r && r.status}`);
    await new Promise(r => setTimeout(r, 20));
  }
}

const newJob = async n => (await admin.post('/api/jobs', { jobNumber: n, customer: 'Acme' })).data.job;

test('a re-scan runs on the server and saves itself to the job, file and all', async () => {
  const job = await newJob('BG-1');
  const started = await upload(admin, { jobId: job.id, fileName: 'GA.pdf', mimeType: 'application/pdf', blocks: pages('bg1') });
  assert.equal(started.status, 201, JSON.stringify(started.data));
  assert.equal(await settled(started.data.scan.id), 'saved');

  const state = (await admin.get('/api/state')).data;
  const bp = state.jobs.find(j => j.id === job.id).blueprint;
  assert.equal(bp.components.length, 3);
  assert.equal(bp.hasFile, true);
  assert.equal(bp.scanner, 2);
  assert.equal(fs.readFileSync(`${srv.filesDir}/BG-1/GA.pdf`, 'utf8'), '%PDF-1.4 pretend');
  const listed = state.scans.find(s => s.id === started.data.scan.id);
  assert.equal(listed.status, 'saved');
  assert.match(listed.summary, /Found 3 parts/);
  assert.deepEqual(fs.readdirSync(`${srv.filesDir}/scans`), [], 'its working files are cleared away');
});

test('a new-job scan waits with what it read, and is saved to the job made from it', async () => {
  const { data } = await upload(admin, { includeJobFields: true, fileName: 'New.pdf', mimeType: 'application/pdf', blocks: pages('bg2') });
  assert.equal(await settled(data.scan.id), 'done');
  const waiting = (await admin.get('/api/scans')).data.scans.find(s => s.id === data.scan.id);
  assert.equal(waiting.result.titleBlock.jobNumber, '2024-017H');
  assert.equal(waiting.result.components.length, 3);

  const job = await newJob('2024-017H');
  const attached = await admin.post(`/api/scans/${data.scan.id}/attach`, { jobId: job.id });
  assert.equal(attached.status, 200, JSON.stringify(attached.data));
  assert.equal(attached.data.job.blueprint.components.length, 3);
  assert.equal(attached.data.job.blueprint.hasFile, true);
  assert.ok(!(await admin.get('/api/scans')).data.scans.some(s => s.id === data.scan.id), 'put away once saved');
  const again = await admin.post(`/api/scans/${data.scan.id}/attach`, { jobId: job.id });
  assert.equal(again.status, 400, 'saved only once');
});

test('only the person who started a scan sees it, and only admins scan', async () => {
  const { data } = await upload(admin, { includeJobFields: true, blocks: pages('bg3') });
  await settled(data.scan.id);
  assert.equal((await upload(assembler, { includeJobFields: true, blocks: pages('bg3') })).status, 403);
  assert.ok(!(await other.get('/api/scans')).data.scans.some(s => s.id === data.scan.id));
  assert.equal((await other.delete(`/api/scans/${data.scan.id}`)).status, 404);
  assert.equal((await admin.delete(`/api/scans/${data.scan.id}`)).status, 200);
});

test('an upload that is not a scan is refused', async () => {
  assert.equal((await admin.raw('POST', '/api/scans', new Uint8Array([1, 2, 3]), { 'Content-Type': 'application/octet-stream' })).status, 400);
  assert.equal((await upload(admin, { blocks: [] })).status, 400);
  assert.equal((await upload(admin, { jobId: 'nope', blocks: pages('x') })).status, 400);
});

test('stopping: a waiting scan at once, a running one after the question it is on', async () => {
  const job = await newJob('BG-4');
  let release;
  const gate = new Promise(r => { release = r; });
  let asked = 0;
  behave = async () => { asked++; await gate; };
  const a = (await upload(admin, { jobId: job.id, blocks: pages('bg4a') })).data.scan;
  const b = (await upload(admin, { jobId: job.id, blocks: pages('bg4b') })).data.scan;
  while(!asked) await new Promise(r => setTimeout(r, 10));

  assert.equal(srv.db.get('select status from scans where id = ?', b.id).status, 'queued', 'one at a time');
  await admin.delete(`/api/scans/${b.id}`);
  assert.equal(srv.db.get('select status from scans where id = ?', b.id).status, 'cancelled');
  await admin.delete(`/api/scans/${a.id}`);
  release();
  assert.equal(await settled(a.id), 'cancelled');
  assert.equal(asked, 1, 'nothing more was asked once it was stopped');
  behave = null;
  const state = (await admin.get('/api/state')).data;
  assert.equal(state.jobs.find(j => j.id === job.id).blueprint, null, 'nothing saved');
});

test('a scan that fails says why, and can be tried again', async () => {
  const job = await newJob('BG-5');
  behave = () => ({ status: 400, error: 'model "fake-vision" not found' });
  const { data } = await upload(admin, { jobId: job.id, blocks: pages('bg5') });
  assert.equal(await settled(data.scan.id), 'failed');
  const failed = (await admin.get('/api/scans')).data.scans.find(s => s.id === data.scan.id);
  assert.match(failed.error, /not found/);

  behave = null;
  assert.equal((await admin.post(`/api/scans/${data.scan.id}/retry`)).status, 200);
  assert.equal(await settled(data.scan.id), 'saved');
  assert.equal((await admin.post(`/api/scans/${data.scan.id}/retry`)).status, 400, 'only a failed scan is tried again');
});

test('a scan a restart interrupted runs again', async () => {
  const job = await newJob('BG-6');
  const { data } = await upload(admin, { jobId: job.id, blocks: pages('bg6') });
  await settled(data.scan.id);
  // As if the server stopped mid-scan: its pages back on disk, still "running".
  fs.writeFileSync(`${srv.filesDir}/scans/${data.scan.id}.pages.json`, JSON.stringify(pages('bg6b')));
  srv.db.run(`update scans set status = 'running', dismissed = 0 where id = ?`, data.scan.id);
  fs.writeFileSync(`${srv.filesDir}/scans/orphan.pages.json`, '[]');
  resumeScans(srv.db, srv.filesDir);
  assert.equal(await settled(data.scan.id), 'saved');
  assert.ok(!fs.existsSync(`${srv.filesDir}/scans/orphan.pages.json`), 'files no scan owns are cleared');
  const versions = srv.db.get('select count(*) as n from blueprints where job_id = ?', job.id).n;
  assert.equal(versions, 2);
});

test('a checked list teaches the scan, and a test scan is scored against it', async () => {
  const job = await newJob('CAL-1');
  const { data } = await upload(admin, { jobId: job.id, fileName: 'CAL.pdf', mimeType: 'application/pdf', blocks: pages('cal1') });
  assert.equal(await settled(data.scan.id), 'saved');
  let bp = (await admin.get('/api/state')).data.jobs.find(j => j.id === job.id).blueprint;
  assert.equal(bp.checked, false);

  // The motor isn't wanted on this list: take it off and mark the rest right.
  const motor = bp.components.find(c => c.item === 'Motor');
  await admin.delete(`/api/components/${motor.id}`);
  const marked = await admin.post(`/api/blueprints/${bp.id}/correct`);
  assert.equal(marked.status, 200, JSON.stringify(marked.data));
  assert.equal(marked.data.firstScore.score, 67, 'two of the three right, one extra');
  assert.deepEqual(marked.data.firstScore.extra, ['GEARMOTOR, 5HP 39RPM TEFC']);
  assert.ok(marked.data.learned.some(l => l.item === 'Not a part' && /GEARMOTOR/.test(l.drawn)));
  assert.equal(marked.data.job.blueprint.checked, true);

  const cal = (await admin.get('/api/calibration')).data;
  const key = cal.keys.find(k => k.jobId === job.id);
  assert.equal(key.parts, 2);
  assert.equal(key.hasFile, true);
  assert.ok(cal.recent.some(s => s.id === data.scan.id));
  assert.equal((await assembler.get('/api/calibration')).status, 403);

  // A test scan reads it again: scored, not saved, not in the banner.
  const test = (await upload(admin, { testKeyId: key.id, jobId: job.id, blocks: pages('cal1b') })).data.scan;
  assert.equal(await settled(test.id), 'done');
  const after = (await admin.get('/api/calibration')).data.keys.find(k => k.id === key.id);
  assert.equal(after.last.score, 100, 'the motor is left out now');
  assert.equal(after.history.length, 1);
  assert.ok(!(await admin.get('/api/scans')).data.scans.some(s => s.id === test.id));
  assert.equal(srv.db.get('select count(*) as n from blueprints where job_id = ?', job.id).n, 1, 'nothing saved to the job');

  assert.equal((await admin.delete(`/api/calibration/keys/${key.id}`)).status, 200);
  assert.ok(!(await admin.get('/api/calibration')).data.keys.some(k => k.id === key.id));
});
