/**
 * Rejoining the answers from two halves of a divided reading.
 *
 * When a group of pages is split, each half comes back as a complete
 * answer about fewer sheets, and the two have to read afterwards exactly
 * as one answer about all of them. Lists concatenate. For single answers
 * (the title block, which end the drive is on) a real reading always
 * beats "not found": a half that did not see the sheet has nothing to say
 * about it, and its silence must not overwrite the half that did.
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

/** The layout answer from two halves: a half that saw no motor says
 *  "unknown" and must not overwrite the half that saw one. */
export function mergeLayout(a, b){
  const out = mergeListed(a, b, []);
  const orient = [a && a.orientation, b && b.orientation]
    .find(o => o && o.drive_end_side && o.drive_end_side !== 'unknown');
  out.orientation = orient || (a && a.orientation) || (b && b.orientation) || { drive_end_side: 'unknown' };
  return out;
}
