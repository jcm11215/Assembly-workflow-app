// Tests blueprints/ui.js's componentMapHtml() -- pins on the ACTUAL
// scanned drawing (not a synthesized schematic), placed from each
// component's normalized {x,y} (see spec.js's normPosition). The image
// itself is pre-seeded straight into componentMapPageCache so this
// exercises the rendering/grouping/page-selection logic without needing
// to mock fetch or pdf.js's page-rendering path.
import './stub.mjs';
const ui = await import('../src/blueprints/ui.js');
const images = await import('../src/blueprints/images.js');

let pass = 0, fail = 0;
const t = (n, fn) => {
  try { fn(); pass++; console.log('  PASS ' + n); }
  catch (e) { fail++; console.log('  FAIL ' + n + ' -> ' + e.constructor.name + ': ' + e.message); }
};

const job = (id, bom, hasImage = true) => ({
  id, jobNumber: 'SC-' + id, hasBlueprintImage: hasImage, billOfMaterials: bom
});

console.log('=== componentMapHtml: gating ===');
t('no blueprint image -> nothing rendered', () => {
  const html = ui.componentMapHtml(job('g1', [
    { item: 'Drive', stage: 'drive', source_page: 1, position: { x: .1, y: .1 } }
  ], false));
  if (html !== '') throw new Error('expected empty string, got: ' + html);
});
t('blueprint image but no positioned components -> nothing rendered', () => {
  const html = ui.componentMapHtml(job('g2', [
    { item: 'Drive', stage: 'drive', source_page: 1, position: null },
    { item: 'Reducer', stage: 'drive', source_page: null, position: { x: .2, y: .2 } }   // no source_page
  ]));
  if (html !== '') throw new Error('expected empty string, got: ' + html);
});

console.log('\n=== componentMapHtml: single-page pin rendering ===');
images.componentMapPageCache['p1:1'] = { base64: 'AAAA', mime: 'image/jpeg' };
const html = ui.componentMapHtml(job('p1', [
  { item: 'Drive', stage: 'drive', source_page: 1, position: { x: 0.123456, y: 0.5 }, specification: '5HP', quantity: 1 },
  { item: 'Reducer', stage: 'drive', source_page: 1, position: null },   // no visual location -- must be skipped
  { item: 'Hanger Bearing', stage: 'bearings', source_page: 1, position: { x: 0.5, y: 0.4 } }
]));
t('renders the cached page image', () => {
  if (!html.includes('data:image/jpeg;base64,AAAA')) throw new Error('image not in output: ' + html.slice(0, 200));
});
t('one pin per positioned component, null-position one skipped', () => {
  const count = (html.match(/class="bp-pin"/g) || []).length;
  if (count !== 2) throw new Error('expected 2 pins, got ' + count);
});
t('position written as a percentage of the page image', () => {
  if (!html.includes('left:12.35%') || !html.includes('top:50.00%')) throw new Error('percentage math wrong -- ' + html);
});
t('pin label shows the item name', () => {
  if (!html.includes('>Drive<') || !html.includes('>Hanger Bearing<')) throw new Error('label text missing');
});
t('a single page produces no page-switch tabs', () => {
  if (html.includes('bp-map-page')) throw new Error('unexpected page tabs for a single-page scan');
});

console.log('\n=== componentMapHtml: multi-page grouping ===');
images.componentMapPageCache['p2:1'] = { base64: 'PAGE1', mime: 'image/jpeg' };
images.componentMapPageCache['p2:2'] = { base64: 'PAGE2', mime: 'image/jpeg' };
const html2 = ui.componentMapHtml(job('p2', [
  { item: 'Drive', stage: 'drive', source_page: 1, position: { x: 0.1, y: 0.1 } },
  { item: 'Reducer', stage: 'drive', source_page: 2, position: { x: 0.2, y: 0.2 } },
  { item: 'Coupling Bolts', stage: 'screw', source_page: 2, position: { x: 0.3, y: 0.3 } }
]));
t('multi-page scan shows page-switch tabs', () => {
  if (!html2.includes('data-action="bp-map-page"')) throw new Error('expected page tabs');
});
t('defaults to the page with more positioned components (page 2)', () => {
  if (!html2.includes('data:image/jpeg;base64,PAGE2')) throw new Error('did not default to the busier page: ' + html2.slice(0, 300));
});
t('the less-busy page is offered as a tab, not shown by default', () => {
  if (html2.includes('data:image/jpeg;base64,PAGE1')) throw new Error('should not render page 1\'s image by default');
});

console.log('\n=== componentMapHtml: page choice persists across re-renders ===');
ui.setComponentMapPage('p2', 1);
const html3 = ui.componentMapHtml(job('p2', [
  { item: 'Drive', stage: 'drive', source_page: 1, position: { x: 0.1, y: 0.1 } },
  { item: 'Reducer', stage: 'drive', source_page: 2, position: { x: 0.2, y: 0.2 } },
  { item: 'Coupling Bolts', stage: 'screw', source_page: 2, position: { x: 0.3, y: 0.3 } }
]));
t('a manually selected page is remembered on the next render', () => {
  if (!html3.includes('data:image/jpeg;base64,PAGE1')) throw new Error('manual page selection was not honored: ' + html3.slice(0, 300));
});

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
