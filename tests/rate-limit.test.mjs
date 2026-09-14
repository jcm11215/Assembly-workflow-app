// Rate limiting, which is what was actually breaking scans.
//
// Gemini had no retry at all, so the free tier's per-minute cap was
// fatal to a pass rather than a short pause -- and splitting the scan
// into four passes spent the cap four times faster. A 429 is the most
// retryable failure there is: the server says exactly how long to wait.
import './stub.mjs';
const { retryAfterMs, callGeminiAPI } = await import('../src/ai/providers.js');
const { explainFetchError } = await import('../src/ai/errors.js');

let pass = 0, fail = 0;
const t = (n, fn) => {
  const r = fn();
  return Promise.resolve(r).then(
    () => { pass++; console.log('  PASS ' + n); },
    e => { fail++; console.log('  FAIL ' + n + ' -> ' + e.constructor.name + ': ' + e.message); });
};
const eq = (a, b, what) => { if (a !== b) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

console.log('=== reading the delay the server asked for ===');
// The real 429 body Google returned, from the device screenshot.
const realQuotaBody = {
  error: {
    code: 429, status: 'RESOURCE_EXHAUSTED',
    message: 'You exceeded your current quota, please check your plan and billing details. ' +
             '* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, ' +
             'limit: 20, model: gemini-3.6-flash\nPlease retry in 1.719814202s.',
    details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '1.719814202s' }]
  }
};
await t('takes the exact delay from RetryInfo', () => {
  eq(retryAfterMs(realQuotaBody, null), 1720, 'ms');
});
await t('falls back to the delay repeated in the message', () => {
  const noDetails = { error: { message: 'Quota exceeded. Please retry in 4.5s.' } };
  eq(retryAfterMs(noDetails, null), 4500, 'ms');
});
await t('falls back to a Retry-After header', () => {
  eq(retryAfterMs({}, { get: h => (h === 'retry-after' ? '30' : null) }), 30000, 'ms');
});
await t('returns null when nothing says how long, rather than guessing zero', () => {
  eq(retryAfterMs({ error: { message: 'busy' } }, null), null, 'no delay');
  eq(retryAfterMs(null, null), null, 'no body');
});
await t('an HTTP-date Retry-After is ignored rather than parsed as seconds', () => {
  // "Wed, 21 Oct 2026 07:28:00 GMT" as a number of seconds would be a
  // nonsense wait; better to fall through to the built-in backoff.
  eq(retryAfterMs({}, { get: () => 'Wed, 21 Oct 2026 07:28:00 GMT' }), null, 'date header');
});

console.log('\n=== the retry loop ===');
localStorage.setItem('awt_aiProvider', 'gemini');
localStorage.setItem('awt_geminiKey', 'AIza' + 'k'.repeat(35));

function mockGemini(sequence){
  let i = 0;
  globalThis.fetch = async () => {
    const next = sequence[Math.min(i++, sequence.length - 1)];
    if (next === 'ok'){
      const body = JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ready' }] } }] });
      return { ok: true, status: 200, text: async () => body, headers: { get: () => null } };
    }
    const body = JSON.stringify(next === '429' ? realQuotaBody
      : { error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } });
    return { ok: false, status: next === '429' ? 429 : 400, text: async () => body, headers: { get: () => null } };
  };
  return () => i;
}

await t('a rate-limited call waits and succeeds instead of failing the pass', async () => {
  const calls = mockGemini(['429', 'ok']);
  const started = Date.now();
  const out = await callGeminiAPI('sys', 'hi');
  eq(out, 'ready', 'result');
  eq(calls(), 2, 'attempts');
  if (Date.now() - started < 1700) throw new Error('did not honour the 1.72s the server asked for');
});
await t('a bad key is never retried -- it cannot fix itself', async () => {
  const calls = mockGemini(['400']);
  let threw = null;
  try { await callGeminiAPI('sys', 'hi'); } catch (e) { threw = e; }
  if (!threw) throw new Error('should have thrown');
  eq(calls(), 1, 'attempts -- retrying only delays the real message');
  if (!/API key not valid/.test(threw.message)) throw new Error('lost the provider message');
});
await t('a missing key is never retried', async () => {
  localStorage.setItem('awt_geminiKey', '');
  const calls = mockGemini(['ok']);
  let threw = null;
  try { await callGeminiAPI('sys', 'hi'); } catch (e) { threw = e; }
  eq(threw && threw.message, 'NO_API_KEY', 'error');
  eq(calls(), 0, 'never reached the network');
  localStorage.setItem('awt_geminiKey', 'AIza' + 'k'.repeat(35));
});
await t('it gives up rather than retrying forever', async () => {
  const calls = mockGemini(['429', '429', '429', '429', '429', '429']);
  let threw = null;
  try { await callGeminiAPI('sys', 'hi'); } catch (e) { threw = e; }
  if (!threw) throw new Error('should have given up');
  if (calls() > 4) throw new Error('too many attempts: ' + calls());
});

