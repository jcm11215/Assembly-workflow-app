/** Subassembly colour/label metadata shared by the BOM list and the
 *  component map's pins. */

// Keyed by the original 6 stages (trough/screw/bearings/drive/tail/other).
// 'trough' stays in this map even though trough hardware is no longer
// listed as a BOM component, so a component extracted before that
// exclusion existed still resolves to a colour instead of crashing --
// see bomBucketFor() below, which folds it into 'other'.
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
 * The BOM breakdown. Whitelisted part types (spec.js): seals, bearings,
 * motor, gearbox/reducer, shafts, auger/screw flighting. Shafts don't
 * get their own category -- a drive/tail shaft naturally buckets under
 * that end. No Troughs category: trough sections are still excluded.
 */
export const BOM_BUCKET_META = {
  drive:  { label:'Drive End',       color:'#e34b3a' },
  tail:   { label:'Tail End',        color:'#b07fd0' },
  auger:  { label:'Augers',          color:'#f5b400' },
  hanger: { label:'Hanger Bearings', color:'#4fae57' },
  other:  { label:'Other',           color:'#98a1a9' }
};
export const BOM_BUCKET_ORDER = ['drive','tail','auger','hanger','other'];

// The `stage` value a manually-added/recategorized component is saved
// with, keyed by top-level category. No 'trough' entry -- still not a
// selectable category for components.
export const BUCKET_TO_STAGE = {
  drive:'drive', tail:'tail', auger:'screw', hanger:'bearings', other:'other'
};

/** Top-level category for a component. A leftover trough-stage component
 *  (e.g. from data extracted before that exclusion existed) falls back
 *  to Other rather than vanishing or crashing, since Troughs is not a
 *  valid category to render it under. */
export function bomBucketFor(component){
  switch(component.stage){
    case 'drive':    return 'drive';
    case 'tail':     return 'tail';
    case 'screw':    return 'auger';
    case 'bearings': return 'hanger';   // hanger bearings along the span
    default:         return 'other';    // includes any leftover 'trough'
  }
}
