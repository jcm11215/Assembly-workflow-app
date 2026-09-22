// The local AI as a provider: the request it sends, the errors it tells
// apart, and when it hands a scan to OpenRouter instead.
//
// The case that matters most is the desktop being off. A scan must not
// fail for that when an OpenRouter key is there to cover -- but it must
// SAY it was covered, or the desktop sits switched off for a week while
// every drawing quietly goes to the cloud. And a wrong key must never be
// "covered": that is a broken setup, and hiding it behind scans that seem
// to work is how it stays broken.
import './stub.mjs';
const keys = await import('../src/ai/keys.js');
const P = await import('../src/ai/providers.js');
const { explainFetchError } = await import('../src/ai/errors.js');
const { textItemsToLines, textLayerFromItems } = await import('../src/blueprints/pdf.js');
const { substitutionText } = await import('../src/blueprints/extract.js');

let pass = 0, fail = 0;
const t = async (n, fn) => {
  try { await fn(); pass++; console.log('  PASS ' + n); }
  catch (e) { fail++; console.log('  FAIL ' + n + ' -> ' + e.message); }
};
const eq = (a, b, what) => { if (a !== b) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (v, what) => { if (!v) throw new Error(what); };

const BASE = 'https://justin-desktop.tail1234.ts.net';
function setup({ fallback = true, orKey = 'sk-or-v1-abc' } = {}){
  localStorage.clear();
  keys.setAiProvider('local');
  keys.setLocalAiUrl(BASE);
  keys.setLocalAiKey('secret-key-1234');
  keys.setLocalAiFallback(fallback);
  if (orKey) keys.setOpenRouterKey(orKey);
  P.resetLocalAiState();
}

const json = (status, body) => ({
  ok: status >= 200 && status < 300, status,
  text: async () => JSON.stringify(body), headers: { get: () => null }
});
const localOk = text => json(200, { choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }] });
const orOk = text => json(200, { choices: [{ message: { content: text } }] });

/** Routes by host; each list is consumed in order, the last entry repeats. */
function mockFetch(routes){
  const calls = [];
  const idx = {};
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const host = url.startsWith(BASE) ? 'local' : url.includes('openrouter.ai') ? 'openrouter' : 'other';
    const list = routes[host] || [];
    const i = idx[host] = (idx[host] ?? -1) + 1;
    const next = list[Math.min(i, list.length - 1)];
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next(url, init);
    return next;
  };
  return calls;
}

console.log('=== settings ===');
await t('a pasted address is tidied to the base URL', () => {
  eq(keys.normalizeLocalAiUrl('justin-desktop.x.ts.net/'), 'https://justin-desktop.x.ts.net', 'no scheme');
  eq(keys.normalizeLocalAiUrl('https://h.ts.net/v1/chat/completions'), 'https://h.ts.net', 'api path');
  eq(keys.normalizeLocalAiUrl('  https://h.ts.net/v1  '), 'https://h.ts.net', 'v1');
});
await t('a plain-http LAN address is refused with the reason', () => {
  const why = keys.localAiUrlProblem('http://172.16.0.5:8080');
  ok(why && /https/.test(why) && /ts\.net/.test(why), why);
  eq(keys.localAiUrlProblem('https://h.ts.net'), null, 'https is fine');
  eq(keys.localAiUrlProblem('http://localhost:8080'), null, 'localhost is fine');
});
await t('local is a provider in its own right, and needs both address and key', () => {
  localStorage.clear();
  keys.setAiProvider('local');
  eq(keys.getAiProvider(), 'local', 'stored');
  eq(keys.activeProviderHasKey(), false, 'nothing set');
  keys.setLocalAiUrl(BASE);
  eq(keys.activeProviderHasKey(), false, 'address only');
  keys.setLocalAiKey('k');
  eq(keys.activeProviderHasKey(), true, 'both');
});
await t('an unknown stored provider falls back to the default, not to "local"', () => {
  localStorage.setItem('awt_aiProvider', 'claude');
  eq(keys.getAiProvider(), 'openrouter', 'default');
});
await t('fallback is on unless turned off', () => {
  localStorage.clear();
  eq(keys.getLocalAiFallback(), true, 'default');
  keys.setLocalAiFallback(false);
  eq(keys.getLocalAiFallback(), false, 'off');
});

