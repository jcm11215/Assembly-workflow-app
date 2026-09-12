// Tests src/blueprints/spec.js -- installation_location -> stage mapping,
// drive/tail swap detection, confidence thresholds. Loaded as source text
// and evaluated directly (rather than imported) since spec.js's ESM
// import/export statements aren't valid inside `new Function`.
import fs from 'fs';
const script = fs.readFileSync(new URL('../src/blueprints/spec.js', import.meta.url), 'utf8')
  .replace(/^import.*$/gm, '')
  .replace(/^export /gm, '');
const M = new Function(script + `
  return {normalizeSpec, validateSpec, validateComponents, validateExtraction,
          normalizeComponents, stageForLocation, INSTALLATION_LOCATIONS,
          computeAggregateConfidence, determineExtractionStatus, dimIn};
`)();

let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log('  FAIL ' + n)); };
const mkDim = v => ({ value: v, unit: 'in', normalized_in: v, confidence: 0.9, method: 'direct', status: 'ok', source_page: 1 });

// stageForLocation
t('drive_end -> drive', M.stageForLocation('drive_end') === 'drive');
t('tail_end -> tail', M.stageForLocation('tail_end') === 'tail');
t('hanger -> bearings', M.stageForLocation('hanger') === 'bearings');
t('unknown/garbage -> other', M.stageForLocation('unknown') === 'other' && M.stageForLocation('bogus') === 'other');

// AI cannot smuggle a stage
const comps = M.normalizeComponents([{ item: 'Bearing', specification: '2.5" bore',
  installation_location: 'drive_end', confidence: 0.92, stage: 'tail' }]);
t('stage always derived from installation_location, never the raw AI value', comps[0].stage === 'drive');

// drive/tail swap detection
const specSwap = { drive: { bearing_bore: mkDim(2.0) }, tail: { bearing_bore: mkDim(3.5) }, hangers: {} };
const swapped = M.normalizeComponents([{ item: 'Bearing', specification: '3.5" bore', installation_location: 'drive_end', confidence: 0.9 }]);
t('drive/tail bearing swap detected', M.validateComponents(specSwap, swapped).conflicts > 0);

// component whitelist -- the shop's list, and nothing else
const loc = item => ({ item, installation_location: 'unknown' });
const kept = M.normalizeComponents(['Drive', 'Gear Motor', 'Reducer', 'Waste Pack Seal', 'Gasket', 'Flange Bearing',
  'Hanger Bearing', 'Coupling Shaft', 'Tail Shaft', 'Drive Shaft', 'Auger', 'Coupling Bolts', 'UHMW Liner'].map(loc));
t('every listed part type is kept', kept.length === 13);
const dropped = M.normalizeComponents(['Drive End Plate', 'Drive Guard', 'Trough', 'Cap Screw', 'Shroud', 'Coupling', 'Sprocket'].map(loc));
t('unlisted parts are dropped', dropped.length === 0);
const bare = M.normalizeComponents([{ item: 'Shaft', installation_location: 'tail_end' }, { item: 'Shaft', installation_location: 'unknown' }]);
t('bare "Shaft" is named from its location, dropped when it has none', bare.length === 1 && bare[0].item === 'Tail Shaft');

// confidence thresholds + safety override
const clean = { errors: 0, conflicts: 0, warnings: 0 };
t('>=0.9 clean auto-approves', M.determineExtractionStatus(0.95, clean).status === 'approved');
t('0.7-0.89 -> review suggested', M.determineExtractionStatus(0.8, clean).urgency === 'suggested');
t('<0.7 -> review required', M.determineExtractionStatus(0.5, clean).urgency === 'required');
t('conflict overrides high confidence', M.determineExtractionStatus(0.97, { errors: 0, conflicts: 1, warnings: 0 }).status === 'review_required');

// preservation check
const goodSpec = M.normalizeSpec({ conveyorType: 'screw', overall: { overall_length: mkDim(480) }, screw: { screw_diameter: mkDim(20) } });
t('validateSpec unchanged and still works standalone', M.validateSpec(goodSpec).ok === true);

// item_as_drawn -- the drawing's own wording, kept verbatim next to the
// normalized category name rather than replacing it.
const drawn = M.normalizeComponents([
  { item: 'Hanger Bearing', item_as_drawn: 'HNGR BRG ASSY 2-7/16', installation_location: 'hanger' },
  { item: 'Bearing', item_as_drawn: '  FLG BRG, 2-7/16 BORE  ', installation_location: 'drive_end' },
  { item: 'Gasket', installation_location: 'trough' },                       // model gave no verbatim wording
  { item: 'Motor', item_as_drawn: '', installation_location: 'drive_end' }   // explicitly empty
]);
t('verbatim drawing wording is preserved exactly', drawn[0].item_as_drawn === 'HNGR BRG ASSY 2-7/16');
t('category name is NOT overwritten by the drawing wording', drawn[0].item === 'Hanger Bearing');
t('surrounding whitespace is trimmed but the wording is untouched', drawn[1].item_as_drawn === 'FLG BRG, 2-7/16 BORE');
t('no verbatim wording falls back to the model item, not a guess', drawn[2].item_as_drawn === 'Gasket');
t('empty verbatim wording falls back too', drawn[3].item_as_drawn === 'Motor');

// A bare "SHAFT" is the case where the two names must not be conflated:
// the category becomes Tail Shaft (from where it sits), but the drawing
// still only says SHAFT, and that is what the assembler will be reading.
const bareShaft = M.normalizeComponents([{ item: 'Shaft', installation_location: 'tail_end' }]);
t('bare shaft is categorized as Tail Shaft', bareShaft[0].item === 'Tail Shaft');
t('...but its drawn wording is still the bare "Shaft" the drawing had', bareShaft[0].item_as_drawn === 'Shaft');
const bareShaftDrawn = M.normalizeComponents([
  { item: 'Shaft', item_as_drawn: '1-1/2" DIA SHAFT, C1045', installation_location: 'tail_end' }
]);
t('an explicit drawn wording survives the bare-shaft rename', bareShaftDrawn[0].item_as_drawn === '1-1/2" DIA SHAFT, C1045' && bareShaftDrawn[0].item === 'Tail Shaft');

// component position -- for the "where each part goes" map (pins on the
// real scanned drawing, not a synthesized schematic). Null is a normal,
// expected outcome (a BOM-table-only entry has nothing to point at), so
// every malformed/absent shape must resolve to null, never a guess.
const posComps = M.normalizeComponents([
  { item: 'Drive', installation_location: 'drive_end', position: { x: 0.12, y: 0.55 } },
  { item: 'Reducer', installation_location: 'drive_end', position: null },
  { item: 'Bearing', installation_location: 'hanger' },                              // field absent entirely
  { item: 'Gasket', installation_location: 'unknown', position: { x: 1.4, y: 0.5 } }, // out of range
  { item: 'Seal', installation_location: 'unknown', position: { x: 'nope', y: 0.5 } },// non-numeric
  { item: 'Coupling Bolts', installation_location: 'screw', position: { x: 0, y: 1 } } // boundary values
]);
t('valid in-range position kept as {x,y}', posComps[0].position && posComps[0].position.x === 0.12 && posComps[0].position.y === 0.55);
t('explicit null position stays null', posComps[1].position === null);
t('missing position field normalizes to null', posComps[2].position === null);
t('out-of-range coordinate rejected to null', posComps[3].position === null);
t('non-numeric coordinate rejected to null', posComps[4].position === null);
t('boundary values 0 and 1 are valid', posComps[5].position && posComps[5].position.x === 0 && posComps[5].position.y === 1);

console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
