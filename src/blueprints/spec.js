/**
 * Engineering specification layer. Dimension normalization with full
 * provenance (value/unit/source_page/confidence/method) and deterministic
 * validation. Pure -- no DOM, no I/O.
 */

// Every dimension carries provenance so nothing is silently invented.
// {value, unit, normalized_in, source_page, source, description,
//  confidence, method: 'direct'|'inferred', status: 'ok'|'not_found'}
export const UNIT_TO_IN = { in:1, inch:1, inches:1, '"':1, ft:12, foot:12, feet:12, "'":12, mm:1/25.4, cm:1/2.54, m:39.3701 };

export function normDim(d){
  if(d == null) return { value:null, unit:null, normalized_in:null, confidence:0, status:'not_found', method:null, source_page:null, source:null };
  // Tolerate the AI returning a bare number instead of the full object.
  if(typeof d === 'number' || typeof d === 'string'){
    const n = Number(d);
    return isFinite(n)
      ? { value:n, unit:'in', normalized_in:n, confidence:0.5, status:'ok', method:'inferred', source_page:null, source:null, description:null }
      : { value:null, unit:null, normalized_in:null, confidence:0, status:'not_found', method:null, source_page:null, source:null };
  }
  const raw = (d.value!=null && d.value!=='' && isFinite(Number(d.value))) ? Number(d.value) : null;
  if(raw === null) return { value:null, unit:null, normalized_in:null, confidence:0, status:d.status||'not_found', method:null, source_page:d.source_page??null, source:d.source||null, description:d.description||null };
  const unit = (d.unit || 'in').toString().toLowerCase().trim();
  const factor = UNIT_TO_IN[unit] != null ? UNIT_TO_IN[unit] : 1;
  return {
    value: raw,
    unit: d.unit || 'in',
    normalized_in: raw * factor,
    normalized_mm: raw * factor * 25.4,
    original_text: d.original_text || `${raw}${d.unit||''}`,
    source_page: d.source_page ?? null,
    source: d.source || null,
    description: d.description || null,
    confidence: (d.confidence!=null && isFinite(Number(d.confidence))) ? Number(d.confidence) : 0.5,
    method: d.method === 'direct' ? 'direct' : 'inferred',
    status: 'ok'
  };
}

export const dimIn = d => (d && d.status==='ok' && d.normalized_in!=null) ? d.normalized_in : null;

export function confLabel(d){
  if(!d || d.status!=='ok' || d.normalized_in==null) return 'NOT FOUND';
  if(d.conflict) return 'CONFLICT';
  if(d.method==='inferred') return d.confidence>=0.7 ? 'INFERRED' : 'LOW';
  if(d.confidence>=0.85) return 'HIGH';
  if(d.confidence>=0.6) return 'MEDIUM';
  return 'LOW';
}

// Walks whatever the AI returned and normalizes every dimension node in
// place, leaving non-dimension fields untouched.

// Walks whatever the AI returned and normalizes every dimension node in
// place, leaving non-dimension fields untouched.
export const DIM_KEYS = new Set([
  'overall_length','overall_width','overall_height','elevation','incline_angle',
  'trough_width','trough_depth','trough_gauge','flange_height','screw_diameter',
  'screw_pitch','shaft_diameter','shaft_length','coupling_diameter','flight_thickness',
  'frame_height','frame_width','side_rail_height','side_rail_thickness','leg_spacing',
  'pulley_diameter','pulley_width','bearing_bore','sprocket_diameter','belt_width',
  'belt_thickness','roller_diameter','roller_width','roller_spacing','hanger_spacing',
  'inlet_length','outlet_length','centerline_height','take_up_travel'
]);

export function normalizeSpecTree(node){
  if(!node || typeof node !== 'object') return node;
  if(Array.isArray(node)) return node.map(normalizeSpecTree);
  const out = {};
  for(const [k,v] of Object.entries(node)){
    if(DIM_KEYS.has(k)) out[k] = normDim(v);
    else if(v && typeof v === 'object') out[k] = normalizeSpecTree(v);
    else out[k] = v;
  }
  return out;
}

