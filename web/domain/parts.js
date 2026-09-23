/**
 * Parts: the categories a drawing's parts list is grouped into, and short
 * tips for new assemblers -- what a part is, what it's for, where it goes
 * and how it mounts. The approved drawing always wins over a tip.
 */
import { PROCEDURE } from '../../shared/procedure.js';

/* ---------------- categories ---------------- */

/** The parts list's groups, in display order. A part's group comes from
 *  its `stage`, which the scan derives from where it is installed. */
export const PART_GROUPS = [
  { id: 'drive',  label: 'Drive End',       color: '#e34b3a', stage: 'drive' },
  { id: 'tail',   label: 'Tail End',        color: '#b07fd0', stage: 'tail' },
  { id: 'auger',  label: 'Augers',          color: '#f5b400', stage: 'screw' },
  { id: 'hanger', label: 'Hanger Bearings', color: '#4fae57', stage: 'bearings' },
  { id: 'other',  label: 'Other',           color: '#98a1a9', stage: 'other' }
];

/** The part types a scan keeps (scan/categories.js), for correcting one. */
export const PART_TYPES = ['Drive', 'Motor', 'Reducer', 'Seal', 'Bearing', 'Hanger Bearing',
  'Drive Shaft', 'Tail Shaft', 'Coupling Shaft', 'Shaft', 'Auger'];

const GROUP_BY_STAGE = { drive: 'drive', tail: 'tail', screw: 'auger', bearings: 'hanger' };

/** A part's group. A leftover trough-stage part (troughs are no longer
 *  listed) falls into Other rather than vanishing. */
export const partGroup = c => PART_GROUPS.find(g => g.id === (GROUP_BY_STAGE[c.stage] || 'other'));

/* ---------------- tips ---------------- */

