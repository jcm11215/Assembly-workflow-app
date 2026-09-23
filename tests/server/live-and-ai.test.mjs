import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './harness.mjs';
import { startFakeOllama } from '../fake-ollama.mjs';

let srv, admin, assembler;

before(async () => {
  srv = await startServer();
  admin = await srv.user('boss', 'admin', 'Boss');
  assembler = await srv.user('dana', 'assembler', 'Dana');
});
after(() => srv.close());

/** Opens the event stream as `c` and collects events until stopped. */
async function listen(c){
  const events = [];
  const ctrl = new AbortController();
  const res = await fetch(srv.url + '/api/events', { headers: { Cookie: c.cookie() }, signal: ctrl.signal });
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  let buf = '';
  (async () => {
    try {
      for(;;){
        const { value, done } = await reader.read();
        if(done) break;
        buf += new TextDecoder().decode(value);
        let i;
        while((i = buf.indexOf('\n\n')) >= 0){
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const type = /^event: (.+)$/m.exec(chunk)?.[1];
          const data = /^data: (.+)$/m.exec(chunk)?.[1];
          if(type) events.push({ type, data: JSON.parse(data) });
        }
      }
    } catch { /* aborted */ }
  })();
  const waitFor = async (pred, ms = 2000) => {
    const end = Date.now() + ms;
    while(Date.now() < end){
      const hit = events.find(pred);
      if(hit) return hit;
      await new Promise(r => setTimeout(r, 20));
    }
    throw new Error('event did not arrive: ' + JSON.stringify(events.map(e => e.type)));
  };
  return { events, waitFor, stop: () => ctrl.abort() };
}

test('a change by one person reaches another person\'s open app', async () => {
  const stream = await listen(assembler);
  await stream.waitFor(e => e.type === 'hello');

  const made = await admin.post('/api/jobs', { jobNumber: 'LIVE-1', customer: 'Acme' });
  const jobEvent = await stream.waitFor(e => e.type === 'job' && e.data.jobNumber === 'LIVE-1');
  assert.equal(jobEvent.data.id, made.data.job.id);

  await admin.post('/api/blockers', { jobId: made.data.job.id, issue: 'No motor' });
  await stream.waitFor(e => e.type === 'blocker' && e.data.issue === 'No motor');

  await admin.delete(`/api/jobs/${made.data.job.id}`);
  await stream.waitFor(e => e.type === 'job-removed' && e.data.id === made.data.job.id);

  // The admin's activity is not the assembler's to see.
  assert.ok(!stream.events.some(e => e.type === 'activity' && e.data.actorName === 'Boss'));
  stream.stop();
});

/* ---------------- the local AI (a stand-in Ollama) ---------------- */

test('a drawing goes to the vision model with its PDF text layer', async () => {
  const fake = await startFakeOllama({ chat: () => '{"ok":true}' });
  await admin.put('/api/settings/ai', { url: fake.url, chatModel: 'fake-chat', visionModel: 'fake-vision' });
  const res = await assembler.post('/api/ai/chat', {
    system: 'Read the drawing.',
    content: [
      { type: 'text', text: 'PDF page 1' },
      { type: 'image', source: { media_type: 'image/png', data: 'AAAA' }, textLayer: { page: 1, text: 'PN 12345' } }
    ]
  });
  fake.close();
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.text, '{"ok":true}');
  const sent = fake.calls.find(c => c.url === '/api/chat').body;
  assert.equal(sent.model, 'fake-vision');
  assert.equal(sent.options.num_ctx, 16384);
  assert.deepEqual(sent.messages[1].images, ['AAAA']);
  assert.match(sent.messages[1].content, /PN 12345/);
  assert.match(sent.messages[0].content, /authorized employee/);
});

