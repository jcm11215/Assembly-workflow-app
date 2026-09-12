/**
 * Where to put each callout label, and where to run its leader line.
 *
 * Pure geometry -- no DOM, no state -- because this is the part that is
 * actually easy to get wrong: labels that collide, leader lines that
 * cross each other, or a part on the left of the drawing whose label
 * sits on the right with a line dragged across the whole sheet.
 *
 * Everything is a percentage of the CONTAINER, so the caller can size
 * the diagram however it likes and the numbers stay correct. The drawing
 * itself occupies a centre band with a gutter either side for labels.
 */

export const GUTTER = 21;          // % of container width, each side
export const IMAGE_LEFT = GUTTER;
export const IMAGE_WIDTH = 100 - GUTTER * 2;

// Labels stay inside this vertical band so the first and last aren't
// flush against the container edge.
const TOP = 4;
const BOTTOM = 96;

// A label needs roughly this much vertical room before two of them start
// touching. Below it, the band is expanded rather than the labels
// overlapped -- a cramped-but-readable diagram beats a tidy unreadable one.
export const MIN_LABEL_GAP = 9;

// ...but a percentage gap is only as tall as the sheet it's measured
// against, and a wide, shallow drawing gives a short container in which
// 9% is a few pixels. The diagram is held to at least this many pixels
// per label on its busiest side so the margins always have room.
export const PX_PER_LABEL = 38;

// Two parts belong to the same row while the vertical step between them
// stays under this. It's a gap between neighbours, not a fixed band:
// bands put boundaries at arbitrary heights, and two parts a millimetre
// apart that straddle one get read in the wrong order.
export const ROW_GAP = 0.08;

/**
 * Spreads n labels down a band, keeping them in the given order and at
 * least MIN_LABEL_GAP apart. Returns the y centre of each, in order.
 */
function spread(n, top, bottom){
  if(n <= 0) return [];
  if(n === 1) return [(top + bottom) / 2];
  const span = bottom - top;
  const needed = (n - 1) * MIN_LABEL_GAP;
  // Not enough room at the preferred band: grow symmetrically around the
  // middle instead of letting labels pile up on each other.
  if(needed > span){
    const mid = (top + bottom) / 2;
    const half = needed / 2;
    top = mid - half;
    bottom = mid + half;
  }
  const step = (bottom - top) / (n - 1);
  return Array.from({ length: n }, (_, i) => top + i * step);
}

/* ------------------------------------------------------------------ *
 * Framing: which part of the sheet to actually show.
 * ------------------------------------------------------------------ */

// A drawing sheet is mostly not the conveyor -- border, title block,
// notes, other views. The parts are all ON the machine, so the box they
// occupy locates it; these pad that box back out to the machine itself,
// which extends past the outermost part.
const PAD_X = 0.06;           // of the sheet, each side
const PAD_Y = 0.10;
const MIN_W = 0.30;           // never zoom past this, however tight the parts
const MIN_H = 0.22;
// Above this much of the sheet there's nothing worth cropping away.
const NO_CROP_ABOVE = 0.86;

function clamp01(v){ return Math.max(0, Math.min(1, v)); }

/** Grows a 1-D span to at least `min`, staying inside 0..1. */
function atLeast(lo, hi, min){
  const short = min - (hi - lo);
  if(short <= 0) return [lo, hi];
  lo -= short / 2; hi += short / 2;
  if(lo < 0){ hi -= lo; lo = 0; }
  if(hi > 1){ lo -= (hi - 1); hi = 1; }
  return [clamp01(lo), clamp01(hi)];
}

/**
 * The region of the sheet holding the conveyor, as 0..1 of the page, or
 * null when the parts already cover enough of it that cropping would
 * gain nothing. Derived from the parts rather than asked of the AI: they
 * are the thing we know the position of, and a machine drawn around them
 * cannot be far away.
 */
export function frameForParts(components){
  const pts = (components || []).filter(c => c && c.position).map(c => c.position);
  if(pts.length < 2) return null;          // one part locates nothing useful

  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  let [x0, x1] = atLeast(clamp01(Math.min(...xs) - PAD_X), clamp01(Math.max(...xs) + PAD_X), MIN_W);
  let [y0, y1] = atLeast(clamp01(Math.min(...ys) - PAD_Y), clamp01(Math.max(...ys) + PAD_Y), MIN_H);

  const w = x1 - x0, h = y1 - y0;
  if(w >= NO_CROP_ABOVE && h >= NO_CROP_ABOVE) return null;
  return { x: x0, y: y0, w, h };
}

