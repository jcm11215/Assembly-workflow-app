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
export const MIN_LABEL_GAP = 7.5;

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

/**
 * @param components  each needs {position:{x,y}} in 0..1; anything without
 *                    a position is skipped by the caller, not here.
 * @returns {{image:{left,width}, callouts:[...]}} callouts carry the
 *          1-based `number` shown in the balloon, the label box position,
 *          and the point on the drawing the leader line runs to.
 */
export function layoutCallouts(components){
  const list = (components || []).filter(c => c && c.position);

  // Number them the way a person reads a drawing -- left to right, top to
  // bottom -- so the legend order matches scanning the sheet, not the
  // order the extractor happened to emit.
  const ordered = [...list].sort((a, b) => {
    const dy = a.position.y - b.position.y;
    if(Math.abs(dy) > 0.08) return dy;        // same "row" if within 8%
    return a.position.x - b.position.x;
  });
  ordered.forEach((c, i) => { c._n = i + 1; });

  // A part on the left half gets a left-hand label: the leader line then
  // runs outward to the nearest edge instead of crossing the drawing.
  const left  = ordered.filter(c => c.position.x < 0.5).sort((a, b) => a.position.y - b.position.y);
  const right = ordered.filter(c => c.position.x >= 0.5).sort((a, b) => a.position.y - b.position.y);

  const callouts = [];
  for(const [side, group] of [['left', left], ['right', right]]){
    const ys = spread(group.length, TOP, BOTTOM);
    group.forEach((c, i) => {
      callouts.push({
        number: c._n,
        component: c,
        side,
        // Where the label box sits, and the edge of it the line leaves from.
        labelY: ys[i],
        anchorX: side === 'left' ? GUTTER : 100 - GUTTER,
        // The point on the drawing itself.
        pointX: IMAGE_LEFT + c.position.x * IMAGE_WIDTH,
        pointY: c.position.y * 100
      });
    });
  }

  callouts.sort((a, b) => a.number - b.number);
  ordered.forEach(c => { delete c._n; });
  return { image: { left: IMAGE_LEFT, width: IMAGE_WIDTH }, callouts };
}