export function normalizeSpec(parsed){
  if(!parsed || typeof parsed !== 'object') return null;
  const spec = normalizeSpecTree(parsed);
  spec.conveyorType = ['screw','belt'].includes(spec.conveyorType) ? spec.conveyorType : 'screw';
  spec.pages_analyzed = Array.isArray(spec.pages_analyzed) ? spec.pages_analyzed : [];
  spec.conflicts = Array.isArray(spec.conflicts) ? spec.conflicts : [];
  spec.extractedAt = new Date().toISOString();
  // Usable only if we got at least one primary dimension -- otherwise the
  // generator would be building from nothing, which is the failure mode
  // this whole layer exists to prevent.
  const o = spec.overall || {};
  const hasPrimary = dimIn(o.overall_length) || dimIn(o.overall_width) ||
                     dimIn((spec.screw||{}).screw_diameter) || dimIn((spec.trough||{}).trough_width);
  return hasPrimary ? spec : null;
}

export const COMPONENT_STAGES = ['trough','screw','drive','bearings','tail','other'];

/**
 * Where a component installs on the machine, in the AI's vocabulary.
 * Deliberately more granular than COMPONENT_STAGES -- "drive_end" and
 * "tail_end" are separate values here so the model is never asked to
 * make the drive/tail call itself; it reports what it read, and this
 * module derives the stage.
 */
export const INSTALLATION_LOCATIONS =
  ['drive_end', 'tail_end', 'trough', 'screw', 'hanger', 'other', 'unknown'];

/**
 * The ONLY place installation_location becomes a stage. This is the
 * fix for the drive/tail misclassification bug: previously the AI was
 * asked to pick "stage" directly in the prompt, with no code-level
 * check against the structured drive/tail dimensions it separately
 * reported. Now the model reports installation_location (a strictly
 * narrower, less ambiguous vocabulary) and this deterministic mapping
 * decides the stage -- the AI's prompt no longer contains the word
 * "stage" at all. See buildComponentSchemaPrompt() in prompt.js.
 */
const LOCATION_TO_STAGE = {
  drive_end: 'drive',
  tail_end:  'tail',
  trough:    'trough',
  screw:     'screw',
  hanger:    'bearings',
  other:     'other',
  unknown:   'other'
};
export function stageForLocation(location){
  return LOCATION_TO_STAGE[location] || 'other';
}

const EXTRACTION_METHODS = ['bom_table', 'callout', 'detail_view', 'general_assembly', 'inferred'];

export function normalizeComponents(parsed){
  const raw = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.components) ? parsed.components : []);
  return raw.map(c=>{
    const location = (c && INSTALLATION_LOCATIONS.includes(c.installation_location))
      ? c.installation_location : 'unknown';
    return {
      item: (c && c.item) ? String(c.item) : 'Unspecified item',
      specification: (c && c.specification) ? String(c.specification) : '',
      quantity: (c && c.quantity!=null && c.quantity!=='') ? c.quantity : null,
      installation_location: location,
      stage: stageForLocation(location),                              // derived, never AI-supplied
      source_page: (c && c.source_page!=null) ? Number(c.source_page) : null,
      source_callout: (c && c.source_callout) ? String(c.source_callout) : '',
      extraction_method: (c && EXTRACTION_METHODS.includes(c.extraction_method))
        ? c.extraction_method : 'inferred',
      confidence: (c && c.confidence!=null && isFinite(Number(c.confidence)))
        ? Math.min(1, Math.max(0, Number(c.confidence))) : 0.5
    };
  });
}
/* ================================================================
   ENGINEERING SPECIFICATION LAYER
   The AI's only job is to read the drawing and fill this structure in.
   It never produces geometry. Everything below -- normalization,
   validation, and the 3D build -- is deterministic application code
   working from these numbers.
   ================================================================ */

// Every dimension carries provenance so nothing is silently invented.
// {value, unit, normalized_in, source_page, source, description,
//  confidence, method: 'direct'|'inferred', status: 'ok'|'not_found'}

