// The join between the two halves of a scan: the parts table (what) and
// the balloon callouts (where). This is the step that used to be done
// inside the prompt, so these are the cases that used to come back as a
// confident label on the wrong part.
import './stub.mjs';
const { joinPartsAndCallouts } = await import('../src/blueprints/scanJoin.js');
const { pagesByRole } = await import('../src/blueprints/prompt.js');

let pass = 0, fail = 0;
const t = (n, fn) => {
  try { fn(); pass++; console.log('  PASS ' + n); }
  catch (e) { fail++; console.log('  FAIL ' + n + ' -> ' + e.constructor.name + ': ' + e.message); }
};
const eq = (a, b, what) => { if (a !== b) throw new Error(`${what}: expected ${b}, got ${a}`); };

const part = (balloon, item, extra) => ({
  balloon: balloon == null ? null : String(balloon),
  item, item_as_drawn: item.toUpperCase(), quantity: 1, confidence: 0.9,
  source_page: 3, source_callout: '', ...(extra || {})
});
const callout = (balloon, x, y, extra) => ({
  balloon, source_page: 2, position: { x, y }, confidence: 0.9, ...(extra || {})
});

console.log('=== matching by item number ===');
t('a balloon puts its part on the drawing', () => {
  const { components } = joinPartsAndCallouts([part(7, 'Hanger Bearing')], { callouts: [callout(7, .4, .5)] });
  eq(components.length, 1, 'count');
  eq(components[0].position.x, .4, 'x');
  eq(components[0].source_page, 2, 'page comes from the callout, not the table row');
  eq(components[0].extraction_method, 'callout', 'method');
});
t('a number in the table and a number on the view match across types', () => {
  // The table pass may return 7 and the callout pass "7" or 7.0.
  const { components } = joinPartsAndCallouts([part('7', 'Bearing')], { callouts: [callout(7.0, .2, .2)] });
  if (!components[0].position) throw new Error('numeric/string balloon did not match');
});
t('a part the drawing never balloons is kept, unplaced', () => {
  const { components, report } = joinPartsAndCallouts([part(9, 'Gasket')], { callouts: [callout(7, .4, .5)] });
  eq(components.length, 1, 'still on the hardware list');
  eq(components[0].position, null, 'position');
  eq(report.notVisible.join(), 'GASKET', 'reported as not visible on the drawing');
});
t('a balloon with no table row is reported, never invented into a part', () => {
  const { components, report } = joinPartsAndCallouts([part(7, 'Bearing')], {
    callouts: [callout(7, .1, .1), callout(31, .8, .8)]
  });
  eq(components.length, 1, 'no phantom part for balloon 31');
  eq(report.unmatchedBalloons.join(), '31', 'unmatched balloon reported');
});

console.log('\n=== identical parts in several places ===');
t('one entry per location, each counted as one', () => {
  const { components } = joinPartsAndCallouts([part(7, 'Hanger Bearing', { quantity: 3 })], {
    callouts: [callout(7, .3, .5), callout(7, .5, .5), callout(7, .7, .5)]
  });
  eq(components.length, 3, 'instances');
  eq(components.map(c => c.quantity).join(), '1,1,1', 'each instance is one');
  eq(components.map(c => c.position.x).join(), '0.3,0.5,0.7', 'each has its own location');
});
t('a single location keeps the table count', () => {
  const { components } = joinPartsAndCallouts([part(7, 'Coupling Bolts', { quantity: 24 })], {
    callouts: [callout(7, .3, .5)]
  });
  eq(components[0].quantity, 24, 'quantity');
});
t('a count the drawing disagrees with is reported, not reconciled', () => {
  const { report } = joinPartsAndCallouts([part(7, 'Hanger Bearing', { quantity: 4 })], {
    callouts: [callout(7, .3, .5), callout(7, .6, .5)]
  });
  if (!/table says 4, found 2/.test(report.quantityMismatches[0] || '')) {
    throw new Error('expected the disagreement to be reported: ' + JSON.stringify(report.quantityMismatches));
  }
});

