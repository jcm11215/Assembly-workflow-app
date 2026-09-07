/** Subassembly colour/label metadata shared by BOM and 3D views. */

// The 3D model still keys off the original 6 stages (trough/screw/bearings/
// drive/tail/other) -- unchanged, since geometry.js builds one mesh group
// per stage and doesn't need the finer BOM split below.
export const STAGE_META = {
  trough:   { label:'Trough',        color:'#5aa3d8' },
  screw:    { label:'Screw & Shafts',color:'#f5b400' },
  bearings: { label:'Hanger Bearings',color:'#4fae57' },
  drive:    { label:'Drive End',     color:'#e34b3a' },
  tail:     { label:'Tail End',      color:'#b07fd0' },
  other:    { label:'Other',         color:'#98a1a9' }
};

export const STAGE_ORDER = ['trough','screw','bearings','drive','tail','other'];

/**
 * The BOM breakdown. Five top-level categories -- Drive End and Tail End
 * are single categories, each with plate/bearing/seal hardware shown as a
 * nested sub-group inside rather than split out as its own peer category.
 */
export const BOM_BUCKET_META = {
  drive:  { label:'Drive End',       color:'#e34b3a' },
  tail:   { label:'Tail End',        color:'#b07fd0' },
  trough: { label:'Troughs',         color:'#5aa3d8' },
  auger:  { label:'Augers',          color:'#f5b400' },
  hanger: { label:'Hanger Bearings', color:'#4fae57' },
  other:  { label:'Other',           color:'#98a1a9' }
};
export const BOM_BUCKET_ORDER = ['drive','tail','trough','auger','hanger','other'];

// Categories that show a nested hardware sub-group, and its heading.
export const BOM_SUBGROUP_LABEL = {
  drive: 'Plate, Bearings & Seals',
  tail:  'Plate, Bearings & Seals'
};

// The `stage` value a manually-added/recategorized component is saved
// with, keyed by top-level category.
export const BUCKET_TO_STAGE = {
  drive:'drive', tail:'tail', trough:'trough',
  auger:'screw', hanger:'bearings', other:'other'
};

const PLATE_BEARING_SEAL_RE = /\b(plate|bearing|seal)s?\b/i;

/** Top-level category for a component. */
export function bomBucketFor(component){
  switch(component.stage){
    case 'drive':    return 'drive';
    case 'tail':     return 'tail';
    case 'trough':   return 'trough';
    case 'screw':    return 'auger';
    case 'bearings': return 'hanger';   // hanger bearings along the span
    default:         return 'other';
  }
}

/**
 * Within Drive End / Tail End, is this part plate/bearing/seal hardware?
 * Matched on the component's own text -- nothing extra is persisted, so
 * recategorizing a part between top-level groups still works normally.
 */
export function isEndHardware(component){
  if(!BOM_SUBGROUP_LABEL[bomBucketFor(component)]) return false;
  return PLATE_BEARING_SEAL_RE.test(`${component.item||''} ${component.specification||''}`);
}