/** A part's position expressed inside the frame instead of the page. */
export function pointInFrame(position, frame){
  if(!frame) return { x: position.x, y: position.y };
  return { x: (position.x - frame.x) / frame.w, y: (position.y - frame.y) / frame.h };
}

/**
 * How to place the sheet image so `frame` fills its box, given the page
 * image's real pixel size. All percentages, so the caller can size the
 * box however it likes.
 */
export function frameImageStyle(frame, pageW, pageH){
  if(!frame || !(pageW > 0) || !(pageH > 0)) return null;
  return {
    aspectRatio: (frame.w * pageW) / (frame.h * pageH),
    width: 100 / frame.w,
    left: -100 * frame.x / frame.w,
    top: -100 * frame.y / frame.h
  };
}

/**
 * @param components  each needs {position:{x,y}} in 0..1; anything without
 *                    a position is skipped by the caller, not here.
 * @param frame       when cropping, the region being shown -- callout
 *                    points are then placed within it rather than the page.
 * @returns {{image:{left,width}, callouts:[...]}} callouts carry the
 *          1-based `number` shown in the balloon, the label box position,
 *          and the point on the drawing the leader line runs to.
 */
export function layoutCallouts(components, frame){
  const list = (components || []).filter(c => c && c.position);

  // Number them the way a person reads a drawing -- left to right, top to
  // bottom -- so the legend order matches scanning the sheet, not the
  // order the extractor happened to emit.
  //
  // Parts are grouped into rows first, because a conveyor elevation puts
  // almost all the hardware at roughly the same height -- ordering on raw
  // y would scramble one run into near-random order over millimetres.
  //
  // Rows come from walking a y-sorted list and breaking where the step
  // exceeds ROW_GAP, which keeps the whole thing a function of a total
  // order (y, then x) and so independent of the order parts arrived in.
  // Comparing "is this one within 8% of that one" directly would not:
  // that test isn't transitive, so the sort's result would be arbitrary
  // and the numbers would jump around the sheet.
  const byHeight = [...list].sort((a, b) => (a.position.y - b.position.y) || (a.position.x - b.position.x));
  const rows = [];
  for(const c of byHeight){
    const row = rows[rows.length - 1];
    if(row && c.position.y - row.lastY <= ROW_GAP){
      row.items.push(c);
      row.lastY = c.position.y;
    }else{
      rows.push({ lastY: c.position.y, items: [c] });
    }
  }
  const ordered = rows.flatMap(r => r.items.sort((a, b) => a.position.x - b.position.x));
  ordered.forEach((c, i) => { c._n = i + 1; });

  // A part on the left half gets a left-hand label: the leader line then
  // runs outward to the nearest edge instead of crossing the drawing.
  // Halves of what's ON SCREEN -- a crop moves parts relative to the
  // frame, and splitting on the page's midline would send a part now
  // sitting on the right out to a label on the left.
  const sideX = c => pointInFrame(c.position, frame).x;
  const left  = ordered.filter(c => sideX(c) < 0.5).sort((a, b) => a.position.y - b.position.y);
  const right = ordered.filter(c => sideX(c) >= 0.5).sort((a, b) => a.position.y - b.position.y);

  const callouts = [];
  for(const [side, group] of [['left', left], ['right', right]]){
    const ys = spread(group.length, TOP, BOTTOM);
    group.forEach((c, i) => {
      // Where the part sits in what's actually on screen -- the cropped
      // frame when there is one, the whole page otherwise.
      const p = pointInFrame(c.position, frame);
      callouts.push({
        number: c._n,
        component: c,
        side,
        // Where the label box sits, and the edge of it the line leaves from.
        labelY: ys[i],
        anchorX: side === 'left' ? GUTTER : 100 - GUTTER,
        // The point on the drawing itself.
        inFrame: p,
        pointX: IMAGE_LEFT + p.x * IMAGE_WIDTH,
        pointY: p.y * 100
      });
    });
  }

  callouts.sort((a, b) => a.number - b.number);
  ordered.forEach(c => { delete c._n; });
  return {
    image: { left: IMAGE_LEFT, width: IMAGE_WIDTH },
    callouts,
    // What the diagram has to be tall enough for: whichever margin is
    // carrying more labels.
    minHeightPx: Math.max(left.length, right.length) * PX_PER_LABEL
  };
}
