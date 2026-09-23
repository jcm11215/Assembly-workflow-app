/**
 * Joins the parts list (what) to the balloon callouts (where).
 *
 * This is deliberately code and not a prompt. Matching item number 7 in
 * the parts table to the balloons numbered 7 on the assembly view is a
 * lookup with exactly one right answer, and a model asked to do it while
 * also reading the table and finding the balloons will occasionally
 * produce a confident label on the wrong part. A join can't. It can only
 * fail to match, which is visible and recoverable.
 *
 * Nothing here invents a position. A part the drawing never balloons
 * comes out with position null and simply goes unlabeled on the diagram
 * -- the "not visible in the assembly view" case -- and a balloon with
 * no matching table row is reported rather than turned into a part,
 * since a number alone doesn't say what the thing is.
 */
import { stageForLocation } from './spec.js';

/** Strips a description down to something two spellings of the same part
 *  can be compared on: caps, no punctuation, single spaces. */
function normText(s){
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

function balloonKey(v){
  if(v == null || v === '') return null;
  const n = Number(String(v).trim());
  return isFinite(n) ? String(Math.trunc(n)) : normText(v) || null;
}

/** [x,y,w,h] as fractions of the page, or null. Only ever used to derive
 *  an aiming point when the callout pass gave a box but no leader tip --
 *  the box itself isn't kept, since an arrow needs a point.
 *
 *  Rejects the degenerate and the out-of-range rather than clamping: a
 *  box that needed fixing wasn't read off the drawing. */
function normBbox(b){
  if(!Array.isArray(b) || b.length !== 4) return null;
  const [x, y, w, h] = b.map(Number);
  if(![x, y, w, h].every(n => isFinite(n))) return null;
  if(w <= 0 || h <= 0) return null;
  if(x < 0 || y < 0 || x > 1 || y > 1 || x + w > 1.001 || y + h > 1.001) return null;
  return [x, y, Math.min(w, 1 - x), Math.min(h, 1 - y)];
}

function normPoint(p){
  if(!p || typeof p !== 'object') return null;
  const x = Number(p.x), y = Number(p.y);
  if(!isFinite(x) || !isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

/** The point an arrow should aim at: the leader's own tip when the pass
 *  gave one, otherwise the middle of the component's box. */
function pointFor(callout){
  return normPoint(callout && callout.position)
    || (callout && callout.bbox ? bboxCentre(normBbox(callout.bbox)) : null);
}

function bboxCentre(bb){
  return bb ? { x: bb[0] + bb[2] / 2, y: bb[1] + bb[3] / 2 } : null;
}

/** A located callout, or null when it says nothing about where anything is. */
function normCallout(c){
  if(!c || typeof c !== 'object') return null;
  const position = pointFor(c);
  if(!position) return null;
  return {
    balloon: balloonKey(c.balloon),
    label: typeof c.label === 'string' ? c.label.trim() : '',
    source_page: c.source_page != null ? Number(c.source_page) : null,
    position,
    end: ['drive_end', 'tail_end', 'along_run'].includes(c.end) ? c.end : null,
    confidence: isFinite(Number(c.confidence)) ? Math.min(1, Math.max(0, Number(c.confidence))) : 0.5
  };
}

/** Everything but letters and digits removed, so "GEARMOTOR, 3/4HP" and
 *  "GEARMOTOR 3/4 HP" compare equal. */
function squash(s){ return normText(s).replace(/ /g, ''); }

/** Words worth comparing -- the short ones are noise in a parts list. */
function tokens(s){ return normText(s).split(' ').filter(w => w.length > 2); }

/**
 * Matches a text callout to a table row by wording, for drawings that
 * label parts in words instead of numbering them.
 *
 * Only the VERBATIM description is matched loosely. The category name is
 * a single generic word -- "Bearing", "Motor" -- and matching on it puts
 * "HANGER BEARING ASSEMBLY" onto a tail-end flange bearing because both
 * contain the word. So a part that has a written description is matched
 * on that alone, and a near-miss is a refusal: an unlabeled part is
 * always better than a confidently mislabeled one.
 */
function labelMatchesPart(label, part){
  const a = normText(label);
  if(a.length < 3) return false;
  const drawn = normText(part.item_as_drawn);

  if(drawn){
    const as = squash(a), bs = squash(drawn);
    if(as === bs) return true;
    // Long enough that containment means something. "BRG" inside
    // "HANGERBRGASSY" would not.
    if(bs.length >= 6 && (as.includes(bs) || bs.includes(as))) return true;
    const at = new Set(tokens(a)), bt = tokens(drawn);
    if(bt.length){
      const shared = bt.filter(w => at.has(w)).length;
      if(shared >= 2 && shared >= Math.ceil(bt.length / 2)) return true;
    }
    return false;
  }

  // Nothing written to compare against -- the category is all there is,
  // and being one generic word it only counts on an exact hit.
  const category = squash(part.item);
  return !!category && squash(a) === category;
}

/** Parts that run along the conveyor: a single balloon covers every one
 *  of them (three flights, four hangers), so their count stays with the
 *  places found rather than being split off as "not found". */
const ALONG_RUN = /^(auger|coupling|hanger|uhmw)/i;

/**
 * How many of a table row go at each place found for it, so the counts
 * always add up to the table's quantity. `want` is that quantity (or
 * NaN), `places` how many places were found.
 *
 *   QTY 2, found at 2 places     -> 1 + 1
 *   QTY 1, found at 1 place      -> 1
 *   QTY 2 bearing, found at 1    -> 1 here, and 1 whose place wasn't found
 *   QTY 3 flights, found at 1    -> 3 there (one balloon covers the run)
 *   QTY 4 hangers, found at 2    -> 2 + 2
 */
export function splitQuantity(part, places){
  const want = Number(part.quantity);
  if(!(want > 0) || !Number.isFinite(want)) return { each: Array(places).fill(places > 1 ? 1 : part.quantity), unplaced: 0 };
  if(want <= places) return { each: Array(places).fill(1), unplaced: 0 };
  if(ALONG_RUN.test(String(part.item || '').trim())){
    const base = Math.floor(want / places), extra = want % places;
    return { each: Array.from({ length: places }, (_, i) => base + (i < extra ? 1 : 0)), unplaced: 0 };
  }
  return { each: Array(places).fill(1), unplaced: want - places };
}

/** A part instance carrying one callout's location. */
function place(part, callout, quantity){
  return {
    ...part,
    source_page: callout.source_page != null ? callout.source_page : part.source_page,
    source_callout: callout.label || part.source_callout || '',
    position: callout.position,
    drawn_end: callout.end,
    // How many of the row go at this place -- see splitQuantity().
    quantity,
    extraction_method: 'callout',
    // The join is only as good as the balloon read that fed it.
    confidence: Math.min(part.confidence == null ? 0.5 : part.confidence, callout.confidence)
  };
}

/**
 * @param parts       from the parts-list pass -- already whitelisted and
 *                    normalized by spec.js, so this only adds location.
 * @param calloutPass raw {callouts, unballooned} from the callout pass.
 * @returns {{components, report}} components in parts-table order, each
 *          instance of a multi-location part following its siblings.
 */
export function joinPartsAndCallouts(parts, calloutPass){
  const list = Array.isArray(parts) ? parts : [];
  const raw = calloutPass && typeof calloutPass === 'object' ? calloutPass : {};

  const ballooned = [];
  const byBalloon = new Map();
  for(const c of (Array.isArray(raw.callouts) ? raw.callouts : [])){
    const n = normCallout(c);
    if(!n) continue;
    ballooned.push(n);
    if(n.balloon == null) continue;
    if(!byBalloon.has(n.balloon)) byBalloon.set(n.balloon, []);
    byBalloon.get(n.balloon).push(n);
  }
  // A balloon-less entry from the callouts array is still a location; it
  // just has to be matched by wording like an unballooned one.
  const byText = (Array.isArray(raw.unballooned) ? raw.unballooned : [])
    .map(normCallout).filter(Boolean)
    .concat(ballooned.filter(c => c.balloon == null));

  const usedBalloons = new Set();
  const usedText = new Set();
  const components = [];
  const unplaced = [];
  const quantityMismatches = [];

  for(const part of list){
    const key = balloonKey(part.balloon);
    const hits = key != null ? (byBalloon.get(key) || []) : [];
    if(hits.length){
      usedBalloons.add(key);
      // One table row can be several parts on the conveyor -- a flange
      // bearing listed once with QTY 2 is one at each end. Each place
      // found gets its share; any not found are kept as a separate entry
      // with no place, so they show up to be put at the right end rather
      // than hiding inside another place's count.
      const { each, unplaced: missing } = splitQuantity(part, hits.length);
      hits.forEach((c, i) => components.push(place(part, c, each[i])));
      if(missing > 0){
        components.push({ ...part, quantity: missing, position: null, installation_location: 'unknown' });
        unplaced.push(`${part.item_as_drawn || part.item} (${missing} of ${part.quantity})`);
      }
      const want = Number(part.quantity);
      if(isFinite(want) && want > 0 && want !== hits.length){
        // Counted as above, but still reported: fewer places than the
        // table says may be a missed balloon, more means the table or the
        // balloon read is wrong, and we can't tell which.
        quantityMismatches.push(`${part.item_as_drawn || part.item}: table says ${want}, found ${hits.length} on the drawing`);
      }
      continue;
    }

    const i = byText.findIndex((c, idx) => !usedText.has(idx) && c.label && labelMatchesPart(c.label, part));
    if(i >= 0){
      usedText.add(i);
      components.push(place(part, byText[i], part.quantity));
      continue;
    }

    // Listed in the table, not found on a view: keep it, unlocated. It
    // still belongs on the hardware list, it just gets no arrow.
    components.push({ ...part, position: null });
    unplaced.push(part.item_as_drawn || part.item);
  }

  const unmatchedBalloons = [...byBalloon.keys()].filter(k => !usedBalloons.has(k));
  return {
    components,
    report: {
      partsFromTable: list.length,
      calloutsFound: ballooned.length + byText.length,
      placed: components.filter(c => c.position).length,
      // Listed but never drawn -- the "not visible in the assembly view"
      // case, normal on any set whose table covers more than one sheet.
      notVisible: unplaced.slice(0, 12),
      // Drawn but not in the table: either the table pass missed a row or
      // the balloon was misread. Worth seeing; never guessed at.
      unmatchedBalloons: unmatchedBalloons.slice(0, 12),
      quantityMismatches: quantityMismatches.slice(0, 12)
    }
  };
}

/* ================================================================
   Which end of the machine a part belongs to
   ================================================================
   The parts pass reads a table, and a table row often doesn't say. The
   old single-call prompt had the model work this out from the assembly
   view, which is where drive/tail mixups came from -- so it is resolved
   here instead, from two things that are not guesses: the part's own
   category, and where its balloon sits relative to the drive end.     */

/** Categories whose home is not in question. A motor is at the drive end
 *  on every conveyor ever built; a hanger bearing hangs in the span. */
const LOCATION_BY_CATEGORY = [
  [/^drive shaft/i,     'drive_end'],
  [/^tail shaft/i,      'tail_end'],
  [/^hanger/i,          'hanger'],
  [/^(motor|reducer)/i, 'drive_end'],
  [/^drive/i,           'drive_end'],
  [/^(auger|coupling)/i, 'screw']
];

function locationFromCategory(item){
  const hit = LOCATION_BY_CATEGORY.find(([re]) => re.test(String(item || '').trim()));
  return hit ? hit[1] : null;
}

/** Which axis the machine runs along, and which way round, from the
 *  layout question's orientation answer. */
const DRIVE_SIDE = {
  left:   { axis:'x', driveAtLow:true },
  right:  { axis:'x', driveAtLow:false },
  top:    { axis:'y', driveAtLow:true },
  bottom: { axis:'y', driveAtLow:false }
};

/**
 * Fills in "unknown" locations, in order of authority: the part's own
 * category (a motor is always at the drive end), then which end the
 * balloon search saw it at, then -- only when that was not answered --
 * where its balloon sits on the page, near one end or the other.
 *
 * The end-thirds rule only fires near an end: the middle of a conveyor
 * is where hangers live and where an unlabeled bearing is genuinely
 * ambiguous, so a part there keeps its honest "unknown".
 *
 * @param orientation the layout answer's {drive_end_side}; ignored when
 *                    it is missing or "unknown".
 */
export function resolveLocations(components, orientation){
  const side = DRIVE_SIDE[String(orientation && orientation.drive_end_side || '').toLowerCase()];
  let byCategory = 0, byCallout = 0, byPosition = 0;

  const resolved = (components || []).map(c => {
    if(!c || (c.installation_location && c.installation_location !== 'unknown')) return c;

    let location = locationFromCategory(c.item);
    if(location) byCategory++;

    if(!location && (c.drawn_end === 'drive_end' || c.drawn_end === 'tail_end')){
      location = c.drawn_end;
      byCallout++;
    }

    if(!location && side && c.position){
      const along = c.position[side.axis];
      const nearLow = along <= 0.33, nearHigh = along >= 0.67;
      if(nearLow || nearHigh){
        const atDriveEnd = side.driveAtLow ? nearLow : nearHigh;
        location = atDriveEnd ? 'drive_end' : 'tail_end';
        byPosition++;
      }
    }
    if(!location) return c;
    // stage is derived from location, never carried separately, so it has
    // to move with it or the part sorts into the wrong bucket.
    return { ...c, installation_location: location, stage: stageForLocation(location) };
  });

  return { components: resolved, report: { locatedByCategory: byCategory, locatedByCallout: byCallout, locatedByPosition: byPosition } };
}

/** The order the parts list shows its groups in (domain/parts.js):
 *  drive end, tail end, augers, hanger bearings, then the rest. */
const LOCATION_ORDER = ['drive_end', 'tail_end', 'screw', 'hanger', 'trough', 'other', 'unknown'];

/**
 * Sorts parts by where they go -- drive end, tail end, the run, then
 * anything unplaced. Within a location, table order is kept.
 */
export function sortByLocation(components){
  const rank = c => {
    const i = LOCATION_ORDER.indexOf(c.installation_location || 'unknown');
    return i < 0 ? LOCATION_ORDER.length : i;
  };
  return (components || []).map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map(x => x.c);
}
