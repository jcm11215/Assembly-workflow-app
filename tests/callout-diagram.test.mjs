// The job page's callout diagram: the real scanned drawing with numbered
// balloons on each part and leader lines out to labels in the margins.
// The page image is seeded straight into the cache so this covers the
// rendering and page-selection logic without mocking fetch or pdf.js.
import './stub.mjs';
const dia = await import('../src/blueprints/calloutDiagram.js');
const images = await import('../src/blueprints/images.js');

let pass = 0, fail = 0;
const t = (n, fn) => {
  try { fn(); pass++; console.log('  PASS ' + n); }
  catch (e) { fail++; console.log('  FAIL ' + n + ' -> ' + e.constructor.name + ': ' + e.message); }
};

const job = (id, bom, hasImage = true) => ({
  id, jobNumber: 'SC-' + id, hasBlueprintImage: hasImage, billOfMaterials: bom
});
const part = (item, page, x, y, extra) => ({
  item, stage: 'drive', source_page: page, position: { x, y }, ...(extra || {})
});

console.log('=== nothing to draw ===');
t('no blueprint image -> nothing rendered', () => {
  if (dia.calloutDiagramHtml(job('g1', [part('Drive', 1, .1, .1)], false)) !== '') throw new Error('expected empty');
});
t('a scan with no pinned parts -> nothing rendered', () => {
  const h = dia.calloutDiagramHtml(job('g2', [{ item: 'Drive', stage: 'drive', source_page: 1, position: null }]));
  if (h !== '') throw new Error('expected empty, got: ' + h.slice(0, 120));
});

console.log('\n=== the drawing itself is what gets shown ===');
images.componentMapPageCache['d1:1'] = { base64: 'REALSHEET', mime: 'image/jpeg' };
const html = dia.calloutDiagramHtml(job('d1', [
  part('Drive', 1, 0.15, 0.30, { item_as_drawn: 'SCREW CONV DRIVE 3/4HP', quantity: 1 }),
  part('Hanger Bearing', 1, 0.55, 0.50),
  part('Tail Shaft', 1, 0.85, 0.70),
  { item: 'Gasket', stage: 'other', source_page: 1, position: null }   // no location -> no balloon
]));
t('renders the scanned sheet, not a synthesized picture', () => {
  if (!html.includes('data:image/jpeg;base64,REALSHEET')) throw new Error('sheet image missing');
});
t('one balloon per locatable part, the unlocatable one left off', () => {
  const n = (html.match(/class="cv-balloon"/g) || []).length;
  if (n !== 3) throw new Error('expected 3 balloons, got ' + n);
});
t('a leader line per balloon', () => {
  const n = (html.match(/<line /g) || []).length;
  if (n !== 3) throw new Error('expected 3 leader lines, got ' + n);
});
t('labels name the part', () => {
  if (!html.includes('Hanger Bearing') || !html.includes('Tail Shaft')) throw new Error('label text missing');
});
t('the drawing\'s own wording rides along where it differs', () => {
  if (!html.includes('SCREW CONV DRIVE 3/4HP')) throw new Error('drawn wording missing');
});
t('balloon numbers and label numbers are the same set', () => {
  const balloons = [...html.matchAll(/class="cv-balloon"[^>]*>(\d+)</g)].map(m => m[1]).sort();
  const labels = [...html.matchAll(/class="cv-num"[^>]*>(\d+)</g)].map(m => m[1]).sort();
  // Each part appears once as a gutter label and once in the phone legend.
  const uniqLabels = [...new Set(labels)].sort();
  if (balloons.join() !== uniqLabels.join()) throw new Error(balloons.join() + ' vs ' + uniqLabels.join());
});
t('a numbered legend is rendered for the phone layout', () => {
  if (!html.includes('cv-legend')) throw new Error('legend missing');
});

console.log('\n=== multi-sheet scans ===');
images.componentMapPageCache['d2:1'] = { base64: 'SHEET1', mime: 'image/jpeg' };
images.componentMapPageCache['d2:2'] = { base64: 'SHEET2', mime: 'image/jpeg' };
const twoSheets = [part('Drive', 1, .2, .2), part('Reducer', 2, .3, .3), part('Auger', 2, .6, .6)];
const h2 = dia.calloutDiagramHtml(job('d2', twoSheets));
t('offers a tab per sheet that has parts on it', () => {
  if ((h2.match(/data-action="cv-page"/g) || []).length !== 2) throw new Error('expected 2 sheet tabs');
});
t('opens on the sheet with the most parts', () => {
  if (!h2.includes('SHEET2')) throw new Error('did not open on the busier sheet');
  if (h2.includes('SHEET1')) throw new Error('should not render the other sheet at the same time');
});
t('a chosen sheet is remembered on the next render', () => {
  dia.setCalloutPage('d2', 1);
  const h3 = dia.calloutDiagramHtml(job('d2', twoSheets));
  if (!h3.includes('SHEET1')) throw new Error('sheet choice not honoured');
});

console.log('\n=== loading and failure states ===');
t('an unloaded sheet asks for it and says so, rather than rendering blank', () => {
  const h = dia.calloutDiagramHtml(job('d3', [part('Drive', 1, .2, .2)]));
  if (!/Loading the drawing/.test(h)) throw new Error('expected a loading state');
});
t('a sheet that failed to load says so', () => {
  images.componentMapPageCache['d4:1'] = false;
  const h = dia.calloutDiagramHtml(job('d4', [part('Drive', 1, .2, .2)]));
  if (!/Could not load the drawing/.test(h)) throw new Error('expected a failure state');
});

console.log('\n=== untrusted text is escaped ===');
t('drawing wording cannot inject markup', () => {
  images.componentMapPageCache['d5:1'] = { base64: 'X', mime: 'image/jpeg' };
  const h = dia.calloutDiagramHtml(job('d5', [
    part('Bearing', 1, .5, .5, { item_as_drawn: '<img src=x onerror=alert(1)>' })
  ]));
  if (h.includes('<img src=x')) throw new Error('not escaped');
  if (!h.includes('&lt;img')) throw new Error('expected escaped form');
});

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
