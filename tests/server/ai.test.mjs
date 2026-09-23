// The AI providers' retry and fallback rules, against stand-in responses.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { callAI, retryAfterMs, normalizeSettings, applyEdit, adminView } from '../../server/ai.mjs';
import { toUserMessage, fitProblem, normalizeOllamaUrl } from '../../server/ollama.mjs';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const geminiOk = text => json(200, { candidates: [{ content: { parts: [{ text }] } }] });

test('retry-after comes from the RetryInfo detail, the message, or the header', () => {
  assert.equal(retryAfterMs({ error: { details: [{ retryDelay: '1.5s' }] } }), 1500);
  assert.equal(retryAfterMs({ error: { message: 'Please retry in 2.2s.' } }), 2200);
  assert.equal(retryAfterMs({}, new Headers({ 'retry-after': '3' })), 3000);
  assert.equal(retryAfterMs({}), null);
});

test('Gemini: a 429 waits and retries the same model', async () => {
  const models = [];
  let n = 0;
  globalThis.fetch = async url => {
    models.push(/models\/([^:]+):/.exec(url)[1]);
    return ++n === 1 ? json(429, { error: { message: 'quota', details: [{ retryDelay: '0.01s' }] } }) : geminiOk('fine');
  };
  const out = await callAI({ provider: 'gemini', gemini: { key: 'k', model: 'gemini-a' } }, 'sys', 'hi');
  assert.equal(out.text, 'fine');
  assert.deepEqual(models, ['gemini-a', 'gemini-a']);
  assert.equal(out.substitution, null);
});

test('Gemini: an overloaded model is swapped for the next one, and says so', async () => {
  globalThis.fetch = async url => (url.includes('gemini-a:')
    ? json(503, { error: { message: 'The model is overloaded.' } })
    : geminiOk('from another model'));
  const out = await callAI({ provider: 'gemini', gemini: { key: 'k', model: 'gemini-a' } }, 'sys', 'hi');
  assert.equal(out.text, 'from another model');
  assert.equal(out.substitution.asked, 'gemini-a');
});

test('Gemini: a rejected key is never retried', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return json(400, { error: { message: 'API key not valid.' } }); };
  await assert.rejects(callAI({ provider: 'gemini', gemini: { key: 'bad' } }, 's', 'x'), /API key not valid/);
  assert.equal(calls, 1);
});

test('OpenRouter: the real reason is dug out of error.metadata.raw', async () => {
  globalThis.fetch = async () => json(400, { error: { message: 'Provider returned error', metadata: { raw: JSON.stringify({ error: { message: 'image input not supported' } }) } } });
  await assert.rejects(callAI({ provider: 'openrouter', openrouter: { key: 'k' } }, 's', 'x'), /Provider returned error: image input not supported/);
});

test('Local AI: unreachable falls back to OpenRouter when allowed, and says so', async () => {
  globalThis.fetch = async url => {
    if(String(url).startsWith('http://local')) throw new TypeError('fetch failed');
    return json(200, { choices: [{ message: { content: 'from openrouter' } }] });
  };
  const settings = { provider: 'local', local: { url: 'http://local', chatModel: 'qwen2.5:7b', fallback: true }, openrouter: { key: 'or', model: 'm/free' } };
  const out = await callAI(settings, 's', 'x');
  assert.equal(out.text, 'from openrouter');
  assert.match(out.substitution.used, /OpenRouter/);
  // Remembered as down for a minute: the next call goes straight to the fallback.
  const again = await callAI(settings, 's', 'x');
  assert.equal(again.substitution.reason, 'was unreachable a moment ago');
});

test('settings: keys are kept unless replaced, and never shown back', () => {
  let s = applyEdit({}, { provider: 'openrouter', openrouter: { key: 'sk-secret-9876', model: 'x/y' } });
  s = applyEdit(s, { openrouter: { model: 'x/z' } });
  assert.equal(s.openrouter.key, 'sk-secret-9876');
  assert.equal(s.openrouter.model, 'x/z');
  assert.ok(!JSON.stringify(adminView(s)).includes('secret'));
  assert.equal(applyEdit(s, { openrouter: { key: '' } }).openrouter.key, '');
  assert.throws(() => applyEdit(s, { provider: 'skynet' }));
  assert.equal(normalizeSettings(null).provider, 'gemini');
});

test('Ollama addresses are tidied, and blank means this machine', () => {
  assert.equal(normalizeOllamaUrl('desktop:11434/'), 'http://desktop:11434');
  assert.equal(normalizeOllamaUrl('http://localhost:11434/api'), 'http://localhost:11434');
  assert.equal(normalizeOllamaUrl(''), 'http://127.0.0.1:11434');
});

test('local AI settings: models and sizes kept within bounds', () => {
  const s = applyEdit({}, { provider: 'local', local: { chatModel: 'qwen2.5:7b', contextTokens: 999999, temperature: '0.5' } });
  assert.equal(s.local.chatModel, 'qwen2.5:7b');
  assert.equal(s.local.contextTokens, 131072);
  assert.equal(s.local.temperature, 0.5);
  assert.equal(s.local.embedModel, 'nomic-embed-text');
  assert.equal(applyEdit(s, { local: { visionModel: 'minicpm-v' } }).local.chatModel, 'qwen2.5:7b');
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
