/**
 * Which of the shop's part types a parts-table description is -- the
 * same list the scan keeps (spec.js), as rules rather than an AI call.
 *
 * Used when the table was read from the PDF's own text: the description
 * is exact, so a rule decides the type instantly and the same way every
 * time. Order matters: "HANGER BEARING" is a hanger bearing, not a
 * bearing, and "DRIVE SHAFT" is a shaft, not a drive.
 */
const RULES = [
  [/\b(hangers?|hngrs?)\b(?!\s*(arms?|bars?|brackets?|brkts?|clamps?)\b)/i, 'Hanger Bearing'],
  [/\b(coupling|cplg)\s*bolts?\b/i,                                   'Coupling Bolts'],
  [/\bgaskets?\b/i,                                                  'Gasket'],
  [/\b(coupling|cplg)\s*shafts?\b/i,                                  'Coupling Shaft'],
  [/\btail\s*shafts?\b/i,                                            'Tail Shaft'],
  [/\bdrive\s*shafts?\b/i,                                           'Drive Shaft'],
  [/\bend\s*shafts?\b/i,                                             'Shaft'],
  // A drive unit that comes with its motor is the drive.
  [/\bdrives?\b(?!\s*(end|plate|guard|base|shaft))/i,                'Drive'],
  [/\b(gear\s*)?motors?\b/i,                                         'Motor'],
  [/\b(reducers?|gear\s*box(es)?|gear\s*reducers?)\b/i,              'Reducer'],
  [/\b(seals?|waste\s*packs?|glands?)\b/i,                           'Seal'],
  [/\b(bearings?|brgs?|pillow\s*blocks?|flange\s*blocks?)\b/i,       'Bearing'],
  [/\b(augers?|flight(ing)?s?|screw\s*(assembly|assy|sections?))\b/i,'Auger'],
  [/\bshafts?\b/i,                                                   'Shaft'],
  [/\buhmw\b/i,                                                      'UHMW']
];

/** Hardware and the pieces of an assembly are never parts the shop
 *  tracks, whatever else the description says: a "WASTEPACK SEAL PLATE"
 *  is a plate, a "HEX BOLT" is a fastener. (A "4-BOLT BEARING" and
 *  coupling bolts are still parts.) */
const NOT_A_PART = /\b(plates?|brackets?|brkts?|guards?|washers?|nuts?|studs?|shims?|gussets?)\b|\b(hex|socket|cap|carriage|countersunk|set|machine|lag|u)[\s-]*(head\s*)?(bolts?|screws?)\b/i;

/** Words that mean the part merely carries a shaft: a foot, a saddle, an
 *  auger's flights or pipe. "AUGER W/ END SHAFT" is an auger and "FOOT
 *  W/ END SHAFT" isn't a shaft at all -- a drive or end shaft is a bare
 *  shaft. */
const NOT_A_SHAFT = /\b(foot|feet|saddles?|flight(ing)?s?|pipe|augers?|troughs?)\b/i;
const SHAFT_TYPES = new Set(['Drive Shaft', 'Tail Shaft', 'Coupling Shaft', 'Shaft']);

/** The part type for a description, or null when it isn't one the shop
 *  tracks (plates, guards, fasteners...). */
export function categorize(description){
  const s = String(description || '');
  // Coupling bolts are tracked, lock nut and all.
  if(/\b(coupling|cplg)\s*bolts?\b/i.test(s)) return 'Coupling Bolts';
  if(NOT_A_PART.test(s)) return null;
  const hit = RULES.find(([re, type]) => re.test(s) && !(SHAFT_TYPES.has(type) && NOT_A_SHAFT.test(s)));
  return hit ? hit[1] : null;
}

/**
 * The key a description is remembered under when someone corrects a
 * part: letters and digits only, one space between words, upper case.
 * "Flg. Brg 2-7/16" and "FLG BRG 2-7/16" are the same part; a different
 * size is a different key. Shared with the server (shared/partNames.js
 * re-exports the same rule).
 */
export { learnKey } from '../../shared/partNames.js';

/**
 * A part the AI called a shaft whose description says it only carries
 * one gets the type its description does say (an auger), or is left out
 * (a foot, a saddle). Anything else passes as it is.
 */
export function checkType(part){
  const drawn = String((part && part.item_as_drawn) || '').trim();
  if(!drawn) return part;
  // The type comes from the drawing's own wording, not from what the AI
  // called it: a model that calls a hex bolt a bearing must not get it
  // onto the list. A sub-item (1.1) is a piece of its assembly.
  if(/^\d+\.\d+$/.test(String(part.balloon ?? '').trim())) return null;
  const type = categorize(drawn);
  return type ? { ...part, item: type } : null;
}

export function checkShaft(part){
  const drawn = String((part && part.item_as_drawn) || '');
  const called = String((part && part.item) || '');
  const isShaft = SHAFT_TYPES.has(called) || /\bshafts?\b/i.test(called);
  if(!isShaft || !NOT_A_SHAFT.test(drawn)) return part;
  const type = categorize(drawn);
  return type ? { ...part, item: type } : null;
}