//    that failed.
export function validateSpec(spec){
  const checks = [];
  const add = (level, message) => checks.push({ level, message });
  if(!spec){ return { checks:[{level:'error', message:'No usable specification extracted.'}], ok:false }; }

  const o = spec.overall || {};
  const L = dimIn(o.overall_length), W = dimIn(o.overall_width), H = dimIn(o.overall_height);

  if(!L) add('error','Overall length not found -- length-dependent geometry will be shown as approximate.');
  if(!W && !dimIn((spec.trough||{}).trough_width) && !dimIn((spec.screw||{}).screw_diameter))
    add('error','No width or diameter found -- cross-section will be approximate.');

  // Conflicts reported by the extractor across views.
  (spec.conflicts||[]).forEach(cf=>{
    add('conflict', typeof cf==='string' ? cf : `${cf.field||'Dimension'} conflict: ${cf.detail||JSON.stringify(cf)}`);
  });

  // Impossible / implausible geometry.
  if(L != null && L <= 0) add('error','Overall length is zero or negative.');
  if(W != null && L != null && W > L) add('warning',`Width (${W.toFixed(1)}") exceeds length (${L.toFixed(1)}") -- check units.`);

  const inc = dimIn(o.incline_angle) != null ? o.incline_angle.value : null;
  if(inc != null && (inc < 0 || inc > 90)) add('error',`Incline angle ${inc}deg is out of range.`);

  if(spec.conveyorType === 'screw'){
    const sd = dimIn((spec.screw||{}).screw_diameter);
    const tw = dimIn((spec.trough||{}).trough_width);
    if(sd && tw && sd > tw) add('warning',`Screw diameter (${sd.toFixed(1)}") is larger than trough width (${tw.toFixed(1)}").`);
    const shaft = dimIn((spec.screw||{}).shaft_diameter);
    if(shaft && sd && shaft >= sd) add('error',`Shaft diameter (${shaft.toFixed(1)}") is not smaller than screw diameter (${sd.toFixed(1)}").`);
    const hangers = (spec.hangers && spec.hangers.count!=null) ? Number(spec.hangers.count) : null;
    const hs = dimIn((spec.hangers||{}).hanger_spacing);
    if(hangers != null && L && hs && (hangers+1)*hs > L*1.25)
      add('warning',`Hanger count (${hangers}) and spacing (${hs.toFixed(1)}") exceed overall length.`);
  }else{
    const bw = dimIn((spec.belt||{}).belt_width);
    const hp = dimIn(((spec.head||{}).pulley||{}).pulley_width);
    if(bw && hp && bw > hp) add('warning',`Belt width (${bw.toFixed(1)}") exceeds head pulley width (${hp.toFixed(1)}").`);
    if(bw && W && bw > W) add('warning',`Belt width (${bw.toFixed(1)}") exceeds frame width (${W.toFixed(1)}").`);
  }

  // Unit sanity: anything absurdly large usually means mm read as inches.
  [['overall length',L],['overall width',W],['overall height',H]].forEach(([n,v])=>{
    if(v != null && v > 2400) add('warning',`${n} normalizes to ${v.toFixed(0)}" (>200ft) -- possible unit error.`);
  });

  const errors = checks.filter(c=>c.level==='error').length;
  const conflicts = checks.filter(c=>c.level==='conflict').length;
  return { checks, ok: errors===0 && conflicts===0, errors, conflicts,
           warnings: checks.filter(c=>c.level==='warning').length };
}

/* ================================================================
   COMPONENT-LEVEL VALIDATION (Phase 8)
   validateSpec() above is unchanged -- these checks are additive and
   specifically target the failure modes this phase exists to catch:
   drive/tail swaps, bore inconsistency, duplicate-callout conflicts,
   and missing critical hardware. Composed with validateSpec() by
   validateExtraction() below rather than merged into it, so nothing
   that already depends on validateSpec(spec)'s signature changes.
   ================================================================ */

/** Pulls the first plausible size (inches) out of a free-text spec string,
 *  e.g. '2-1/2" bore pillow block' -> 2.5. Best-effort only -- used to
 *  cross-check a component's stated size against the spec's structured
 *  dimensions, never as a source of truth on its own. */
function extractSizeFromText(text){
  if(!text) return null;
  const s = String(text);
  const mixed = s.match(/(\d+)\s*-\s*(\d+)\/(\d+)/);       // "2-1/2"
  if(mixed) return Number(mixed[1]) + Number(mixed[2])/Number(mixed[3]);
  const frac = s.match(/(\d+)\/(\d+)/);                    // "1/2" alone
  const dec = s.match(/(\d+(?:\.\d+)?)/);                  // "2.5" or "2"
  if(frac && (!dec || s.indexOf(frac[0]) <= s.indexOf(dec[0]))){
    return Number(frac[1]) / Number(frac[2]);
  }
  return dec ? Number(dec[1]) : null;
}