console.log('\n=== the request ===');
const pageBlocks = [
  { type: 'text', text: 'PDF page 2:' },
  { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' },
    textLayer: { page: 2, text: '1 BEARING FLANGE 2-7/16 2' } },
  { type: 'text', text: 'Transcribe the parts list.' }
];
await t('sends the key as a Bearer header to /v1/chat/completions, model auto, no streaming', async () => {
  setup();
  const calls = mockFetch({ local: [localOk('{"components":[]}')] });
  const out = await P.callAI('SYS', pageBlocks);
  eq(out, '{"components":[]}', 'reply');
  eq(calls.length, 1, 'one call');
  eq(calls[0].url, `${BASE}/v1/chat/completions`, 'url');
  eq(calls[0].init.headers.Authorization, 'Bearer secret-key-1234', 'auth');
  const body = JSON.parse(calls[0].init.body);
  eq(body.model, 'auto', 'model');
  eq(body.stream, false, 'stream');
  eq(body.messages[0].content, 'SYS', 'system');
});
await t('the PDF text follows its own image, before the next label', async () => {
  setup();
  const calls = mockFetch({ local: [localOk('x')] });
  await P.callAI('SYS', pageBlocks);
  const parts = JSON.parse(calls[0].init.body).messages[1].content;
  eq(parts.map(p => p.type).join(','), 'text,image_url,text,text', 'order');
  eq(parts[1].image_url.url, 'data:image/jpeg;base64,AAAA', 'data url');
  ok(/page 2/.test(parts[2].text) && parts[2].text.includes('1 BEARING FLANGE 2-7/16 2'), parts[2].text);
});
await t('cloud providers never see the PDF text', () => {
  const or = P.toOpenRouterContent(pageBlocks);
  ok(!JSON.stringify(or).includes('BEARING'), 'OpenRouter content has no text layer');
  const gm = P.toGeminiParts(pageBlocks);
  ok(!JSON.stringify(gm).includes('BEARING'), 'Gemini parts have no text layer');
});

