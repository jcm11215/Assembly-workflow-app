// Dividing a reading when that is what the failure calls for, and
// keeping every answer that lands.
//
// A scan is several independent readings of the same sheets. Asking once
// about a whole group is the cheapest way to get an answer, so that is
// always the first try. What happens NEXT is the design: a quota failure
// must not split (two requests against the cap that just refused one),
// while a reply too big to finish must split, because half the pages is
// half the output. Either way, whatever succeeded is kept.
import './stub.mjs';
const layers = await import('../src/blueprints/scanLayers.js');
const { clearMemoryLayers, hashContent, layerKey } = await import('../src/blueprints/scanStore.js');
const { mergeParts, mergeSpec, mergeCallouts } = await import('../src/blueprints/scanMerge.js');

let pass = 0, fail = 0;
const t = async (n, fn) => {
  try { await fn(); pass++; console.log('  PASS ' + n); }
  catch (e) { fail++; console.log('  FAIL ' + n + ' -> ' + e.constructor.name + ': ' + e.message); }
};
const eq = (a, b, what) => { if (a !== b) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const page = n => ({ page: n, hash: 'h' + n,
  blocks: [{ type: 'text', text: `PDF page ${n}:` },
           { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'D'.repeat(20) + n }}] });

/** A reading whose behaviour per page-group the test dictates. */
function spec(behaviour, asked){
  return {
    question: 'parts', promptVersion: 1,
    buildPrompt: () => 'sys', instruction: 'go', merge: mergeParts,
    call: async (_s, blocks) => {
      const nums = blocks.filter(b => b.type === 'text')
        .map(b => /PDF page (\d+)/.exec(b.text)).filter(Boolean).map(m => Number(m[1]));
      asked.push(nums.join('+'));
      const outcome = behaviour(nums);
      if (outcome instanceof Error) throw outcome;
      return JSON.stringify(outcome);
    },
    parse: text => {
      try { return { parsed: JSON.parse(text), parseError: null, repairs: [] }; }
      catch (e) { return { parsed: {}, parseError: { message: e.message }, repairs: [] }; }
    }
  };
}

console.log('=== which failures are worth dividing ===');
await t('a reply that ran out of room is worth dividing', () => {
  if (!layers.isSplittableFailure('exceeded the maximum output tokens')) throw new Error('should split');
  if (!layers.isSplittableFailure('Request entity too large')) throw new Error('should split');
  if (!layers.isSplittableFailure('the reply was truncated')) throw new Error('should split');
});
await t('a quota is NOT worth dividing -- that doubles the requests', () => {
  for (const m of ['Quota exceeded for metric', 'RESOURCE_EXHAUSTED', 'HTTP 429', 'rate limit']) {
    if (!layers.isQuotaFailure(m)) throw new Error('not recognised as quota: ' + m);
    if (layers.isSplittableFailure(m)) throw new Error('would have split a quota failure: ' + m);
  }
});
await t('a rejected key is not worth dividing either', () => {
  if (layers.isSplittableFailure('API key not valid')) throw new Error('would have split a bad key');
});

console.log('\n=== one request when one request works ===');
clearMemoryLayers();
let asked = [];
const ok = await layers.readQuestion(spec(() => ({ parts: [{ item: 'Motor' }] }), asked),
  [page(1), page(2), page(3)]);
await t('asks about the whole group once', () => {
  eq(asked.join(' | '), '1+2+3', 'calls');
  eq(ok.requests, 1, 'requests');
  eq(ok.splits, 0, 'splits');
});

console.log('\n=== dividing a reading that could not finish ===');
clearMemoryLayers();
asked = [];
// Pages 1-4 together overflow; any two of them are fine.
const divided = await layers.readQuestion(
  spec(nums => nums.length > 2
    ? new Error('exceeded the maximum output tokens')
    : ({ parts: nums.map(n => ({ item: 'Part' + n })) }), asked),
  [page(1), page(2), page(3), page(4)]);

await t('splits until each half can answer', () => {
  eq(asked.join(' | '), '1+2+3+4 | 1+2 | 3+4', 'calls');
  eq(divided.splits, 1, 'splits');
});
await t('and rejoins the halves into one answer', () => {
  eq(divided.parsed.parts.map(p => p.item).join(), 'Part1,Part2,Part3,Part4', 'parts');
  if (divided.error) throw new Error('should have succeeded: ' + divided.error.message);
});

console.log('\n=== the half that worked is never asked for again ===');
asked = [];
const again = await layers.readQuestion(
  spec(nums => nums.length > 2 ? new Error('exceeded the maximum output tokens')
                               : ({ parts: nums.map(n => ({ item: 'Part' + n })) }), asked),
  [page(1), page(2), page(3), page(4)]);