const CLOSE = (a, b, tol=0.15) => a!=null && b!=null && Math.abs(a-b) <= tol;

/**
 * Cross-checks the component list against the structured drive/tail/
 * hanger dimensions the same extraction reported. A component's stated
 * size fitting the OTHER end's dimension much better than its own is
 * exactly the swap pattern this phase was written to catch.
 */
export function validateComponents(spec, components){
  const checks = [];
  const add = (level, message) => checks.push({ level, message });
  const list = Array.isArray(components) ? components : [];
  if(!spec) return { checks, ok: true, errors:0, conflicts:0, warnings:0 };

  const driveBore = dimIn((spec.drive||{}).bearing_bore);
  const tailBore   = dimIn((spec.tail||{}).bearing_bore);
  const driveShaft = dimIn((spec.drive||{}).shaft_diameter);
  const tailShaft  = dimIn((spec.tail||{}).shaft_diameter);

  list.forEach(c=>{
    const size = extractSizeFromText(c.specification);
    if(size == null) return;
    const isBearing = /bear/i.test(c.item);
    const isShaft = /shaft/i.test(c.item);

    if(isBearing && (c.installation_location === 'drive_end' || c.installation_location === 'tail_end')){
      const own   = c.installation_location === 'drive_end' ? driveBore : tailBore;
      const other = c.installation_location === 'drive_end' ? tailBore  : driveBore;
      if(other != null && CLOSE(size, other) && !CLOSE(size, own)){
        add('conflict',
          `"${c.item}" is tagged ${c.installation_location.replace('_',' ')} but its stated size ` +
          `(${size}") matches the ${c.installation_location==='drive_end'?'tail':'drive'} bearing bore ` +
          `(${other}") far better than the ${c.installation_location.replace('_',' ')} bore ` +
          `(${own!=null?own+'"':'not found'}) -- possible drive/tail bearing swap.`);
      }
    }
    if(isShaft && (c.installation_location === 'drive_end' || c.installation_location === 'tail_end')){
      const own   = c.installation_location === 'drive_end' ? driveShaft : tailShaft;
      const other = c.installation_location === 'drive_end' ? tailShaft  : driveShaft;
      if(other != null && CLOSE(size, other) && !CLOSE(size, own)){
        add('conflict',
          `"${c.item}" is tagged ${c.installation_location.replace('_',' ')} but its stated size ` +
          `(${size}") matches the ${c.installation_location==='drive_end'?'tail':'drive'} shaft diameter ` +
          `(${other}") far better than the ${c.installation_location.replace('_',' ')} shaft ` +
          `(${own!=null?own+'"':'not found'}) -- possible drive/tail shaft swap.`);
      }
    }
  });

  // Inconsistent bearing bore sizes: multiple hanger-bearing components
  // whose stated sizes disagree with each other or with hangers.bearing_bore.
  const hangerBores = list
    .filter(c => c.installation_location === 'hanger' && /bear/i.test(c.item))
    .map(c => ({ item:c.item, size: extractSizeFromText(c.specification) }))
    .filter(x => x.size != null);
  const specHangerBore = dimIn((spec.hangers||{}).bearing_bore);
  if(hangerBores.length){
    const sizes = [...new Set(hangerBores.map(h => h.size))];
    if(sizes.length > 1){
      add('conflict', `Hanger bearing components disagree on bore size: ${sizes.map(s=>s+'"').join(', ')}.`);
    } else if(specHangerBore != null && !CLOSE(sizes[0], specHangerBore, 0.05)){
      add('warning',
        `Hanger bearing component bore (${sizes[0]}") does not match the hangers.bearing_bore ` +
        `dimension (${specHangerBore}") reported elsewhere in the same extraction.`);
    }
  }

  // Duplicate-callout conflicts: same item + same location, different spec text.
  const byKey = {};
  list.forEach(c=>{
    const key = `${c.item.toLowerCase()}::${c.installation_location}`;
    (byKey[key] = byKey[key]||[]).push(c);
  });
  Object.values(byKey).forEach(group=>{
    if(group.length < 2) return;
    const specs = [...new Set(group.map(c=>c.specification).filter(Boolean))];
    if(specs.length > 1){
      add('conflict', `Multiple "${group[0].item}" entries at ${group[0].installation_location.replace('_',' ')} disagree: ${specs.map(s=>`"${s}"`).join(' vs ')}.`);
    }
  });

  // Missing critical components.
  const hasLocation = loc => list.some(c => c.installation_location === loc);
  const hangerCount = spec.hangers && spec.hangers.count;
  if(hangerCount && Number(hangerCount) > 0 && !hasLocation('hanger')){
    add('warning', `Spec reports ${hangerCount} hanger bearing(s) but no hanger-location component was extracted.`);
  }
  const driveHasData = Object.values(spec.drive||{}).some(v => v && typeof v==='object' && v.status==='ok');
  if(!driveHasData && !hasLocation('drive_end')){
    add('warning', 'No drive-end information found in dimensions or components -- likely missing from the scanned pages.');
  }
  const tailHasData = Object.values(spec.tail||{}).some(v => v && typeof v==='object' && v.status==='ok');
  if(!tailHasData && !hasLocation('tail_end')){
    add('warning', 'No tail-end information found in dimensions or components -- likely missing from the scanned pages.');
  }

  const errors = checks.filter(c=>c.level==='error').length;
  const conflicts = checks.filter(c=>c.level==='conflict').length;
  return { checks, ok: errors===0 && conflicts===0, errors, conflicts,
           warnings: checks.filter(c=>c.level==='warning').length };
}