// Order matters: the first match wins, so specific parts sit above the
// generic names that would also match them (hanger bearing before
// bearing, waste pack before seal, drive plate before end plate).
export const PART_TIPS = [
  { id:'hanger', name:'Hanger bearing', match:/\bhanger/i,
    what:"A bracket and bearing that holds up the screw between the ends.",
    purpose:"Keeps a long screw from sagging into the trough.",
    where:"At each joint between screw sections, bolted across the trough top.",
    how:"Center the bearing on the coupling shaft, then bolt it down. Leave a gap so the pipe ends don't touch it." },
  { id:'wastePack', name:'Waste pack seal', match:/\bwaste\s*pack/i,
    what:"A seal housing packed with fiber, around the shaft.",
    purpose:"Stops material leaking out the end and protects the bearing.",
    where:"On the shaft, between the end plate and the end bearing.",
    how:"Slide it on the shaft and bolt it to the end plate. Make sure it's packed." },
  { id:'flangeGland', name:'Flange gland', aka:'packing gland', match:/\bgland/i,
    what:"A seal housing with packing rings and a gland that squeezes them.",
    purpose:"A tighter seal than a waste pack. Keeps material and dust in.",
    where:"On the shaft, between the end plate and the end bearing.",
    how:"Bolt the housing to the end plate. Stagger the ring splits, then snug the gland bolts evenly. Don't overtighten." },
  { id:'seal', name:'Shaft seal', match:/\bseals?\b/i,
    what:"The seal where a shaft passes through the trough end.",
    purpose:"Keeps material in and protects the bearing.",
    where:"On the shaft, between the end plate and the end bearing.",
    how:"Use the seal type the drawing calls for. Keep it centered on the shaft." },
  { id:'endBearing', name:'End bearing', aka:'flange bearing, pillow block', match:/\b(bearings?|brg|pillow\s*blocks?)\b/i,
    what:"The bearing on the outside of each end of the conveyor.",
    purpose:"Holds the end shaft centered so it turns smoothly.",
    where:"Outside face of the drive and tail end plates.",
    how:"Slide it on the shaft, bolt it down, then lock the set screws or collar. The shaft should spin without binding." },
  { id:'couplingBolts', name:'Coupling bolts', match:/\bcoupling\s*bolts?\b/i,
    what:"Hardened, tight-fit bolts made for screw couplings.",
    purpose:"Lock each shaft into the screw pipe so it can't work loose.",
    where:"Through the screw pipe and shaft, at every shaft connection.",
    how:"Use only coupling bolts, never regular bolts. Tighten the locknuts fully." },
  { id:'couplingShaft', name:'Coupling shaft', match:/\bcouplings?\b/i,
    what:"A short solid shaft that joins two screw sections.",
    purpose:"Makes the screws turn as one, and rides in the hanger bearing.",
    where:"At every joint between screw sections.",
    how:"Slide it into both pipe ends, line up the holes, and bolt it with coupling bolts." },
  { id:'driveShaft', name:'Drive shaft', match:/\bdrive\s*shafts?\b/i,
    what:"The shaft that connects the screw to the drive.",
    purpose:"Carries the turning force from the reducer into the screw.",
    where:"Drive end. Runs through the end plate, seal, and bearing into the screw pipe.",
    how:"Bolt it into the screw pipe with coupling bolts. Check it's centered and turns freely." },
  { id:'tailShaft', name:'Tail shaft', aka:'end shaft', match:/\b(tail|end)\s*shafts?\b/i,
    what:"The shaft at the non-driven end of the screw.",
    purpose:"Supports the tail end of the screw.",
    where:"Tail end. Runs through the end plate, seal, and bearing into the screw pipe.",
    how:"Bolt it into the screw pipe with coupling bolts. Check it's centered and turns freely." },
  { id:'shroud', name:'Shroud', match:/\bshrouds?\b/i,
    what:"A curved cover that sits down inside the trough, over the screw.",
    purpose:"Makes that stretch act like a tube, so material can't flood over the screw.",
    where:"Usually just past the inlet. The drawing shows the exact spot.",
    how:"Set it over the screw and bolt it to the trough flanges. Turn the screw by hand to check nothing rubs." },
  { id:'cover', name:'Trough cover', match:/\bcovers?\b/i,
    what:"The flat lid on top of the trough.",
    purpose:"Keeps dust in and hands out.",
    where:"On the trough top flanges, along the whole run.",
    how:"Fasten it with the clamps or bolts on the drawing. Put it on after the screw turns freely." },
  { id:'drivePlate', name:'Drive plate', aka:'drive end plate', match:/\bdrive\s*(end\s*)?plates?\b/i,
    what:"The heavy end plate at the drive end of the trough.",
    purpose:"Caps the drive end and carries the seal, bearing, and drive.",
    where:"Drive end flange of the trough.",
    how:"Bolt it on with the hardware on the drawing. Check it's square to the shaft before final tightening." },
  { id:'tailPlate', name:'Tail end plate', aka:'trough end', match:/\b(tail\s*(end\s*)?plate|trough\s*end|end\s*plate)s?\b/i,
    what:"The end plate that closes off the tail end of the trough.",
    purpose:"Caps the end and carries the tail seal and bearing.",
    where:"Tail end flange of the trough.",
    how:"Bolt it to the end flange. The seal and bearing mount on its outside face." },
  { id:'reducer', name:'Reducer', aka:'gearbox', match:/\b(reducers?|gear\s*box(es)?)\b/i,
    what:"The gearbox between the motor and the screw.",
    purpose:"Slows the motor down and adds the torque to turn the screw.",
    where:"Drive end, on the drive shaft or drive plate.",
    how:"Mount it per the drawing (torque arm if it's shaft-mounted). Check the oil before first run. Some ship dry." },
  { id:'motor', name:'Motor', match:/\b(gear\s*)?motors?\b/i,
    what:"The electric motor that powers the drive.",
    purpose:"Supplies the power that turns the screw.",
    where:"Drive end, on the reducer or a motor mount.",
    how:"Bolt it on per the drawing. Leave wiring to an electrician, then bump it to check rotation before running material." },
  { id:'drive', name:'Drive', aka:'screw conveyor drive', match:/\bdrives?\b(?!\s*(end|plate|guard|base|shaft))/i,
    what:"The drive unit that turns the screw -- usually a reducer with a motor.",
    purpose:"Powers the conveyor.",
    where:"Drive end, on the drive shaft or drive plate.",
    how:"Mount it per the drawing (torque arm if it's shaft-mounted). Check oil and rotation before running material." },
  { id:'gasket', name:'Gasket', match:/\bgaskets?\b/i,
    what:"A flat rubber or fiber strip that seals a bolted joint.",
    purpose:"Stops dust and material leaking out between two flanges.",
    where:"Between bolted flanges -- trough joints, end plates, inlets, discharges -- where the drawing shows.",
    how:"Lay it flat, line up the bolt holes, then tighten the bolts evenly. Don't let it bunch or pinch." },
  { id:'uhmw', name:'UHMW', aka:'UHMW poly', match:/\buhmw\b/i,
    what:"A slick, tough plastic (ultra-high-molecular-weight polyethylene).",
    purpose:"Cuts wear and keeps material from sticking.",
    where:"Usually a liner in the trough, or hanger bearing inserts. Match the drawing.",
    how:"Bolt it down with the heads flush or below the surface. Keep any expansion gaps shown -- UHMW grows with heat." },
  { id:'screw', name:'Screw', aka:'auger, flighting', match:/\b(augers?|flight(ing)?s?|screw\s*(assembly|assy|section|conveyor)s?)\b|^\s*screws?\s*$/i,
    what:"Spiral flighting welded around a pipe.",
    purpose:"Turns and pushes material along the trough.",
    where:"Inside the trough, end to end, in drawing order.",
    how:"Check the flight hand (left or right) matches the drawing before setting it in. Flights should line up at each joint." },
  { id:'inlet', name:'Inlet', match:/\binlets?\b/i,
    what:"The opening where material comes into the conveyor.",
    purpose:"Feeds material onto the screw.",
    where:"On top, usually near the tail end. Match the drawing.",
    how:"Bolt the inlet flange to the cover or trough. Seal the joint if the drawing calls for it." },
  { id:'discharge', name:'Discharge', aka:'spout', match:/\b(discharges?|spouts?)\b/i,
    what:"The opening where material leaves the conveyor.",
    purpose:"Lets the material drop out at the end of the run.",
    where:"Bottom of the trough, usually near the drive end.",
    how:"Bolt on any spout or gate shown on the drawing. Seal the flange joint." },
  { id:'trough', name:'Trough', match:/\btroughs?\b/i,
    what:"The U-shaped steel channel the screw turns in.",
    purpose:"Holds the material while the screw pushes it along.",
    where:"It's the body of the conveyor. Everything else mounts to it.",
    how:"Bolt sections flange to flange in drawing order. Keep the bottoms flush and the run straight." }
];

