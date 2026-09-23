/**
 * Scan calibration: how a scan's parts list compares with the list a
 * person checked and marked correct for the same drawing (its answer
 * key), and what the scan should learn from the difference.
 *
 * Parts are matched by their wording on the drawing (learnKey), falling
 * back to the item number when the wording was read differently. Each
 * part is compared as a whole -- its type, the ends it goes at and its
 * total count -- so a QTY 2 bearing split one per end matches a key that
 * lists it the same way.
 */
import { learnKey, NOT_A_PART } from './partNames.js';

const count = q => (Number.isFinite(Number(q)) && q !== null && q !== '' ? Number(q) : 1);
const nameOf = p => String(p.item_as_drawn || p.item || '').trim() || 'Unnamed part';

/** One entry per part: its entries on the list rolled together. */
function rollUp(list){
  const out = new Map();
  for(const p of list || []){
    if(!p) continue;
    const key = learnKey(p.item_as_drawn) || `#${p.balloon || ''}:${learnKey(p.item)}`;
    const e = out.get(key) || { key, name: nameOf(p), item: p.item, balloon: p.balloon ?? null, qty: 0, ends: new Set() };
    e.qty += count(p.quantity);
    e.ends.add(p.installation_location || 'unknown');
    out.set(key, e);
  }
  return out;
}

const endsOf = e => [...e.ends].filter(x => x !== 'unknown').sort().join(',') || 'unknown';

/**
 * @param expected the answer key's parts
 * @param found    what a scan found
 * @returns {score 0-100, expected, found, right, missed[], extra[],
 *           wrongType[], wrongEnd[], wrongQty[]}
 */
export function compareParts(expected, found){
  const want = rollUp(expected), got = rollUp(found);
  const used = new Set();
  const r = { expected: want.size, found: got.size, right: 0, missed: [], extra: [], wrongType: [], wrongEnd: [], wrongQty: [] };
  let points = 0;
  for(const w of want.values()){
    let g = got.get(w.key);
    if(!g && w.balloon != null){
      g = [...got.values()].find(x => !used.has(x.key) && x.balloon != null && String(x.balloon) === String(w.balloon));
    }
    if(!g || used.has(g.key)){ r.missed.push(w.name); continue; }
    used.add(g.key);
    let ok = true;
    if(learnKey(g.item) !== learnKey(w.item)){ ok = false; r.wrongType.push({ name: w.name, got: g.item, want: w.item }); }
    if(endsOf(g) !== endsOf(w)){ ok = false; r.wrongEnd.push({ name: w.name, got: endsOf(g), want: endsOf(w) }); }
    if(g.qty !== w.qty){ ok = false; r.wrongQty.push({ name: w.name, got: g.qty, want: w.qty }); }
    if(ok){ r.right++; points += 1; } else points += 0.5;
  }
  for(const g of got.values()) if(!used.has(g.key)) r.extra.push(g.name);
  const outOf = want.size + r.extra.length;
  r.score = outOf ? Math.round(100 * points / outOf) : 100;
  return r;
}

/**
 * What a scan should learn from a checked list: every checked part's type
 * (and its end, when it goes at just one), so the same wording reads the
 * same way next time; and every part the scan kept that the checked list
 * doesn't have, as not a part. Returns part_names rows {key, drawn, item,
 * location}. Only parts with wording can be learned.
 */
export function lessonsFrom(expected, found){
  const want = rollUp(expected), got = rollUp(found);
  const lessons = [];
  for(const w of want.values()){
    if(w.key.startsWith('#')) continue;
    const g = got.get(w.key);
    const ends = [...w.ends].filter(x => x !== 'unknown');
    const location = ends.length === 1 ? ends[0] : null;
    if(g && learnKey(g.item) === learnKey(w.item) && endsOf(g) === endsOf(w)) continue;
    lessons.push({ key: w.key, drawn: w.name, item: w.item, location });
  }
  for(const g of got.values()){
    if(g.key.startsWith('#') || want.has(g.key)) continue;
    lessons.push({ key: g.key, drawn: g.name, item: NOT_A_PART, location: null });
  }
  return lessons;
}
