/**
 * Runs one reading of a drawing, over a set of pages, and divides it
 * when that is what the failure calls for.
 *
 * THE UNIT OF WORK is a question asked of a group of pages: "read the
 * parts table off sheets 2 and 3". Asking once about the whole group is
 * the cheapest way to get an answer -- one request -- and requests are
 * the scarce thing, since the free tier caps them per minute. So that is
 * always the first attempt.
 *
 * WHEN IT FAILS, the right response depends on why:
 *
 *   - Out of quota. Splitting makes this strictly worse: two requests
 *     against the cap that just refused one. The provider layer already
 *     waits the exact delay the server asked for and retries, so by the
 *     time a quota error arrives here, waiting has been tried. It is
 *     passed up.
 *
 *   - Too much to answer at once -- a truncated reply, a payload the
 *     provider refused, a model that fell over on ten sheets. Splitting
 *     is the actual fix: half the pages is half the output, and two
 *     smaller answers beat one that got cut off mid-part. So the group
 *     is halved and each half asked separately.
 *
 *   - A rejected key, a missing model. Nothing about the pages is the
 *     problem; splitting just burns requests. Passed up.
 *
 * Every answer that lands is stored against the pages it covered, so a
 * later attempt asks only about what is still missing. A group that had
 * to be split leaves behind two cached halves, and the half that worked
 * never needs asking again -- which is why a second attempt at a
 * difficult drawing is faster than the first, not the same.
 */
import { hashContent, layerKey, readLayer, writeLayer } from './scanStore.js';

/**
 * Failures that fewer pages would fix.
 *
 * Deliberately narrow. Splitting doubles the request count, so it has to
 * be reserved for the cases where it genuinely helps; anything not
 * listed here is passed up rather than retried at twice the cost.
 */
export function isSplittableFailure(message){
  return /truncat|too (long|large|many)|exceed(s|ed)? (the )?(maximum|context|token)|payload|request entity|413|context length|output limit|prompt is too long|did not parse|unexpected end/i
    .test(message || '');
}

/** Failures where waiting, not splitting, is the answer. */
export function isQuotaFailure(message){
  return /quota|rate.?limit|RESOURCE_EXHAUSTED|429|too many requests/i.test(message || '');
}

/** One page: its real sheet number, its content blocks, and the hash
 *  that decides whether a stored answer belongs to it. */
export function preparePages(pairs){
  return pairs.map(p => ({
    page: p.page,
    blocks: p.blocks,
    hash: hashContent(p.blocks.filter(b => b.type === 'image')
      .map(b => (b.source && b.source.data) || '').join('|'))
  }));
}

/** Split a group as evenly as possible. Halving rather than going
 *  straight to single pages keeps the request count logarithmic in the
 *  number of sheets instead of linear. */
function halve(pages){
  const mid = Math.ceil(pages.length / 2);
  return [pages.slice(0, mid), pages.slice(mid)];
}

/**
 * Reads one question over one group of pages, dividing on failure.
 *
 * @param spec.question       short name, part of the cache key
 * @param spec.promptVersion  bumped when the wording changes, so a
 *                            reworded question never reads back answers
 *                            to the old one
 * @param spec.buildPrompt    () => system prompt
 * @param spec.instruction    the user-turn instruction
 * @param spec.merge          (a, b) => combined, for joining the answers
 *                            from two halves back into one
 * @param spec.call           (systemPrompt, blocks, instruction) => text
 * @param spec.parse          text => {parsed, parseError, repairs}
 * @param pages               [{page, blocks, hash}]
 * @returns {{parsed, error, repairs, reused, splits, requests}}
 */
export async function readQuestion(spec, pages, state){
  const acc = state || { reused: 0, requests: 0, splits: 0, repairs: [] };
  if(!pages.length) return { question: spec.question, parsed: null, error: null, ...acc };

  const key = layerKey(spec.question, spec.promptVersion, pages.map(p => p.hash));

  const cached = await readLayer(key);
  if(cached !== undefined){
    acc.reused++;
    return { question: spec.question, parsed: cached, error: null, ...acc };
  }

  const blocks = pages.flatMap(p => p.blocks);
  let text, callError = null;
  try {
    acc.requests++;
    text = await spec.call(spec.buildPrompt(), blocks, spec.instruction);
  } catch (e) {
    callError = e;
  }

  if(!callError){
    const { parsed, parseError, repairs } = spec.parse(text);
    if(repairs && repairs.length) acc.repairs.push(`${spec.question}: ${repairs.join('; ')}`);
    if(!parseError){
      writeLayer(key, parsed, { question: spec.question, pages: pages.map(p => p.page) });
      return { question: spec.question, parsed, error: null, ...acc };
    }
    callError = Object.assign(new Error(parseError.message), { parseError });
  }

  const message = String(callError && callError.message || callError);
  const canSplit = pages.length > 1
    && !isQuotaFailure(message)
    && (isSplittableFailure(message) || !!callError.parseError);

  if(!canSplit) return { question: spec.question, parsed: null, error: callError, ...acc };

  // Half the pages is half the output. Each half caches on its own, so
  // whichever one works is never asked for again.
  acc.splits++;
  const [left, right] = halve(pages);
  const a = await readQuestion(spec, left, acc);
  const b = await readQuestion(spec, right, acc);

  if(a.error && b.error) return { question: spec.question, parsed: null, error: a.error, ...acc };

  const parsed = a.error ? b.parsed
               : b.error ? a.parsed
               : spec.merge(a.parsed, b.parsed);

  // Store the rejoined answer under the WHOLE group's key as well as the
  // halves'. Without this, a second look at the same drawing asks about
  // the full group again, fails the same way again, and only then finds
  // the halves -- paying for the discovery every time. With it, a
  // divided reading is divided once, ever.
  writeLayer(key, parsed, { question: spec.question, pages: pages.map(p => p.page), divided: true });

  // A page that could not be read however it was asked has to be
  // reported, or a partial answer reads as a complete one -- which is
  // how a drawing quietly loses a sheet's worth of parts.
  const partial = a.error || b.error || a.partial || b.partial || null;
  return { question: spec.question, parsed, error: null, ...(partial ? { partial } : {}), ...acc };
}
