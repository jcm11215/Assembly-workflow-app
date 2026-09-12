// Telling one kind of Google credential from another.
//
// This exists because a Gemini API key and an AI Studio ephemeral token
// look equally plausible to a person pasting one in, and getting it
// wrong produces "Request had invalid authentication credentials.
// Expected OAuth 2 access token, login cookie or other valid
// authentication credential" -- which reads like the app is broken, sends
// people to regenerate a key that was never the right type, and wastes
// hours. The shape is checkable, so it gets checked.
import './stub.mjs';
const { describeGeminiKeyShape } = await import('../src/ai/diagnose.js');

let pass = 0, fail = 0;
const t = (n, fn) => {
  try { fn(); pass++; console.log('  PASS ' + n); }
  catch (e) { fail++; console.log('  FAIL ' + n + ' -> ' + e.constructor.name + ': ' + e.message); }
};
const has = (s, re, what) => { if (!re.test(s)) throw new Error(`${what}: got "${s}"`); };

// A real Gemini key is AIza + 35 more characters.
const realShape = 'AIza' + 'B'.repeat(35);

console.log('=== a well-formed key ===');
t('AIza + 35 characters is accepted', () => {
  const r = describeGeminiKeyShape(realShape);
  if (!r.ok) throw new Error('rejected a well-formed key: ' + r.why);
});
t('surrounding whitespace from a paste is ignored', () => {
  if (!describeGeminiKeyShape('  ' + realShape + '\n').ok) throw new Error('rejected over whitespace');
});

console.log('\n=== the credential that caused this ===');
t('an AI Studio ephemeral token is identified by name', () => {
  const r = describeGeminiKeyShape('AQ.Ab8RN6Jxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
  if (r.ok) throw new Error('accepted an ephemeral token');
  has(r.why, /ephemeral/i, 'names what it is');
  has(r.why, /aistudio\.google\.com/, 'says where to get the right one');
  has(r.why, /AIza/, 'says what the right one looks like');
});
t('an OAuth access token is identified', () => {
  const r = describeGeminiKeyShape('ya29.a0ARrdaM-xxxxxxxxxxxxxxxxxxxx');
  if (r.ok) throw new Error('accepted an OAuth token');
  has(r.why, /OAuth/i, 'names it');
});

console.log('\n=== keys pasted into the wrong field ===');
t('an OpenRouter key in the Gemini box is called out, with both fixes', () => {
  const r = describeGeminiKeyShape('sk-or-v1-abcdef0123456789');
  if (r.ok) throw new Error('accepted an OpenRouter key as a Google key');
  has(r.why, /OpenRouter/, 'names the provider');
  has(r.why, /switch the provider|paste a Google key/i, 'offers a way out');
});
t('an OpenAI-style key is called out', () => {
  const r = describeGeminiKeyShape('sk-proj-abcdef0123456789');
  if (r.ok) throw new Error('accepted an sk- key');
  has(r.why, /Google/, 'points at Google');
});

console.log('\n=== near misses, which are the easiest to miss ===');
t('a truncated AIza key says it is the wrong length', () => {
  const r = describeGeminiKeyShape('AIzaB'.repeat(3));
  if (r.ok) throw new Error('accepted a short key');
  has(r.why, /39/, 'gives the expected length');
  has(r.why, /truncated|double-pasted/i, 'names the likely cause');
});
t('a double-pasted key is rejected', () => {
  if (describeGeminiKeyShape(realShape + realShape).ok) throw new Error('accepted a doubled key');
});
t('an empty field says so rather than guessing', () => {
  for (const v of ['', '   ', null, undefined]) {
    const r = describeGeminiKeyShape(v);
    if (r.ok) throw new Error('accepted empty: ' + JSON.stringify(v));
    has(r.why, /No Gemini key/i, 'empty');
  }
});
t('an unrecognised string reports what it actually got', () => {
  const r = describeGeminiKeyShape('hunter2');
  if (r.ok) throw new Error('accepted nonsense');
  has(r.why, /7 characters/, 'reports the length it saw');
});
t('no message ever claims a key is expired -- that is a different fault', () => {
  for (const v of ['AQ.abc', 'ya29.abc', 'sk-or-v1-abc', 'hunter2', '']) {
    const r = describeGeminiKeyShape(v);
    if (/expired/i.test(r.why)) throw new Error('claimed expiry for: ' + v);
  }
});

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
