// A scanned component carries two names: `item` is the normalized
// category the shop groups by ("Hanger Bearing"), `item_as_drawn` is the
// wording actually printed on the drawing ("HNGR BRG ASSY 2-7/16"). The
// list shows both -- category as the heading, drawing wording underneath
// -- except when showing both would just say the same thing twice.
import './stub.mjs';
const { bomListHtml } = await import('../src/blueprints/bom.js');

let pass = 0, fail = 0;
const t = (n, fn) => {
  try { fn(); pass++; console.log('  PASS ' + n); }
  catch (e) { fail++; console.log('  FAIL ' + n + ' -> ' + e.constructor.name + ': ' + e.message); }
};

const jobWith = (components) => ({
  id: 'j1', jobNumber: 'SC-1', billOfMaterials: components, blueprintId: 'bp1'
});

console.log('=== the drawing\'s wording appears alongside the category ===');
const html = bomListHtml(jobWith([
  { id:'c1', item:'Hanger Bearing', item_as_drawn:'HNGR BRG ASSY 2-7/16', stage:'bearings', specification:'2-7/16 bore', quantity:3 }
]));
t('the category name is shown', () => {
  if (!html.includes('Hanger Bearing')) throw new Error('category missing');
});
t('the drawing wording is shown verbatim, abbreviations intact', () => {
  if (!html.includes('HNGR BRG ASSY 2-7/16')) throw new Error('drawn wording missing from: ' + html.slice(0, 400));
});
t('the drawing wording is not substituted for the category', () => {
  const i = html.indexOf('Hanger Bearing'), d = html.indexOf('HNGR BRG ASSY');
  if (i === -1 || d === -1 || d < i) throw new Error('expected category first, then the drawn wording');
});

console.log('\n=== redundant or absent wording is left out ===');
t('wording identical to the category is not repeated', () => {
  const h = bomListHtml(jobWith([{ id:'c2', item:'Gasket', item_as_drawn:'Gasket', stage:'other' }]));
  if ((h.match(/Gasket/g) || []).length !== 1) throw new Error('duplicated the same name twice');
});
t('case/spacing differences alone still count as redundant', () => {
  const h = bomListHtml(jobWith([{ id:'c3', item:'Gasket', item_as_drawn:'  GASKET ', stage:'other' }]));
  if (h.includes('bom-drawn')) throw new Error('rendered a second line for what is the same word');
});
t('a component with no drawn wording renders no extra line', () => {
  const h = bomListHtml(jobWith([{ id:'c4', item:'Motor', item_as_drawn:'', stage:'drive' }]));
  if (h.includes('bom-drawn')) throw new Error('rendered an empty drawn line');
});
t('a pre-existing component without the field at all still renders', () => {
  const h = bomListHtml(jobWith([{ id:'c5', item:'Reducer', stage:'drive' }]));
  if (!h.includes('Reducer') || h.includes('bom-drawn')) throw new Error('older row broke or invented a line');
});

console.log('\n=== the wording is escaped, not injected ===');
t('markup in the drawing text is escaped', () => {
  const h = bomListHtml(jobWith([
    { id:'c6', item:'Bearing', item_as_drawn:'<script>alert(1)</script> BRG', stage:'bearings' }
  ]));
  if (h.includes('<script>')) throw new Error('drawing text was not escaped');
  if (!h.includes('&lt;script&gt;')) throw new Error('expected escaped form');
});

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
