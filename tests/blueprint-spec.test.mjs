// Tests src/blueprints/spec.js -- installation_location -> stage mapping,
// drive/tail swap detection, confidence thresholds. Run via the same
// .js -> .mjs conversion used elsewhere in tests/, or adapt the requires
// below to your test runner.
const fs = require('fs');
const script = fs.readFileSync(__dirname + '/../src/blueprints/spec.js', 'utf8')
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

// confidence thresholds + safety override
const clean = { errors: 0, conflicts: 0, warnings: 0 };
t('>=0.9 clean auto-approves', M.determineExtractionStatus(0.95, clean).status === 'approved');
t('0.7-0.89 -> review suggested', M.determineExtractionStatus(0.8, clean).urgency === 'suggested');
t('<0.7 -> review required', M.determineExtractionStatus(0.5, clean).urgency === 'required');
t('conflict overrides high confidence', M.determineExtractionStatus(0.97, { errors: 0, conflicts: 1, warnings: 0 }).status === 'review_required');

// preservation check
const goodSpec = M.normalizeSpec({ conveyorType: 'screw', overall: { overall_length: mkDim(480) }, screw: { screw_diameter: mkDim(20) } });
t('validateSpec unchanged and still works standalone', M.validateSpec(goodSpec).ok === true);

console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