/** Combines validateSpec() (unchanged, Phase 2) with the new component
 *  cross-checks into one result, in the same {checks, ok, errors,
 *  conflicts, warnings} shape either alone already used. */
export function validateExtraction(spec, components){
  const a = validateSpec(spec);
  const b = validateComponents(spec, components);
  return {
    checks: [...a.checks, ...b.checks],
    ok: a.ok && b.ok,
    errors: a.errors + b.errors,
    conflicts: a.conflicts + b.conflicts,
    warnings: a.warnings + b.warnings
  };
}

/* ================================================================
   CONFIDENCE SCORING + REVIEW-STATUS DETERMINATION (Phase 8)
   ================================================================ */

/** Aggregate confidence for the whole extraction: mean of component
 *  confidences and the confidence of every 'ok' dimension found, so a
 *  scan with lots of not_found dimensions doesn't score artificially
 *  high just because the few things it DID find were clear. */
export function computeAggregateConfidence(spec, components){
  const scores = [];
  (components||[]).forEach(c => { if(c.confidence != null) scores.push(c.confidence); });
  const walk = node => {
    if(!node || typeof node !== 'object') return;
    if(node.status === 'ok' && node.confidence != null) scores.push(node.confidence);
    else Object.values(node).forEach(walk);
  };
  if(spec) Object.values(spec).forEach(walk);
  if(!scores.length) return 0;
  return Number((scores.reduce((a,b)=>a+b,0) / scores.length).toFixed(2));
}

/**
 * Requirement 6's thresholds, plus one deliberate safety override: any
 * validation error or conflict forces review regardless of confidence.
 * A high-confidence extraction that also contains a detected drive/tail
 * swap is not a case for auto-approval -- confidence measures how
 * clearly the model read the page, not whether what it read is
 * internally consistent, and those are different questions.
 */
export function determineExtractionStatus(confidence, validation){
  const hasHardIssue = (validation && (validation.errors > 0 || validation.conflicts > 0));
  if(hasHardIssue){
    return { status:'review_required', urgency:'required', autoApproved:false,
             reason:'Validation found errors or conflicts -- never auto-approved regardless of confidence.' };
  }
  if(confidence >= 0.9){
    return { status:'approved', urgency:null, autoApproved:true,
             reason:`Confidence ${confidence} with no validation issues.` };
  }
  if(confidence >= 0.7){
    return { status:'review_required', urgency:'suggested', autoApproved:false,
             reason:`Confidence ${confidence} -- review suggested, not required.` };
  }
  return { status:'review_required', urgency:'required', autoApproved:false,
           reason:`Confidence ${confidence} is below the review threshold.` };
}
