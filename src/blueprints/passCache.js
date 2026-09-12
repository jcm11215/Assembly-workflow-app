/**
 * Keeps the passes a scan already got right, so a retry only re-runs the
 * ones that failed.
 *
 * A scan is four separate readings of the same drawing -- classify the
 * pages, read the parts table, find the balloons, read the dimensions --
 * and they fail independently. Without this, one pass hitting the free
 * tier's per-minute cap meant retrying the whole scan: four more
 * requests against the same cap that just refused one, which is the
 * surest way to stay rate-limited. With it, a retry spends exactly as
 * many requests as there are passes still missing, usually one.
 *
 * Held in memory only. This exists to recover a scan that failed a
 * moment ago, not to remember drawings across sessions -- and a stale
 * answer surviving a reload would be worse than a re-read.
 */

/**
 * Identifies the drawing being scanned, cheaply.
 *
 * Hashing several megabytes of base64 on a phone to decide whether to
 * skip a network call would be a poor trade, so this samples instead:
 * every image's length plus its first and last stretch. Two different
 * drawings agreeing on all of that is not a realistic accident, and the
 * cost of being wrong is bounded anyway -- a reused pass on the wrong
 * drawing would have to survive the same job's own re-scan, which clears
 * the cache.
 */
export function fingerprint(contentBlocks, includeJobFields){
  const parts = [includeJobFields ? 'job' : 'rescan'];
  for(const b of (contentBlocks || [])){
    if(b.type === 'image' && b.source && b.source.data){
      const d = b.source.data;
      parts.push(`${d.length}:${d.slice(0, 48)}:${d.slice(-48)}`);
    } else if(b.type === 'text'){
      parts.push(b.text || '');
    }
  }
  return parts.join('|');
}

// drawing fingerprint -> { passName: parsedReply }. Only the last couple
// of drawings are kept; anything older is a scan nobody is retrying.
const MAX_DRAWINGS = 2;
const cache = new Map();

/** The passes already read for this drawing, or an empty object. */
export function cachedPasses(key){
  return cache.get(key) || {};
}

/** Remembers one pass's parsed reply. Only ever called for a pass that
 *  actually succeeded -- a failed pass must re-run, that is the point. */
export function rememberPass(key, passName, parsed){
  if(!key || !passName) return;
  const entry = cache.get(key) || {};
  entry[passName] = parsed;
  // Re-set so this drawing becomes the most recently used.
  cache.delete(key);
  cache.set(key, entry);
  while(cache.size > MAX_DRAWINGS) cache.delete(cache.keys().next().value);
}

/**
 * Forgets a drawing. Called once a scan completes with everything it
 * needs, so "Re-Scan" means a genuine re-read rather than replaying the
 * answers from last time -- which is the whole reason someone taps it.
 */
export function forgetDrawing(key){
  cache.delete(key);
}

/** Test seam: nothing in the app clears the whole cache. */
export function clearAllPasses(){ cache.clear(); }
