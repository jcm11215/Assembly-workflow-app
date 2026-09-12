// The whole path a scanned new job takes: four AI passes -> normalize ->
// join -> prefill -> the job is created -> the blueprint and its
// components are written. The failure this exists to catch is a scan
// that reads the drawing correctly and then lands in the database with
// zero components, so the job opens saying nothing was ever scanned.
import './runtime/dom-harness.mjs';
import { DB } from './runtime/mock-backend.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => {
  try { fn(); pass++; console.log('  PASS ' + n); }
  catch (e) { fail++; console.log('  FAIL ' + n + ' -> ' + e.constructor.name + ': ' + e.message); }
};
const eq = (a, b, what) => { if (a !== b) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

// ---- realistic replies, one per pass, keyed by what the prompt asks ----
const REPLIES = {
  classify: JSON.stringify({ pages: [ { page: 1, view: 'general_assembly' }, { page: 2, view: 'bom' } ] }),
  parts: JSON.stringify({
    drawing_number: '2501-010',
    jobNumber: '2024-017H',
    customer: 'EARTHCARE LLC',
    description: `12" DIA X 20' LG INCLINED SCREW CONVEYOR`,
    parts: [
      { balloon: 3, item: 'Motor', item_as_drawn: 'GEARMOTOR, 5HP 39RPM TEFC', quantity: 1,
        installation_location: 'drive_end', source_page: 2, extraction_method: 'bom_table', confidence: 0.9 },
      { balloon: 7, item: 'Hanger Bearing', item_as_drawn: 'HNGR BRG ASSY, UHMW', quantity: 2,
        installation_location: 'hanger', source_page: 2, extraction_method: 'bom_table', confidence: 0.9 },
      { balloon: 11, item: 'Auger', item_as_drawn: `12" DIA X 12" PITCH SECTIONAL FLIGHTS`, quantity: 3,
        installation_location: 'screw', source_page: 2, extraction_method: 'bom_table', confidence: 0.85 },
      { balloon: 4, item: 'Trough Section', item_as_drawn: 'U-TROUGH 12GA', quantity: 4,
        installation_location: 'trough', source_page: 2, extraction_method: 'bom_table', confidence: 0.9 }
    ]
  }),
  callouts: JSON.stringify({
    callouts: [
      { balloon: 3,  source_page: 1, position: { x: 0.86, y: 0.42 }, confidence: 0.9 },
      { balloon: 7,  source_page: 1, position: { x: 0.38, y: 0.50 }, confidence: 0.9 },
      { balloon: 7,  source_page: 1, position: { x: 0.58, y: 0.50 }, confidence: 0.9 },
      { balloon: 11, source_page: 1, position: { x: 0.47, y: 0.46 }, confidence: 0.8 }
    ]
  }),
  // Deliberately carries the bad escape that sank a real scan.
  dimensions: `{"jobNumber":"2024-017H","customer":"EARTHCARE LLC","description":"12\\" DIA X 20\\' LG INCLINED SCREW CONVEYOR","conveyorType":"screw","orientation":{"drive_end_side":"right","detail":"gearmotor at the right end"},"overall":{"overall_length":{"value":20,"unit":"ft","source_page":1,"source":"dim","description":"length","confidence":0.9,"method":"direct","status":"ok"}},"trough":{},"screw":{},"hangers":{},"drive":{},"tail":{},"inlets_outlets":[],"frame":{},"belt":{},"head":{},"idlers":{},"conflicts":[],"notes":""}`
};

// Route each call to the reply for the pass that made it, by looking at
// the system prompt -- the same way the real provider sees them.
let seen = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opt = {}) => {
  const u = String(url);
  if (!(u.includes('generativelanguage') || u.includes('openrouter'))) return realFetch(url, opt);
  const body = opt.body ? JSON.parse(opt.body) : {};
  const prompt = JSON.stringify(body);
  // Order matters: the callout prompt SAYS "do NOT transcribe the parts
  // table", so a naive parts match would claim it. Test each pass on a
  // phrase only that pass's prompt contains.
  let which = 'dimensions';
  if (/classify which kind of page/i.test(prompt)) which = 'classify';
  else if (/BALLOON CALLOUT is a small circle/i.test(prompt)) which = 'callouts';
  else if (/transcribe the parts table/i.test(prompt)) which = 'parts';
  seen.push(which);
  const txt = JSON.stringify({ candidates: [{ content: { parts: [{ text: REPLIES[which] }] }}] });
  return { ok: true, status: 200, text: async () => txt, json: async () => JSON.parse(txt) };
};

// A signed-in lead, and a Gemini key so the provider call is attempted.
const { setCachedProfile } = await import('../src/auth/profileService.js');
setCachedProfile({ id: 'u-lead', full_name: 'Test Lead', role: 'lead', active: true });
localStorage.setItem('awt_aiProvider', 'gemini');
localStorage.setItem('awt_geminiKey', 'test-key');

const extract = await import('../src/blueprints/extract.js');
const blueprintsRepo = await import('../src/db/blueprintsRepo.js');

