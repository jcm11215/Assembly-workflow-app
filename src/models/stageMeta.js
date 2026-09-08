/** Subassembly colour/label metadata shared by BOM and 3D views. */

// The 3D model still keys off the original 6 stages (trough/screw/bearings/
// drive/tail/other) -- unchanged. Trough GEOMETRY (dimensions, the
// physical shape) is still needed for the 3D build even though trough
// hardware is no longer listed as a BOM component -- those are different
// things (see the components-list exclusion in spec.js/prompt.js).
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
 * The BOM breakdown. Drive End and Tail End are flat categories -- plate,
 * bearing, and seal hardware sits in the same list as everything else at
 * that end, no nested sub-group. No Troughs category: trough sections are
 * excluded from the components list entirely (structural, not hardware),
 * filtered both at the prompt level and again in code.
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
// with, keyed by top-level category. No 'trough' entry -- it's not a
// selectable category for components anymore.
export const BUCKET_TO_STAGE = {
  drive:'drive', tail:'tail', auger:'screw', hanger:'bearings', other:'other'
};

/** Top-level category for a component. A leftover trough-stage component
 *  (e.g. from data extracted before this exclusion existed) falls back
 *  to Other rather than vanishing or crashing, since Troughs is no
 *  longer a valid category to render it under. */
export function bomBucketFor(component){
  switch(component.stage){
    case 'drive':    return 'drive';
    case 'tail':     return 'tail';
    case 'screw':    return 'auger';
    case 'bearings': return 'hanger';   // hanger bearings along the span
    default:         return 'other';    // includes any leftover 'trough'
  }
}