export const TIP_BY_ID = Object.fromEntries(PART_TIPS.map(t => [t.id, t]));

/** The parts each procedure step works with. The two "verify" steps are
 *  left out on purpose: the parts list covers identifying parts. */
const STEP_PARTS = {
  'Assemble Troughs': ['trough', 'gasket'],
  'Assemble Screws, Troughs, Couplings & Shafts': ['screw', 'couplingShaft', 'couplingBolts'],
  'Assemble Drive End': ['wastePack', 'flangeGland', 'endBearing', 'driveShaft', 'reducer', 'drivePlate'],
  'Mark, Drill & Install Hanger Bearings': ['hanger'],
  'Assemble Tail End': ['tailPlate', 'wastePack', 'flangeGland', 'endBearing', 'tailShaft']
};

export const tipsForStep = stepIndex =>
  (STEP_PARTS[(PROCEDURE[stepIndex] || {}).title] || []).map(id => TIP_BY_ID[id]).filter(Boolean);

// A generic name ("Bearing", "End plate", "Shaft") doesn't say which one
// it is -- the part's stage settles it.
const STAGE_SWAP = {
  endBearing: { bearings: 'hanger' },
  tailPlate:  { drive: 'drivePlate' },
  tailShaft:  { drive: 'driveShaft' }
};
const SHAFT_BY_STAGE = { drive: 'driveShaft', tail: 'tailShaft', screw: 'couplingShaft', bearings: 'couplingShaft' };

/** The tip for a part in the parts list, or null. Matches on the part name
 *  only -- spec text mentions other parts, and a wrong tip is worse than
 *  none. */
export function tipForPart(c){
  const item = String((c && c.item) || '');
  let id = (PART_TIPS.find(t => t.match.test(item)) || {}).id;
  if(!id && /\bshafts?\b/i.test(item)) id = SHAFT_BY_STAGE[c.stage];
  id = (STAGE_SWAP[id] && STAGE_SWAP[id][c.stage]) || id;
  return id ? TIP_BY_ID[id] : null;
}