console.log('=== the four passes ===');
// contentBlocksFor needs a File; call the pipeline with blocks directly.
const blocks = [
  { type: 'text', text: 'PDF page 1:' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AA' } },
  { type: 'text', text: 'PDF page 2:' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'BB' } }
];
const result = await extract.runExtractionPipelineForTest(blocks, true);

t('all four passes ran', () => {
  eq(seen.filter(s => s === 'classify').length, 1, 'classification');
  eq(seen.filter(s => s === 'parts').length, 1, 'parts');
  eq(seen.filter(s => s === 'callouts').length, 1, 'callouts');
  eq(seen.filter(s => s === 'dimensions').length, 1, 'dimensions');
});
t('the title block came through', () => {
  eq(result.parsed.jobNumber, '2024-017H', 'job number');
  eq(result.parsed.customer, 'EARTHCARE LLC', 'customer');
});
t('the dimensions reply with a bad escape was repaired, not lost', () => {
  if (result.diagnostics.parseError.length) {
    throw new Error('a pass failed: ' + JSON.stringify(result.diagnostics.parseError));
  }
});
t('THE COMPONENTS SURVIVE THE PIPELINE', () => {
  if (!result.components.length) {
    throw new Error('zero components out of a scan that read four parts -- ' +
      JSON.stringify(result.diagnostics));
  }
});
t('the trough section was dropped by the whitelist and the rest kept', () => {
  const names = result.components.map(c => c.item);
  if (names.includes('Trough Section')) throw new Error('whitelist let a trough through');
  eq(result.components.filter(c => c.item === 'Hanger Bearing').length, 2,
     'the doubly-ballooned hanger became two located instances');
});
t('the located parts carry a position', () => {
  const placed = result.components.filter(c => c.position);
  if (placed.length < 3) throw new Error('expected at least 3 placed, got ' + placed.length +
    ' -- ' + JSON.stringify(result.diagnostics));
});

console.log('\n=== and reach the database ===');
DB.jobs.push({ id: 'job-1', job_number: '2024-017H', customer: 'EARTHCARE LLC', version: 1 });
const saved = await blueprintsRepo.saveExtraction('job-1', {
  components: result.components,
  originalFile: { base64: 'AAAA', mimeType: 'application/pdf', filename: 'FABS.PDF' },
  thumbnail: 'thumb'
});

t('a blueprint row is written', () => {
  eq(DB.blueprints.length, 1, 'blueprint rows');
  eq(DB.blueprints[0].job_id, 'job-1', 'job id');
});
t('THE COMPONENTS ARE WRITTEN TOO', () => {
  const rows = DB.blueprint_components.filter(c => c.blueprint_id === saved.id);
  if (!rows.length) throw new Error('the blueprint saved with zero components -- this is the bug');
  eq(rows.length, result.components.length, 'component rows');
});
t('and read back with their names and positions', () => {
  const back = DB.blueprint_components.filter(c => c.blueprint_id === saved.id);
  if (!back.some(c => c.item_as_drawn === 'GEARMOTOR, 5HP 39RPM TEFC')) {
    throw new Error("the drawing's own wording did not persist");
  }
  if (!back.some(c => c.position_x != null)) throw new Error('no position persisted');
  if (!back.some(c => c.balloon)) throw new Error('no balloon number persisted');
});

console.log('\n=== an empty scan says which of the three things happened ===');
const { statusToastForTest } = await import('../src/blueprints/extract.js');

t('a pass that never completed says to try again', () => {
  const m = statusToastForTest(0, { parseError: [{ pass: 'parts list', failed: true }] });
  if (!/parts list/.test(m)) throw new Error('does not name the pass: ' + m);
  if (!/again/i.test(m)) throw new Error('does not say to retry: ' + m);
});
t('a whitelist that rejected everything names what it skipped', () => {
  const m = statusToastForTest(0, { parseError: [], kept: 0, returnedByAi: 6,
    droppedNames: ['U-TROUGH 12GA', 'END PLATE', 'LIFTING LUG'] });
  if (!/U-TROUGH/.test(m)) throw new Error('does not name what was skipped: ' + m);
  if (!/by hand/i.test(m)) throw new Error('does not offer the manual route: ' + m);
});
t('an AI that found nothing says so plainly', () => {
  const m = statusToastForTest(0, { parseError: [], kept: 0, returnedByAi: 0, droppedNames: [] });
  if (!/found no parts/i.test(m)) throw new Error('unclear: ' + m);
});
t('no message ever tells a shop floor to open a browser console', () => {
  for (const d of [ { parseError: [{ pass: 'parts list' }] },
                    { parseError: [], kept: 0, returnedByAi: 3, droppedNames: ['X'] },
                    { parseError: [] }, null ]) {
    const m = statusToastForTest(0, d);
    if (/console/i.test(m)) throw new Error('mentions the console: ' + m);
  }
});
t('a scan that worked just reports the count', () => {
  if (!/Extracted 16 components/.test(statusToastForTest(16, {}))) throw new Error('bad success message');
  if (!/Extracted 1 component\b/.test(statusToastForTest(1, {}))) throw new Error('bad singular');
});

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
