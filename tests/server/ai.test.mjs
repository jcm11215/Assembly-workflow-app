// The local AI: settings, message shaping, and retry rules.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { callAI, aiSettings, applyEdit, aiSummary } from '../../server/ai.mjs';
import { toUserMessage, fitProblem, normalizeOllamaUrl } from '../../server/ollama.mjs';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const chatOk = text => json(200, { message: { content: text }, done: true, prompt_eval_count: 10, eval_count: 5 });

test('a model that fails once while loading is asked again', async () => {
  let n = 0;
  globalThis.fetch = async () => (++n === 1 ? json(500, { error: 'model is loading' }) : chatOk('fine'));
  const out = await callAI({ chatModel: 'qwen2.5:7b' }, 'sys', 'hi');
  assert.equal(out.text, 'fine');
  assert.equal(n, 2);
});

test('an unreachable Ollama is reported as unreachable, not retried', async () => {
  let n = 0;
  globalThis.fetch = async () => { n++; throw new TypeError('fetch failed'); };
  await assert.rejects(callAI({ chatModel: 'x' }, 's', 'x'), e => e.unreachable && /Is Ollama running/.test(e.message));
  assert.equal(n, 1);
});

test('no model picked is a setup problem the app can explain', async () => {
  await assert.rejects(callAI({}, 's', 'x'), e => e.notConfigured);
  assert.deepEqual(aiSummary({}), { label: 'Local AI', ready: false });
});

test('settings from the earlier version, with a provider and a local section, still read', () => {
  const s = aiSettings({ provider: 'gemini', gemini: { key: 'k' }, local: { chatModel: 'qwen2.5:7b', url: 'box:11434' } });
  assert.equal(s.chatModel, 'qwen2.5:7b');
  assert.equal(s.url, 'http://box:11434');
  assert.ok(!('gemini' in s));
});

test('Ollama addresses are tidied, and blank means this machine', () => {
  assert.equal(normalizeOllamaUrl('desktop:11434/'), 'http://desktop:11434');
  assert.equal(normalizeOllamaUrl('http://localhost:11434/api'), 'http://localhost:11434');
  assert.equal(normalizeOllamaUrl(''), 'http://127.0.0.1:11434');
});

test('local AI settings: models and sizes kept within bounds', () => {
  const s = applyEdit({}, { chatModel: 'qwen2.5:7b', contextTokens: 999999, temperature: '0.5' });
  assert.equal(s.chatModel, 'qwen2.5:7b');
  assert.equal(s.contextTokens, 131072);
  assert.equal(s.temperature, 0.5);
  assert.equal(s.embedModel, 'nomic-embed-text');
  assert.equal(applyEdit(s, { visionModel: 'minicpm-v' }).chatModel, 'qwen2.5:7b');
});

test('Ollama messages: pages keep their captions and text layers', () => {
  const m = toUserMessage([
    { type: 'text', text: 'PDF page 2' },
    { type: 'image', source: { media_type: 'image/jpeg', data: 'AAAA' }, textLayer: { page: 2, text: 'PN 12345' } },
    { type: 'text', text: 'Read the parts table.' }
  ]);
  assert.deepEqual(m.images, ['AAAA']);
  assert.match(m.content, /^The 1 attached image is, in order: PDF page 2\./);
  assert.match(m.content, /page 2 .*\n?.*PN 12345/s);
});

test('a request too big for the context is refused in words the scan splitter knows', () => {
  const msgs = [{ role: 'user', content: 'x', images: new Array(12).fill('A') }];
  assert.match(fitProblem(msgs, 'llava', 8192, 4096), /too large/i);
  assert.match(fitProblem([{ role: 'user', content: '', images: ['A', 'B'] }], 'llama3.2-vision', 16384, 100), /too many/i);
  assert.equal(fitProblem([{ role: 'user', content: 'hi' }], 'qwen', 8192, 100), null);
});