test('an unreachable local AI says so plainly', async () => {
  await admin.put('/api/settings/ai', { url: 'http://127.0.0.1:9', chatModel: 'x' });
  const res = await assembler.post('/api/ai/chat', { system: 's', content: 'hi' });
  assert.equal(res.status, 502);
  assert.equal(res.data.unreachable, true);
  assert.match(res.data.error, /Couldn't reach the local AI/);
});

test('knowledge: a document and a correction reach the answer, and are cited', async () => {
  let system = '';
  const fake = await startFakeOllama({ chat: body => { system = body.messages[0].content; return 'Torque them to 45 ft-lb.'; } });
  await admin.put('/api/settings/ai', { url: fake.url, chatModel: 'fake-chat', visionModel: 'fake-vision' });

  const text = 'Hanger bearing bolts: torque hanger bearing bolts to 45 ft-lb, then re-check after first run.';
  const up = await admin.raw('POST', '/api/knowledge/documents?name=Hanger%20procedure.md&collection=procedures', new TextEncoder().encode(text));
  assert.equal(up.status, 201, JSON.stringify(up.data));
  assert.equal(up.data.document.status, 'indexed');
  assert.equal(up.data.needsText, false);

  // The same file twice is refused.
  const again = await admin.raw('POST', '/api/knowledge/documents?name=copy.md', new TextEncoder().encode(text));
  assert.equal(again.status, 409);

  // Trainees can't teach it; assemblers can.
  const trainee = await srv.user('tia', 'trainee', 'Tia');
  assert.equal((await trainee.post('/api/knowledge/corrections', { question: 'q', correction: 'c' })).status, 403);
  const fix = await assembler.post('/api/knowledge/corrections', { question: 'What torque for hanger bearing bolts?', correction: 'Use 45 ft-lb, never more.' });
  assert.equal(fix.status, 201);
  assert.equal(fix.data.correction.indexed, true);

  const res = await assembler.post('/api/ai/chat', { system: 'Shop data.', content: 'hanger bearing bolts torque?', knowledge: 'What torque for hanger bearing bolts?' });
  fake.close();
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.match(system, /VERIFIED CORRECTIONS[\s\S]*never more/);
  assert.match(system, /Hanger procedure[\s\S]*45 ft-lb/);
  assert.equal(res.data.sources.documents[0].title, 'Hanger procedure');
  assert.equal(res.data.sources.corrections.length, 1);

  // Only admins manage the knowledge base; anyone can open a cited file.
  assert.equal((await assembler.get('/api/knowledge')).status, 403);
  const file = await assembler.get(`/api/knowledge/documents/${up.data.document.id}/file`);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-disposition').startsWith('attachment'), true);
  const list = await admin.get('/api/knowledge');
  assert.equal(list.data.documents.length, 1);
  assert.equal(list.data.corrections[0].usedCount, 1);
});

test('knowledge: a PDF waits for the text the browser reads from it', async () => {
  const fake = await startFakeOllama();
  await admin.put('/api/settings/ai', { url: fake.url });
  const up = await admin.raw('POST', '/api/knowledge/documents?name=Manual.pdf', new Uint8Array([37, 80, 68, 70, 1, 2, 3]));
  assert.equal(up.data.needsText, true);
  assert.equal(up.data.document.status, 'pending');
  const done = await admin.put(`/api/knowledge/documents/${up.data.document.id}/text`, { pages: ['Gearbox oil: ISO VG 220.', ''] });
  assert.equal(done.data.document.status, 'indexed');
  const scanned = await admin.raw('POST', '/api/knowledge/documents?name=Scan.pdf', new Uint8Array([37, 80, 68, 70, 9]));
  const empty = await admin.put(`/api/knowledge/documents/${scanned.data.document.id}/text`, { pages: ['', ''] });
  assert.equal(empty.data.document.status, 'empty');
  assert.equal((await admin.raw('POST', '/api/knowledge/documents?name=x.exe', new Uint8Array([1]))).status, 400);
  fake.close();
});

test('the local model list and a download, through Ollama', async () => {
  const fake = await startFakeOllama();
  await admin.put('/api/settings/ai', { url: fake.url });
  const st = await admin.get('/api/ai/local');
  assert.equal(st.data.up, true);
  assert.deepEqual(st.data.models.map(m => m.id), ['fake-chat', 'fake-vision', 'nomic-embed-text']);
  assert.equal(st.data.models.find(m => m.id === 'nomic-embed-text').embedding, true);
  assert.equal((await assembler.get('/api/ai/local')).status, 403);
  fake.close();
});

test('installed models are put on the jobs nobody picked a model for', async () => {
  const fake = await startFakeOllama({ models: ['llama3.2:3b', 'minicpm-v:latest', 'nomic-embed-text:latest'] });
  await admin.put('/api/settings/ai', { url: fake.url, chatModel: '', visionModel: '' });
  const st = await admin.get('/api/ai/local');
  assert.equal(st.data.settings.chatModel, 'llama3.2:3b');
  assert.equal(st.data.settings.visionModel, 'minicpm-v:latest');
  assert.deepEqual(st.data.jobs.map(j => j.installed), [true, true, true]);
  assert.equal(st.data.ready, true);
  assert.equal((await assembler.get('/api/state')).data.ai.ready, true);
  fake.close();
});

test('one-click setup downloads what is missing and puts it to work', async () => {
  const fake = await startFakeOllama({ models: ['fake-chat'] });
  await admin.put('/api/settings/ai', { url: fake.url, chatModel: 'fake-chat', visionModel: '', embedModel: '' });
  const res = await admin.post('/api/ai/local/setup');
  assert.equal(res.status, 202);
  assert.deepEqual(res.data.queued, ['nomic-embed-text', 'minicpm-v']);
  let st;
  for(let i = 0; i < 50; i++){
    st = (await admin.get('/api/ai/local')).data;
    if(!st.downloads.current && !st.downloads.queue.length) break;
    await new Promise(r => setTimeout(r, 50));
  }
  assert.equal(st.downloads.error, null);
  assert.equal(st.settings.chatModel, 'fake-chat');
  assert.equal(st.settings.visionModel, 'minicpm-v:latest');
  assert.equal(st.ready, true);
  assert.deepEqual(fake.calls.filter(c => c.url === '/api/pull').map(c => c.body.model), ['nomic-embed-text', 'minicpm-v']);
  // Nothing left to download: a second click queues nothing.
  assert.deepEqual((await admin.post('/api/ai/local/setup')).data.queued, []);
  // A download Ollama refuses is reported, not retried.
  await admin.post('/api/ai/local/pull', { model: 'missing-model' });
  for(let i = 0; i < 50 && (st = (await admin.get('/api/ai/local')).data).downloads.current; i++) await new Promise(r => setTimeout(r, 50));
  assert.match(st.downloads.error.message, /does not exist/);
  assert.equal((await assembler.post('/api/ai/local/setup')).status, 403);
  fake.close();
});

test('a vision model answers questions until a chat model is picked', async () => {
  const fake = await startFakeOllama({ chat: body => `from ${body.model}` });
  await admin.put('/api/settings/ai', { url: fake.url, chatModel: '', visionModel: 'fake-vision' });
  const res = await assembler.post('/api/ai/chat', { system: 's', content: 'hi' });
  assert.equal(res.data.text, 'from fake-vision');
  fake.close();
});

test('asking with no model picked is a 409 the app can explain', async () => {
  await admin.put('/api/settings/ai', { chatModel: '', visionModel: '' });
  const res = await assembler.post('/api/ai/chat', { system: 's', content: 'hi' });
  assert.equal(res.status, 409);
  assert.equal(res.data.code, 'ai_not_configured');
});

test('the first-run setup code is throttled like a password', async () => {
  const { startServer } = await import('./harness.mjs');
  const fresh = await startServer();
  try {
    const c = fresh.client();
    assert.equal((await c.get('/api/session')).data.setupNeeded, true);
    for(let i = 0; i < 8; i++){
      assert.equal((await c.post('/api/setup', { setupCode: 'NOPE', fullName: 'X', login: 'xxx', password: 'password123' })).status, 400);
    }
    assert.equal((await c.post('/api/setup', { setupCode: 'NOPE', fullName: 'X', login: 'xxx', password: 'password123' })).status, 429);
  } finally { await fresh.close(); }
});
