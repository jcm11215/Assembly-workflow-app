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
 * The BOM-specific 7-bucket breakdown: drive and tail end are each split
 * into the end assembly itself vs. its plate/bearing/seal hardware,
 * matched by keyword against the component's own item/specification text
 * -- no schema change, no re-extraction, nothing that touches the
 * drive/tail classification the extraction pipeline already handles.
 */
export const BOM_BUCKET_META = {
  drive:          { label:'Drive End',                          color:'#e34b3a' },
  driveHardware:  { label:'Drive End Plate, Bearings & Seals',  color:'#c73d2e' },
  tail:           { label:'Tail End',                           color:'#b07fd0' },
  tailHardware:   { label:'Tail End Plate, Bearings & Seals',   color:'#9a68b8' },
  trough:         { label:'Troughs',                            color:'#5aa3d8' },
  auger:          { label:'Augers',                             color:'#f5b400' },
  hanger:         { label:'Hanger Bearings',                    color:'#4fae57' },
  other:          { label:'Other',                              color:'#98a1a9' }
};
export const BOM_BUCKET_ORDER = ['drive','driveHardware','tail','tailHardware','trough','auger','hanger','other'];

// The `stage` value a manually-added/edited component gets saved with,
// keyed by which of the 7 BOM buckets a human picked. driveHardware and
// tailHardware collapse to the same stage as their plain counterpart --
// see bomBucketFor() below, which re-derives the hardware sub-bucket
// from the item text on every render rather than persisting it.
export const BUCKET_TO_STAGE = {
  drive:'drive', driveHardware:'drive', tail:'tail', tailHardware:'tail',
  trough:'trough', auger:'screw', hanger:'bearings', other:'other'
};

const PLATE_BEARING_SEAL_RE = /\b(plate|bearing|seal)s?\b/i;

/** Assigns a component to one of the 7 BOM buckets above. */
export function bomBucketFor(component){
  const text = `${component.item||''} ${component.specification||''}`;
  const isHardware = PLATE_BEARING_SEAL_RE.test(text);
  switch(component.stage){
    case 'drive':    return isHardware ? 'driveHardware' : 'drive';
    case 'tail':     return isHardware ? 'tailHardware'  : 'tail';
    case 'trough':   return 'trough';
    case 'screw':    return 'auger';
    case 'bearings': return 'hanger';   // hanger bearings along the span -- not drive/tail end hardware
    default:         return 'other';
  }
}
