/**
 * Rejoining the answers from two halves of a divided reading.
 *
 * When a group of pages is split, each half comes back as a complete
 * answer about fewer sheets, and the two have to read afterwards exactly
 * as one answer about all of them. Lists concatenate, which is easy. The
 * interesting part is the dimension spec, where the same field can be
 * answered by both halves -- and there the rule is that a real reading
 * always beats "not found", because a half that did not see the sheet a
 * dimension is printed on has nothing to say about it, and its silence
 * must not overwrite the half that did.
 */

/** Concatenates the arrays under `field`, keeping everything else from
 *  whichever half actually had it. */
function mergeListed(a, b, fields){
  const out = { ...(a || {}), ...(b || {}) };
  for(const f of fields){
    const left = (a && Array.isArray(a[f])) ? a[f] : [];
    const right = (b && Array.isArray(b[f])) ? b[f] : [];
    out[f] = left.concat(right);
  }
  // A title block read from either half is the same title block; take
  // whichever half actually found it rather than letting the later one
  // blank it.
  for(const f of ['jobNumber', 'customer', 'description', 'drawing_number']){
    const pick = [a && a[f], b && b[f]].find(v => v != null && String(v).trim() !== '');
    if(pick != null) out[f] = pick;
    else if(f in out) delete out[f];
  }
  return out;
}

export const mergeClassification = (a, b) => mergeListed(a, b, ['pages']);
export const mergeParts          = (a, b) => mergeListed(a, b, ['parts']);
export const mergeCallouts       = (a, b) => mergeListed(a, b, ['callouts', 'unballooned']);

/** A dimension the model actually read, as opposed to one it reported as
 *  absent. Only the former may overwrite anything. */
function isAnswered(v){
  if(v == null || typeof v !== 'object') return false;
  if(Array.isArray(v)) return v.length > 0;
  if('value' in v) return v.value != null;
  if('status' in v) return v.status !== 'not_found';
  return Object.keys(v).length > 0;
}

function mergeGroup(a, b){
  const out = { ...(a || {}) };
  for(const [k, v] of Object.entries(b || {})){
    if(Array.isArray(v)){
      out[k] = (Array.isArray(out[k]) ? out[k] : []).concat(v);
    } else if(v && typeof v === 'object' && !('value' in v) && !('status' in v)){
      out[k] = mergeGroup(out[k], v);
    } else if(isAnswered(v) || !(k in out)){
      // A found value replaces a not_found; a not_found never replaces
      // a found one. That asymmetry is the whole point: the half that
      // could not see the sheet has nothing to contribute about it.
      if(isAnswered(v) || !isAnswered(out[k])) out[k] = v;
    }
  }
  return out;
}

/**
 * Merges two halves of the engineering spec.
 *
 * Where both halves answered the same dimension with different values
 * that is a genuine disagreement between sheets, which the spec already
 * has a place for -- it is recorded in `conflicts` rather than silently
 * resolved, the same as when one AI call reads a contradiction across
 * two pages.
 */
export function mergeSpec(a, b){
  const left = a || {}, right = b || {};
  const out = mergeGroup(left, right);

  const conflicts = [].concat(
    Array.isArray(left.conflicts) ? left.conflicts : [],
    Array.isArray(right.conflicts) ? right.conflicts : []);

  for(const group of Object.keys(left)){
    const lg = left[group], rg = right[group];
    if(!lg || !rg || typeof lg !== 'object' || typeof rg !== 'object' || Array.isArray(lg)) continue;
    for(const field of Object.keys(lg)){
      const lv = lg[field], rv = rg[field];
      if(!isAnswered(lv) || !isAnswered(rv)) continue;
      if(lv && rv && 'value' in lv && 'value' in rv && lv.value !== rv.value){
        conflicts.push({ field: `${group}.${field}`,
          detail: `pages read separately disagree: ${lv.value}${lv.unit ? ' ' + lv.unit : ''} vs ${rv.value}${rv.unit ? ' ' + rv.unit : ''}` });
      }
    }
  }

  out.conflicts = conflicts;
  // Both halves report which end the drive is on; a half that saw no
  // motor says "unknown" and must not overwrite the half that saw one.
  const orient = [left.orientation, right.orientation]
    .find(o => o && o.drive_end_side && o.drive_end_side !== 'unknown');
  if(orient) out.orientation = orient;
  return out;
}