console.log('\n=== drawings that label in words instead of numbers ===');
t('a text callout matches its table row by wording', () => {
  const { components } = joinPartsAndCallouts([part(null, 'Motor', { item_as_drawn: 'GEARMOTOR, 3/4HP' })], {
    unballooned: [{ label: 'GEARMOTOR 3/4 HP', source_page: 1, position: { x: .1, y: .2 }, confidence: .8 }]
  });
  if (!components[0].position) throw new Error('wording did not match');
  eq(components[0].source_callout, 'GEARMOTOR 3/4 HP', 'the drawing\'s own wording is kept');
});
t('a single shared word is not a match', () => {
  // "BEARING" appears in both, and that is not enough to put a hanger
  // bearing's label on a tail-end flange bearing.
  const { components } = joinPartsAndCallouts([part(null, 'Bearing', { item_as_drawn: 'FLG BRG 2-7/16 BORE' })], {
    unballooned: [{ label: 'HANGER BEARING ASSEMBLY', source_page: 1, position: { x: .5, y: .5 }, confidence: .9 }]
  });
  eq(components[0].position, null, 'should not have matched');
});
t('one text callout is claimed by one part only', () => {
  const parts = [part(null, 'Motor', { item_as_drawn: 'MOTOR 3/4HP' }), part(null, 'Motor', { item_as_drawn: 'MOTOR 3/4HP' })];
  const { components } = joinPartsAndCallouts(parts, {
    unballooned: [{ label: 'MOTOR 3/4HP', source_page: 1, position: { x: .1, y: .1 }, confidence: .9 }]
  });
  eq(components.filter(c => c.position).length, 1, 'only one part placed');
});

console.log('\n=== coordinates ===');
t('a bbox with no leader point falls back to its centre', () => {
  const { components } = joinPartsAndCallouts([part(7, 'Auger')], {
    callouts: [{ balloon: 7, source_page: 1, bbox: [0.2, 0.4, 0.4, 0.2], confidence: .9 }]
  });
  eq(components[0].position.x, 0.4, 'centre x');
  eq(components[0].position.y, 0.5, 'centre y');
});
t('a bbox off the edge of the page is refused, not clamped', () => {
  // A box that needed correcting was not read off the drawing.
  const { components } = joinPartsAndCallouts([part(7, 'Auger')], {
    callouts: [{ balloon: 7, source_page: 1, bbox: [0.9, 0.9, 0.5, 0.5], confidence: .9 }]
  });
  eq(components[0].position, null, 'no position invented from a bad box');
});
t('a callout with neither point nor box places nothing', () => {
  const { components, report } = joinPartsAndCallouts([part(7, 'Auger')], {
    callouts: [{ balloon: 7, source_page: 1, confidence: .9 }]
  });
  eq(components[0].position, null, 'position');
  eq(report.calloutsFound, 0, 'a locationless callout is not a callout');
});
t('an out-of-range point is refused', () => {
  const { components } = joinPartsAndCallouts([part(7, 'Auger')], { callouts: [callout(7, 1.4, .5)] });
  eq(components[0].position, null, 'position');
});

console.log('\n=== confidence and malformed input ===');
t('a shaky balloon read drags the placed part\'s confidence down with it', () => {
  const { components } = joinPartsAndCallouts([part(7, 'Bearing', { confidence: 0.95 })], {
    callouts: [callout(7, .3, .3, { confidence: 0.4 })]
  });
  eq(components[0].confidence, 0.4, 'confidence');
});
t('a missing callout pass leaves the parts list intact', () => {
  const { components, report } = joinPartsAndCallouts([part(7, 'Bearing')], null);
  eq(components.length, 1, 'parts survive');
  eq(report.placed, 0, 'nothing placed');
});
t('a missing parts list yields nothing rather than throwing', () => {
  const { components } = joinPartsAndCallouts(null, { callouts: [callout(7, .1, .1)] });
  eq(components.length, 0, 'count');
});

console.log('\n=== which pages each pass reads ===');
t('splits the set by page role', () => {
  const roles = pagesByRole({ pages: [
    { page: 1, view: 'title_block' }, { page: 2, view: 'general_assembly' },
    { page: 3, view: 'bom' }, { page: 4, view: 'detail_view' }
  ] }, [1, 2, 3, 4]);
  eq(roles.bom.join(), '3', 'bom pages');
  eq(roles.views.join(), '2,4', 'pages with something drawn on them');
  eq(roles.assembly.join(), '2', 'assembly pages');
});
t('an unclassified set falls back to every page, not none', () => {
  const roles = pagesByRole(null, [1, 2, 3]);
  eq(roles.bom.join(), '1,2,3', 'bom');
  eq(roles.views.join(), '1,2,3', 'views');
});
t('a set with no BOM sheet reads the parts table from every page', () => {
  const roles = pagesByRole({ pages: [{ page: 1, view: 'general_assembly' }] }, [1]);
  eq(roles.bom.join(), '1', 'bom falls back rather than coming back empty');
});

