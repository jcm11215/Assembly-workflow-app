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
  [/\b(hangers?|hngrs?)\b/i,                                         'Hanger Bearing'],
  [/\b(coupling|cplg)\s*shafts?\b/i,                                  'Coupling Shaft'],
  [/\btail\s*shafts?\b/i,                                            'Tail Shaft'],
  [/\bdrive\s*shafts?\b/i,                                           'Drive Shaft'],
  [/\bend\s*shafts?\b/i,                                             'Shaft'],
  [/\b(gear\s*)?motors?\b/i,                                         'Motor'],
  [/\b(reducers?|gear\s*box(es)?|gear\s*reducers?)\b/i,              'Reducer'],
  [/\bdrives?\b(?!\s*(end|plate|guard|base|shaft))/i,                'Drive'],
  [/\b(seals?|waste\s*packs?|glands?)\b/i,                           'Seal'],
  [/\b(bearings?|brgs?|pillow\s*blocks?|flange\s*blocks?)\b/i,       'Bearing'],
  [/\b(augers?|flight(ing)?s?|screw\s*(assembly|assy|sections?))\b/i,'Auger'],
  [/\bshafts?\b/i,                                                   'Shaft'],
  [/\buhmw\b/i,                                                      'UHMW']
];

/** The part type for a description, or null when it isn't one the shop
 *  tracks (plates, guards, fasteners...). */
export function categorize(description){
  const s = String(description || '');
  const hit = RULES.find(([re]) => re.test(s));
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
