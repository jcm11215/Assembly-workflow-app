// Editing the hardware list from a job's own page.
//
// The BOM used to live only inside a modal. Moving it onto the job page
// broke every control on it in two ways that both look identical from
// the floor -- the button does nothing -- so both are pinned here.
import './runtime/dom-harness.mjs';
import { DB } from './runtime/mock-backend.mjs';

let pass = 0, fail = 0;
const t = async (n, fn) => {
  try { await fn(); pass++; console.log('  PASS ' + n); }
  catch (e) { fail++; console.log('  FAIL ' + n + ' -> ' + e.constructor.name + ': ' + e.message); }
};
const eq = (a, b, what) => { if (a !== b) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const settle = () => new Promise(r => setTimeout(r, 30));

const { setCachedProfile } = await import('../src/auth/profileService.js');
setCachedProfile({ id: 'u-lead', full_name: 'Test Lead', role: 'lead', active: true });

DB.jobs.push({ id: 'j1', job_number: 'SC-4472', customer: 'Acme', description: 'x',
  due_date: '2026-10-30', priority: 'High', stage: 'ready', percent_complete: 0, version: 1 });

await import('../src/app/app.js');
await settle();
const { state } = await import('../src/state/store.js');
const modal = await import('../src/ui/components/modal.js');
const detail = await import('../src/jobs/detail.js');

// Three hangers in one bucket, so the arrows have somewhere to move to.
const comp = (id, item, order) => ({ id, item, item_as_drawn: item.toUpperCase(),
  specification: '', quantity: 1, stage: 'bearings', installation_location: 'hanger',
  source_page: 1, source_callout: '', extraction_method: 'bom_table', confidence: 0.9,
  sortOrder: order, position: null });

state.jobs = [{ id: 'j1', jobNumber: 'SC-4472', customer: 'Acme', description: 'x',
  dueDate: '2026-10-30', priority: 'High', assemblyStatus: 'ready', percentComplete: 0,
  assignedAssembler: '', checklist: {}, blueprintId: 'bp1', hasBlueprintImage: true,
  billOfMaterials: [comp('c1', 'Hanger Bearing A', 0), comp('c2', 'Hanger Bearing B', 1), comp('c3', 'Hanger Bearing C', 2)] }];

// Open the job's page the way a tap on its card does.
detail.openJobDetail('j1', false);
await settle();

const order = () => state.jobs[0].billOfMaterials
  .filter(c => c.stage === 'bearings').map(c => c.id).join(',');

/**
 * The order as it appears ON SCREEN, which is the thing that was broken.
 * Reading state only would have missed it entirely: the reorder always
 * updated state and the database, and simply never repainted.
 */
const onScreen = () => {
  const html = (document.getElementById('content') || {}).innerHTML || '';
  return [...html.matchAll(/data-component-id="(c\d)"[^>]*data-action="bom-move-up"/g)]
    .map(m => m[1]).join(',')
    || [...html.matchAll(/data-action="bom-move-up" data-component-id="(c\d)"/g)].map(m => m[1]).join(',');
};

function click(action, attrs){
  const btn = new globalThis.__El('button');
  btn.setAttribute('data-action', action);
  for (const [k, v] of Object.entries(attrs || {})) btn.setAttribute(k, v);
  const ev = { type: 'click', target: { closest: sel => (sel === '[data-action]' ? btn : null), hasAttribute: () => false }, preventDefault(){} };
  (document._l.click || []).forEach(h => h(ev));
}

console.log('=== the edit controls are reachable from the page ===');
await t('the job page is what is on screen', () => {
  eq(state.tab, 'job', 'tab');
  eq(state.openJobId, 'j1', 'open job');
});
await t('Edit actually toggles edit mode', () => {
  // refreshOpenModal() only repaints a modal, so on the page this flag
  // used to flip with nothing on screen changing.
  eq(state.bomEditing, false, 'starts read-only');
  click('bom-toggle-edit');
  eq(state.bomEditing, true, 'toggled on');
});
await t('and the arrows appear on screen, not just in the markup', () => {
  const html = (document.getElementById('content') || {}).innerHTML || '';
  if (!/data-action="bom-move-up"/.test(html)) throw new Error('toggling Edit did not repaint the page');
  if (!/data-action="bom-remove-component"/.test(html)) throw new Error('no remove control on screen');
});

console.log('\n=== reordering ===');
await t('moving a part down swaps it with the next one', async () => {
  eq(order(), 'c1,c2,c3', 'before');
  click('bom-move-down', { 'data-component-id': 'c1' });
  await settle();
  eq(order(), 'c2,c1,c3', 'in state');
});
await t('AND THE SCREEN ACTUALLY REDRAWS', () => {
  // The whole symptom. refreshOpenModal() repaints a modal and nothing
  // else, so on the job page the list stayed exactly as it was while
  // state and the database moved on -- which reads as a dead button.
  eq(onScreen(), 'c2,c1,c3', 'rendered order');
});
await t('moving it back up restores the order, on screen too', async () => {
  click('bom-move-up', { 'data-component-id': 'c1' });
  await settle();
  eq(order(), 'c1,c2,c3', 'in state');
  eq(onScreen(), 'c1,c2,c3', 'rendered order');
});
await t('the new order is written to the database, not just held on screen', async () => {
  click('bom-move-down', { 'data-component-id': 'c3' });   // already last -- no-op
  await settle();
  eq(order(), 'c1,c2,c3', 'unchanged at the end of its category');
});

console.log('\n=== the bug that made every control dead ===');
await t('a modal opened and closed on the job page does not break the arrows', async () => {
  // closeModal() nulls currentJobId, which every BOM handler used to
  // look the job up by. Report Blocker, Log Error and Edit Details all
  // go through it, so one use of any of them killed the whole section.
  modal.openModal('<div class="modal-sheet">anything</div>', () => '');
  modal.closeModal();
  eq(modal.currentJobId, null, 'the modal really did clear it');

  click('bom-move-down', { 'data-component-id': 'c1' });
  await settle();
  eq(order(), 'c2,c1,c3', 'the reorder still worked with no modal id to go on');
});
await t('and so does removing a part', async () => {
  modal.closeModal();
  click('bom-remove-component', { 'data-component-id': 'c3' });
  await settle();
  eq(state.jobs[0].billOfMaterials.some(c => c.id === 'c3'), false, 'removed');
});

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