console.log('\n=== which end of the machine a part goes on ===');
const { resolveLocations } = await import('../src/blueprints/scanJoin.js');
const unknown = (item, extra) => ({ item, installation_location: 'unknown', stage: 'other', ...(extra || {}) });

t('a category with only one possible home settles itself', () => {
  const { components } = resolveLocations([unknown('Motor'), unknown('Hanger Bearing'), unknown('Tail Shaft')], null);
  eq(components.map(c => c.installation_location).join(), 'drive_end,hanger,tail_end', 'locations');
});
t('the stage moves with the location', () => {
  // stage is derived from location, so a location fixed without its stage
  // sorts the part into the wrong bucket on the list and the diagram.
  const { components } = resolveLocations([unknown('Motor')], null);
  eq(components[0].stage, 'drive', 'stage');
});
t('a location the table already gave is left alone', () => {
  const { components } = resolveLocations(
    [{ item: 'Motor', installation_location: 'tail_end', stage: 'tail' }], { drive_end_side: 'left' });
  eq(components[0].installation_location, 'tail_end', 'not overridden');
});
t('an ambiguous part near an end is placed by where it sits', () => {
  const { components, report } = resolveLocations([
    unknown('Bearing', { position: { x: .1, y: .5 } }),
    unknown('Bearing', { position: { x: .9, y: .5 } })
  ], { drive_end_side: 'left' });
  eq(components.map(c => c.installation_location).join(), 'drive_end,tail_end', 'locations');
  eq(report.locatedByPosition, 2, 'both placed by position');
});
t('the drive end being on the right flips it', () => {
  const { components } = resolveLocations([unknown('Seal', { position: { x: .1, y: .5 } })], { drive_end_side: 'right' });
  eq(components[0].installation_location, 'tail_end', 'location');
});
t('an ambiguous part mid-span stays honest about not knowing', () => {
  // The middle is where hangers live; guessing the nearer end there
  // would be inventing an answer.
  const { components } = resolveLocations([unknown('Seal', { position: { x: .5, y: .5 } })], { drive_end_side: 'left' });
  eq(components[0].installation_location, 'unknown', 'location');
});
t('no orientation and no telling category leaves it unknown', () => {
  const { components } = resolveLocations([unknown('Gasket', { position: { x: .1, y: .1 } })], { drive_end_side: 'unknown' });
  eq(components[0].installation_location, 'unknown', 'location');
});
t('an unplaced ambiguous part cannot be placed by position', () => {
  const { components } = resolveLocations([unknown('Bearing')], { drive_end_side: 'left' });
  eq(components[0].installation_location, 'unknown', 'location');
});

console.log('\n=== slicing the upload up per pass ===');
const { pageOfBlocks, blocksForPages } = await import('../src/blueprints/extract.js');
const img = n => ({ type: 'image', source: { data: 'IMG' + n } });
const labelled = [
  { type: 'text', text: 'PDF page 3:' }, img(3),
  { type: 'text', text: 'PDF page 7:' }, img(7),
  { type: 'text', text: 'PDF page 12:' }, img(12)
];
t('keeps each image with the sheet number it was labelled with', () => {
  // Scanning pages 3, 7, 12 must not read back as pages 1, 2, 3 -- every
  // source_page the AI returns is relative to these labels.
  eq(pageOfBlocks(labelled).map(p => p.page).join(), '3,7,12', 'pages');
});
t('a single uploaded image is page 1', () => {
  eq(pageOfBlocks([img(1)]).map(p => p.page).join(), '1', 'pages');
});
t('a pass is shown only the pages it needs', () => {
  const blocks = blocksForPages(pageOfBlocks(labelled), [7]);
  eq(blocks.filter(b => b.type === 'image').length, 1, 'one image');
  eq(blocks.find(b => b.type === 'image').source.data, 'IMG7', 'the right one');
});
t('asking for pages that are not there falls back to the whole set', () => {
  // Better a pass that reads everything than one that reads nothing.
  const blocks = blocksForPages(pageOfBlocks(labelled), [99]);
  eq(blocks.filter(b => b.type === 'image').length, 3, 'all images');
});

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