console.log('\n=== failures ===');
await t('desktop off (network error): OpenRouter answers, and it is reported', async () => {
  setup();
  const calls = mockFetch({ local: [new TypeError('Failed to fetch')], openrouter: [orOk('from cloud')] });
  eq(await P.callAI('SYS', pageBlocks), 'from cloud', 'reply');
  eq(calls.filter(c => c.url.startsWith(BASE)).length, 1, 'no pointless retry of a dead host');
  const sub = P.takeModelSubstitution();
  ok(sub && sub.asked === 'the local AI' && /OpenRouter/.test(sub.used) && sub.reason === 'was unreachable', JSON.stringify(sub));
  eq(substitutionText(sub), 'the local AI was unreachable; OpenRouter (openrouter/free) read it instead', 'log line');
});
await t('Tailscale 502 counts as off', async () => {
  setup();
  mockFetch({ local: [json(502, {})], openrouter: [orOk('cloud')] });
  eq(await P.callAI('SYS', 'hi'), 'cloud', 'reply');
});
await t('server says Ollama is down (503 upstream_unavailable) counts as off', async () => {
  setup();
  mockFetch({ local: [json(503, { error: { message: "Ollama isn't answering", type: 'upstream_unavailable' } })],
              openrouter: [orOk('cloud')] });
  eq(await P.callAI('SYS', 'hi'), 'cloud', 'reply');
});
await t('once found down, the next call skips straight to OpenRouter for a while', async () => {
  setup();
  const calls = mockFetch({ local: [new TypeError('Failed to fetch')], openrouter: [orOk('a'), orOk('b')] });
  await P.callAI('SYS', 'one');
  await P.callAI('SYS', 'two');
  eq(calls.filter(c => c.url.startsWith(BASE)).length, 1, 'local asked once, not twice');
  const sub = P.takeModelSubstitution();
  ok(/moment ago/.test(sub.reason), sub.reason);
});
await t('a refused sign-in is shown, never covered by OpenRouter', async () => {
  setup();
  const calls = mockFetch({ local: [json(401, { error: { message: 'The local AI rejected the access key.', type: 'unauthorized' } })],
                            openrouter: [orOk('should not be used')] });
  let err;
  try { await P.callAI('SYS', 'hi'); } catch (e) { err = e; }
  ok(err, 'threw');
  eq(err.status, 401, 'status');
  eq(calls.filter(c => c.url.includes('openrouter')).length, 0, 'no fallback');
  ok(/tracker sign-in/.test(explainFetchError(err)) && /Sign out and back in/.test(explainFetchError(err)), explainFetchError(err));
});
await t('too big for the model\'s context: passed up so the scan divides the pages', async () => {
  setup();
  const { isSplittableFailure } = await import('../src/blueprints/scanLayers.js');
  mockFetch({ local: [json(413, { error: { message: 'Too large for the local model: about 21000 tokens, context holds 16384. Send fewer pages at once.', type: 'context_length_exceeded' } })],
             openrouter: [orOk('no')] });
  let err;
  try { await P.callAI('SYS', pageBlocks); } catch (e) { err = e; }
  ok(err && isSplittableFailure(err.message), err && err.message);
});
await t('a model error is retried once, then covered', async () => {
  setup();
  const calls = mockFetch({ local: [json(500, { error: { message: 'minicpm-v: out of memory', type: 'model_error' } })],
                            openrouter: [orOk('cloud')] });
  eq(await P.callAI('SYS', 'hi'), 'cloud', 'reply');
  eq(calls.filter(c => c.url.startsWith(BASE)).length, 2, 'tried twice');
  ok(/out of memory/.test(P.takeModelSubstitution().reason), 'reason names the error');
});
await t('fallback turned off: the desktop being off is the error, with the fix', async () => {
  setup({ fallback: false });
  const calls = mockFetch({ local: [new TypeError('Failed to fetch')], openrouter: [orOk('no')] });
  let err;
  try { await P.callAI('SYS', 'hi'); } catch (e) { err = e; }
  ok(err && err.unreachable, 'unreachable error');
  eq(calls.filter(c => c.url.includes('openrouter')).length, 0, 'no fallback');
  const msg = explainFetchError(err);
  ok(/desktop on/.test(msg) && /Use OpenRouter/.test(msg), msg);
});
await t('no OpenRouter key: nothing to fall back to, so the local error stands', async () => {
  setup({ orKey: '' });
  mockFetch({ local: [new TypeError('Failed to fetch')] });
  let err;
  try { await P.callAI('SYS', 'hi'); } catch (e) { err = e; }
  ok(err && err.provider === 'local', 'local error');
});
await t('both down: the message says the backup failed too', async () => {
  setup();
  mockFetch({ local: [new TypeError('Failed to fetch')],
              openrouter: [json(401, { error: { message: 'User not found.' } })] });
  let err;
  try { await P.callAI('SYS', 'hi'); } catch (e) { err = e; }
  const msg = explainFetchError(err);
  ok(/local AI was unreachable/.test(msg) && /OpenRouter/.test(msg), msg);
});
await t('missing address or key is NO_API_KEY, explained for the local AI', async () => {
  localStorage.clear();
  keys.setAiProvider('local');
  P.resetLocalAiState();
  let err;
  try { await P.callAI('SYS', 'hi'); } catch (e) { err = e; }
  eq(err.message, 'NO_API_KEY', 'code');
  ok(/server address hasn't been set up/.test(explainFetchError(err)) && /Shop Server/.test(explainFetchError(err)), explainFetchError(err));
});
await t('a truly successful local call reports no substitution', async () => {
  setup();
  mockFetch({ local: [localOk('fine')] });
  await P.callAI('SYS', 'hi');
  eq(P.takeModelSubstitution(), null, 'none');
});

console.log('\n=== the PDF text layer ===');
// pdf.js text items: transform[4] is x, transform[5] is y (up is bigger).
const item = (str, x, y, h = 10) => ({ str, transform: [h, 0, 0, h, x, y], height: h });
await t('a parts table written column by column reads back row by row', () => {
  // How a CAD export typically orders it: all item numbers, then all
  // descriptions, then all quantities.
  const items = [
    item('1', 10, 700), item('2', 10, 680),
    item('BEARING, FLANGE', 40, 700.6), item('SHAFT 3" SCH 80', 40, 679.8),
    item('2', 300, 700), item('1', 300, 680)
  ];
  const lines = textItemsToLines(items);
  eq(lines.join(' | '), '1 BEARING, FLANGE 2 | 2 SHAFT 3" SCH 80 1', 'rows');
});
await t('blank runs and junk items are ignored', () => {
  eq(textItemsToLines([item('  ', 1, 1), { str: 'x' }, null, item('A', 1, 1)]).join('|'), 'A', 'only A');
});
await t('a sheet with no real text sends nothing', () => {
  eq(textLayerFromItems([item('A', 1, 1), item('3', 5, 50)]), '', 'too little to be worth it');
});
await t('a very long page is cut off, and says so', () => {
  const many = Array.from({ length: 400 }, (_, i) => item(`ITEM ${i} DESCRIPTION TEXT`, 10, 10000 - i * 12));
  const text = textLayerFromItems(many, 1000);
  ok(text.length < 1100 && /cut off here/.test(text), `length ${text.length}`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
