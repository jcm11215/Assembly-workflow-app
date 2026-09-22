import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from './harness.mjs';
import { resetLocalState } from '../../server/ai.mjs';

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

/* ---------------- AI proxy against a stand-in local AI ---------------- */

function fakeLocalAi(handler){
  return new Promise(resolve => {
    const s = http.createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      handler(req, JSON.parse(body || '{}'), res);
    });
    s.listen(0, '127.0.0.1', () => resolve({ server: s, url: `http://127.0.0.1:${s.address().port}` }));
  });
}

test('the chat endpoint reaches the local AI with its key and the PDF text layer', async () => {
  resetLocalState();
  let seen;
  const fake = await fakeLocalAi((req, body, res) => {
    seen = { auth: req.headers.authorization, body };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
  });
  await admin.put('/api/settings/ai', { provider: 'local', local: { url: fake.url, key: 'local-key' } });
  const res = await assembler.post('/api/ai/chat', {
    system: 'Read the drawing.',
    content: [
      { type: 'text', text: 'PDF page 1' },
      { type: 'image', source: { media_type: 'image/png', data: 'AAAA' }, textLayer: { page: 1, text: 'PN 12345' } }
    ]
  });
  fake.server.close();
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.text, '{"ok":true}');
  assert.equal(seen.auth, 'Bearer local-key');
  const parts = seen.body.messages[1].content;
  assert.equal(parts[1].type, 'image_url');
  assert.match(parts[2].text, /PN 12345/);
});

test('an unreachable local AI with no fallback says so plainly', async () => {
  resetLocalState();
  await admin.put('/api/settings/ai', { provider: 'local', local: { url: 'http://127.0.0.1:9', key: 'k', fallback: false } });
  const res = await assembler.post('/api/ai/chat', { system: 's', content: 'hi' });
  assert.equal(res.status, 502);
  assert.equal(res.data.unreachable, true);
  assert.match(res.data.error, /Couldn't reach the local AI/);
});

test('asking with no provider set up is a 409 the app can explain', async () => {
  await admin.put('/api/settings/ai', { provider: 'gemini', gemini: { key: '' } });
  const res = await assembler.post('/api/ai/chat', { system: 's', content: 'hi' });
  assert.equal(res.status, 409);
  assert.equal(res.data.code, 'ai_not_configured');
});
