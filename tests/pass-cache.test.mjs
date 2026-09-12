// Banking each reading of a drawing as it succeeds, so a retry re-runs
// only what failed.
//
// A scan is four separate readings that fail independently. Retrying the
// whole thing after one hits the free tier's per-minute cap spends four
// more requests against the cap that just refused one -- the surest way
// to stay rate-limited. A retry should cost exactly the passes still
// missing, usually one.
import './runtime/dom-harness.mjs';
import './runtime/mock-backend.mjs';

let pass = 0, fail = 0;
const t = async (n, fn) => {
  try { await fn(); pass++; console.log('  PASS ' + n); }
  catch (e) { fail++; console.log('  FAIL ' + n + ' -> ' + e.constructor.name + ': ' + e.message); }
};
const eq = (a, b, what) => { if (a !== b) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const { setCachedProfile } = await import('../src/auth/profileService.js');
setCachedProfile({ id: 'u-lead', full_name: 'Test Lead', role: 'lead', active: true });
localStorage.setItem('awt_aiProvider', 'gemini');
localStorage.setItem('awt_geminiKey', 'AIza' + 'k'.repeat(35));

const extract = await import('../src/blueprints/extract.js');
const { clearAllPasses, fingerprint } = await import('../src/blueprints/passCache.js');

const REPLIES = {
  classify: JSON.stringify({ pages: [{ page: 1, view: 'general_assembly' }, { page: 2, view: 'bom' }] }),
  parts: JSON.stringify({ jobNumber: '2024-017H', customer: 'EARTHCARE LLC', parts: [
    { balloon: 3, item: 'Motor', item_as_drawn: 'GEARMOTOR 5HP', quantity: 1,
      installation_location: 'drive_end', source_page: 2, extraction_method: 'bom_table', confidence: 0.9 }] }),
  callouts: JSON.stringify({ callouts: [{ balloon: 3, source_page: 1, position: { x: 0.8, y: 0.4 }, confidence: 0.9 }] }),
  dimensions: JSON.stringify({ conveyorType: 'screw', overall: {}, orientation: { drive_end_side: 'right' } })
};

// Which pass a call belongs to, and whether it should fail this time.
let calls = [];
let failing = new Set();
function install(){
  globalThis.fetch = async (url, opt = {}) => {
    const u = String(url);
    if (!u.includes('generativelanguage')) throw new Error('unexpected call to ' + u);
    const prompt = JSON.stringify(opt.body ? JSON.parse(opt.body) : {});
    let which = 'dimensions';
    if (/classify which kind of page/i.test(prompt)) which = 'classify';
    else if (/BALLOON CALLOUT is a small circle/i.test(prompt)) which = 'callouts';
    else if (/transcribe the parts table/i.test(prompt)) which = 'parts';
    calls.push(which);
    if (failing.has(which)) {
      const body = JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED',
        message: 'Quota exceeded. Please retry in 0.01s.', details: [{ retryDelay: '0.01s' }] } });
      return { ok: false, status: 429, text: async () => body, headers: { get: () => null } };
    }
    const body = JSON.stringify({ candidates: [{ content: { parts: [{ text: REPLIES[which] }] } }] });
    return { ok: true, status: 200, text: async () => body, headers: { get: () => null } };
  };
}
install();

const blocks = [
  { type: 'text', text: 'PDF page 1:' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'A'.repeat(200) } },
  { type: 'text', text: 'PDF page 2:' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'B'.repeat(200) } }
];
const run = () => extract.runExtractionPipelineForTest(blocks, true);

console.log('=== a retry re-reads only what failed ===');
clearAllPasses();
calls = []; failing = new Set(['parts']);
const first = await run();
const firstCalls = calls.slice();

await t('the first attempt tries every pass', () => {
  // parts is retried in-process by the rate-limit loop, so count distinct.
  eq(new Set(firstCalls).size, 4, 'distinct passes attempted');
});
await t('the pass that failed produced nothing', () => {
  eq(first.components.length, 0, 'components');
  eq((first.diagnostics.parseError || []).map(e => e.pass).join(), 'parts list', 'the failing pass');
});

calls = []; failing = new Set();          // the quota has cleared
const second = await run();

await t('THE RETRY ONLY CALLS THE PASS THAT FAILED', () => {
  eq(calls.join(), 'parts', 'one request, not four -- ' + JSON.stringify(calls));
});
await t('and the reused answers are still correct', () => {
  eq(second.parsed.jobNumber, '2024-017H', 'job number');
  eq(second.components.length, 1, 'components');
  if (!second.components[0].position) throw new Error('the cached callout pass did not place the part');
});
await t('it says which sections were carried over', () => {
  const reused = second.diagnostics.reusedPasses;
  eq(reused.length, 2, 'reused passes: ' + JSON.stringify(reused));
  if (!reused.includes('callouts')) throw new Error('callouts should have been reused');
});

console.log('\n=== a clean scan does not leave stale answers behind ===');
calls = [];
const third = await run();
await t('re-scanning after success really re-reads the drawing', () => {
  // Otherwise "Re-Scan Blueprint" would replay last time's answers,
  // which is the one thing nobody taps it for.
  eq(new Set(calls).size, 4, 'all four passes ran again -- ' + JSON.stringify(calls));
  eq(third.diagnostics.reusedPasses.length, 0, 'nothing reused');
});

console.log('\n=== every pass failing ===');
clearAllPasses();
calls = []; failing = new Set(['classify', 'parts', 'callouts', 'dimensions']);
let threw = null;
try { await run(); } catch (e) { threw = e; }
await t('a scan where nothing landed still raises the real error', () => {
  if (!threw) throw new Error('should have thrown');
  if (!/Quota exceeded/.test(threw.message)) throw new Error('lost the provider message: ' + threw.message);
});
await t('and reports that nothing was banked, so a retry is a full re-read', () => {
  eq((threw.passesAlreadyRead || []).length, 0, 'banked passes');
});

console.log('\n=== a different drawing is not confused with this one ===');
clearAllPasses();
calls = []; failing = new Set();
await run();
const other = blocks.map(b => b.type === 'image'
  ? { ...b, source: { ...b.source, data: 'Z'.repeat(200) } } : b);
await t('two drawings get different fingerprints', () => {
  if (fingerprint(blocks, true) === fingerprint(other, true)) throw new Error('collision');
});
await t('a re-scan and a new-job scan of the same file are kept apart', () => {
  // They ask for different fields, so one cannot stand in for the other.
  if (fingerprint(blocks, true) === fingerprint(blocks, false)) throw new Error('collision');
});

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