console.log('\n=== a model that is simply too busy ===');
// The real 503, from the device: "This model is currently experiencing
// high demand. Spikes in demand are usually temporary."
function mockStatus(sequence){
  let i = 0;
  globalThis.fetch = async (url) => {
    const model = /models\/([^:]+):/.exec(String(url));
    const next = sequence[Math.min(i++, sequence.length - 1)];
    if (next === 'ok'){
      const body = JSON.stringify({ candidates: [{ content: { parts: [{ text: 'from ' + (model && model[1]) }] } }] });
      return { ok: true, status: 200, text: async () => body, headers: { get: () => null } };
    }
    const body = JSON.stringify({ error: { code: next, status: 'UNAVAILABLE',
      message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.' } });
    return { ok: false, status: next, text: async () => body, headers: { get: () => null } };
  };
  return () => i;
}

await t('a 503 is retried rather than losing the reading', async () => {
  // Only 429 was retried before, so a passing server wobble was fatal.
  const calls = mockStatus([503, 'ok']);
  const out = await callGeminiAPI('sys', 'hi');
  if (!/from /.test(out)) throw new Error('no answer: ' + out);
  if (calls() < 2) throw new Error('did not retry the 503');
});
await t('a model that stays busy is swapped for one that answers', async () => {
  // Retrying the same model is what Google is telling us not to do --
  // "spikes in demand" is about THAT model.
  const { takeModelSubstitution } = await import('../src/ai/providers.js');
  takeModelSubstitution();
  mockStatus([503, 503, 503, 'ok']);
  const out = await callGeminiAPI('sys', 'hi');
  const swap = takeModelSubstitution();
  if (!swap) throw new Error('no substitution reported -- it must not change models silently');
  if (swap.used === swap.asked) throw new Error('reported a swap to the same model');
  if (!out.includes(swap.used)) throw new Error('the answer did not come from the model it claims');
});
await t('a rejected key is still never retried or swapped', async () => {
  globalThis.fetch = async () => {
    const body = JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } });
    return { ok: false, status: 400, text: async () => body, headers: { get: () => null } };
  };
  let threw = null;
  try { await callGeminiAPI('sys', 'hi'); } catch (e) { threw = e; }
  if (!threw || !/API key not valid/.test(threw.message)) throw new Error('lost the real message');
});
await t('"too busy" is never described as something the person broke', () => {
  const m = explainFetchError(new Error('This model is currently experiencing high demand.'));
  if (!/too busy/i.test(m)) throw new Error('unclear: ' + m);
  if (/rejected the API key|free tier is out/i.test(m)) throw new Error('blamed the wrong thing: ' + m);
});

console.log('\n=== what the person is told when it still fails ===');
await t('the quota message says the cap and that waiting already happened', () => {
  const m = explainFetchError(new Error(realQuotaBody.error.message));
  if (!/free tier/i.test(m)) throw new Error('does not name the free tier: ' + m);
  if (!/cap: 20/.test(m)) throw new Error('does not quote the actual cap: ' + m);
  if (!/already waited/i.test(m)) throw new Error('implies they should just retry: ' + m);
});
await t('a quota error is never reported as a bad key', () => {
  const m = explainFetchError(new Error(realQuotaBody.error.message));
  if (/rejected the API key/i.test(m)) throw new Error('mistook a quota for a bad key: ' + m);
});

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
