/** Subassembly colour/label metadata shared by BOM and 3D views. */

//    the list and the thing on screen are visibly the same subassembly.
export const STAGE_META = {
  trough:   { label:'Trough',        color:'#5aa3d8' },
  screw:    { label:'Screw & Shafts',color:'#f5b400' },
  bearings: { label:'Hanger Bearings',color:'#4fae57' },
  drive:    { label:'Drive End',     color:'#e34b3a' },
  tail:     { label:'Tail End',      color:'#b07fd0' },
  other:    { label:'Other',         color:'#98a1a9' }
};

export const STAGE_ORDER = ['trough','screw','bearings','drive','tail','other'];
