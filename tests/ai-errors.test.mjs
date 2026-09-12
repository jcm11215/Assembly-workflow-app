// What the person is told when an AI call fails. The wording matters:
// the raw provider text for a rejected key reads like the app is broken,
// which sends people hunting for a fault in their drawing instead of
// pasting a new key into Settings.
import './stub.mjs';
const { explainFetchError } = await import('../src/ai/errors.js');

let pass = 0, fail = 0;
const t = (n, fn) => {
  try { fn(); pass++; console.log('  PASS ' + n); }
  catch (e) { fail++; console.log('  FAIL ' + n + ' -> ' + e.constructor.name + ': ' + e.message); }
};
const has = (s, re, what) => { if (!re.test(s)) throw new Error(`${what}: got "${s}"`); };

console.log('=== a rejected key ===');
t("Google's OAuth wall of text becomes one actionable sentence", () => {
  // The real message, verbatim from the activity log.
  const m = explainFetchError(new Error('Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential. See https://developers.google.com/identity/sign-in/web/devconsole-project.'));
  has(m, /rejected the API key/i, 'says the key was rejected');
  has(m, /Settings/, 'says where to fix it');
  if (/OAuth 2|devconsole|login cookie/.test(m)) throw new Error('leaked the raw provider text: ' + m);
});
t('the other spellings providers use are recognised', () => {
  for (const raw of ['API key not valid. Please pass a valid API key.', 'API_KEY_INVALID',
                     'Unauthorized', 'HTTP 401', 'HTTP 403', 'Permission denied']) {
    has(explainFetchError(new Error(raw)), /rejected the API key/i, raw);
  }
});

console.log('\n=== other failures keep their own advice ===');
t('a missing key asks for one', () => {
  has(explainFetchError(new Error('NO_API_KEY')), /Add your .* API key/i, 'missing key');
});
t('a network failure blames the connection, not the key alone', () => {
  has(explainFetchError(new Error('Failed to fetch')), /Couldn't reach/i, 'network');
});
t('a rate limit says to wait rather than to replace the key', () => {
  const m = explainFetchError(new Error('RESOURCE_EXHAUSTED: quota exceeded'));
  has(m, /free tier|quota|rate/i, 'names the quota');
  has(m, /minute|wait/i, 'tells them time is the fix');
  if (/rejected the API key/.test(m)) throw new Error('mistook a quota for a bad key');
});
t('an unrecognised message is passed through rather than swallowed', () => {
  has(explainFetchError(new Error('the model refused to answer')), /refused to answer/, 'passthrough');
});
t('a missing error still says something', () => {
  if (!explainFetchError(null)) throw new Error('empty');
  if (!explainFetchError(new Error(''))) throw new Error('empty');
});

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