await t('a repeat of the same drawing costs nothing at all', () => {
  eq(asked.length, 0, 'calls -- ' + JSON.stringify(asked));
  eq(again.requests, 0, 'requests');
  eq(again.reused, 1, 'readings reused');
  eq(again.parsed.parts.length, 4, 'still the full answer');
});

console.log('\n=== a page that cannot be read on its own ===');
clearMemoryLayers();
asked = [];
// Page 3 is broken however it is asked; the rest are fine.
const partial = await layers.readQuestion(
  spec(nums => nums.includes(3)
    ? new Error('exceeded the maximum output tokens')
    : ({ parts: nums.map(n => ({ item: 'Part' + n })) }), asked),
  [page(1), page(2), page(3), page(4)]);
await t('the bad page is isolated and the rest still come back', () => {
  const got = (partial.parsed && partial.parsed.parts || []).map(p => p.item);
  if (!got.includes('Part1') || !got.includes('Part2')) throw new Error('lost good pages: ' + got);
  if (got.includes('Part3')) throw new Error('claimed to read the unreadable page');
  if (!partial.partial) throw new Error('did not report that part of it failed');
});
await t('and it stopped dividing rather than recursing forever', () => {
  if (partial.splits > 4) throw new Error('divided too far: ' + partial.splits);
});

console.log('\n=== a quota failure waits instead of dividing ===');
clearMemoryLayers();
asked = [];
const quota = await layers.readQuestion(
  spec(() => new Error('Quota exceeded for metric generate_content_free_tier_requests'), asked),
  [page(1), page(2), page(3), page(4)]);
await t('asks once and gives up, rather than asking twice as often', () => {
  eq(asked.join(' | '), '1+2+3+4', 'calls');
  eq(quota.splits, 0, 'splits');
  if (!quota.error) throw new Error('should have reported the failure');
});

console.log('\n=== the cache key ===');
await t('a different page means a different key', () => {
  if (layerKey('parts', 1, ['h1']) === layerKey('parts', 1, ['h2'])) throw new Error('collision');
});
await t('a reworded question means a different key', () => {
  // Otherwise a stored answer would be served against a question nobody
  // asked any more -- stale, invisible, and confident.
  if (layerKey('parts', 1, ['h1']) === layerKey('parts', 2, ['h1'])) throw new Error('collision');
});
await t('a different question on the same page means a different key', () => {
  if (layerKey('parts', 1, ['h1']) === layerKey('callouts', 1, ['h1'])) throw new Error('collision');
});
await t('hashing is stable, and sensitive to a change anywhere in the page', () => {
  eq(hashContent('abc'), hashContent('abc'), 'stable');
  if (hashContent('a'.repeat(999) + 'X') === hashContent('a'.repeat(999) + 'Y')) {
    throw new Error('a change late in a page did not change its hash');
  }
  if (hashContent('ab') === hashContent('ba')) throw new Error('order-insensitive');
});

console.log('\n=== rejoining halves ===');
await t('parts lists concatenate and the title block survives', () => {
  const m = mergeParts({ parts: [{ item: 'A' }], jobNumber: '2024-017H' }, { parts: [{ item: 'B' }] });
  eq(m.parts.map(p => p.item).join(), 'A,B', 'parts');
  eq(m.jobNumber, '2024-017H', 'the half that saw the title block wins');
});
await t('callouts and unballooned both concatenate', () => {
  const m = mergeCallouts({ callouts: [1], unballooned: [2] }, { callouts: [3], unballooned: [4] });
  eq(m.callouts.join(), '1,3', 'callouts');
  eq(m.unballooned.join(), '2,4', 'unballooned');
});
await t('a dimension that was read beats one reported as absent', () => {
  // The half that never saw the sheet has nothing to say about it, and
  // its silence must not overwrite the half that did.
  const found = { value: 20, unit: 'ft', status: 'ok' };
  const absent = { value: null, confidence: 0, status: 'not_found' };
  eq(mergeSpec({ overall: { overall_length: found } }, { overall: { overall_length: absent } })
      .overall.overall_length.value, 20, 'found survives a later not_found');
  eq(mergeSpec({ overall: { overall_length: absent } }, { overall: { overall_length: found } })
      .overall.overall_length.value, 20, 'and is picked up from either side');
});
await t('two halves reading different values record a conflict rather than picking one', () => {
  const m = mergeSpec(
    { overall: { overall_length: { value: 20, unit: 'ft', status: 'ok' } } },
    { overall: { overall_length: { value: 24, unit: 'ft', status: 'ok' } } });
  if (!m.conflicts.length) throw new Error('silently picked a winner');
  if (!/20 ft vs 24 ft/.test(m.conflicts[0].detail)) throw new Error('conflict does not say what disagreed');
});
await t('an orientation of "unknown" never overwrites a real one', () => {
  const m = mergeSpec({ orientation: { drive_end_side: 'right' } },
                      { orientation: { drive_end_side: 'unknown' } });
  eq(m.orientation.drive_end_side, 'right', 'orientation');
});

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
