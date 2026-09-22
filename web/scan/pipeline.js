/**
 * Reading a drawing: file in, parts (with where they sit on the sheet)
 * and title-block fields out. No saving -- the caller decides that.
 *
 * Four readings rather than one call, because one call doing three
 * unrelated jobs did all of them worse, and a truncated reply looked like
 * a drawing with no hardware on it:
 *
 *   Layer 0  prepare    no AI -- render the sheets, hash each one
 *   Layer 1  classify   which kind of page each sheet is
 *   Layer 2  read       parts / callouts / dimensions, in parallel
 *   Layer 3  assemble   no AI -- whitelist, join, place, validate
 *
 * Each reading is stored against the pages it covered (scanStore.js), so
 * a second attempt at the same drawing asks only for what is still
 * missing. A reading that fails for a reason fewer pages would fix is
 * split and asked about each half (scanLayers.js).
 */
import { askAI } from '../lib/ai.js';
import { MAX_PDF_PAGES, fileToImageBase64Resized, pdfFileToImages, shrinkBase64Image } from './pdf.js';
import { PROMPT_VERSIONS, buildCalloutPrompt, buildPageClassificationPrompt, buildPartsListPrompt, buildSpecPrompt, pagesByRole } from './prompt.js';
import { parseJsonLenient } from './jsonRepair.js';
import { preparePages, readQuestion } from './scanLayers.js';
import { mergeCallouts, mergeClassification, mergeParts, mergeSpec } from './scanMerge.js';
import { evictOld, forgetPages } from './scanStore.js';
import { joinPartsAndCallouts, resolveLocations } from './scanJoin.js';
import { normalizeComponentsDetailed } from './spec.js';

/**
 * Parses a reading's reply, repairing what can be repaired -- a drawing is
 * wall-to-wall inch and foot marks, and one mis-escaped quote used to
 * throw away a whole reading. Never throws.
 */
export function parseJsonReply(text, label){
  const { parsed, repairs, reason } = parseJsonLenient(text);
  if(parsed) return { parsed, parseError: null, repairs };
  const cleaned = String(text || '').trim();
  return {
    parsed: {},
    repairs,
    parseError: {
      pass: label, message: reason,
      repairsAttempted: repairs.length ? repairs : undefined,
      replyLength: cleaned.length, head: cleaned.slice(0, 200), tail: cleaned.slice(-200)
    }
  };
}

/** Job number, customer and description from whichever reading got them;
 *  the dimensions reading looks at the title block most directly. */
export function mergeTitleBlock(dims, parts){
  const a = dims || {}, b = parts || {};
  const out = {};
  for(const field of ['jobNumber', 'customer', 'description', 'drawing_number']){
    const pick = [a[field], b[field]].find(v => v != null && String(v).trim() !== '');
    out[field] = pick != null ? String(pick).trim() : '';
  }
  return out;
}

/** Which sheet each image block belongs to. PDF pages are labelled with
 *  their real sheet number; a single uploaded image is page 1. */
export function pageOfBlocks(contentBlocks){
  const pairs = [];
  let pending = null;
  for(const b of contentBlocks){
    if(b.type === 'text'){
      const m = /PDF page (\d+)/.exec(b.text || '');
      pending = m ? { page: Number(m[1]), blocks: [b] } : null;
      continue;
    }
    if(b.type !== 'image') continue;
    if(pending){ pending.blocks.push(b); pairs.push(pending); pending = null; }
    else pairs.push({ page: pairs.length + 1, blocks: [b] });
  }
  return pairs;
}

/**
 * Renders the file into content blocks for the AI, plus a small thumbnail.
 * PDF pages are labelled with their real sheet numbers so references stay
 * right when pages are skipped; with `withText`, each page also carries
 * its selectable text (only the local AI is sent it).
 */
export async function contentFor(file, pageNumbers, { withText = false } = {}){
  if(file.type === 'application/pdf'){
    const images = await pdfFileToImages(file, MAX_PDF_PAGES, 1600, 0.75, pageNumbers, { textLayer: withText });
    if(!images.length) throw new Error('The PDF has no readable pages.');
    const thumbnail = await shrinkBase64Image(images[0].base64, images[0].mime).catch(() => null);
    return {
      thumbnail,
      blocks: images.flatMap(img => [
        { type: 'text', text: `PDF page ${img.page}:` },
        { type: 'image', source: { type: 'base64', media_type: img.mime, data: img.base64 },
          ...(img.text ? { textLayer: { page: img.page, text: img.text } } : {}) }
      ])
    };
  }
  const { base64, mime } = await fileToImageBase64Resized(file);
  const thumbnail = await shrinkBase64Image(base64, mime).catch(() => null);
  return { thumbnail, blocks: [{ type: 'image', source: { type: 'base64', media_type: mime, data: base64 } }] };
}

/**
 * Runs the four readings over `blocks` and assembles the result.
 * `includeJobFields` asks the readings for the title block too (a new job).
 * Throws only when every reading failed -- a scan that never happened,
 * which the person needs to see as such.
 */
export async function readDrawing(blocks, { includeJobFields = false } = {}){
  evictOld();
  const pages = preparePages(pageOfBlocks(blocks));
  const allPages = pages.map(p => p.page);
  const byNumber = new Map(pages.map(p => [p.page, p]));
  const forPages = wanted => {
    const picked = (wanted || []).map(n => byNumber.get(n)).filter(Boolean);
    return picked.length ? picked : pages;
  };

  const tally = { reused: 0, requests: 0, splits: 0, repairs: [] };
  const substitutions = [];
  const layer = (question, promptVersion, buildPrompt, instruction, merge) => ({
    question, promptVersion, buildPrompt, instruction, merge,
    call: async (system, pageBlocks, text) => {
      const out = await askAI(system, [...pageBlocks, { type: 'text', text }]);
      if(out.substitution) substitutions.push(out.substitution);
      return out.text;
    },
    parse: text => parseJsonReply(text, question)
  });
  const run = async (spec, subset) => {
    const r = await readQuestion(spec, subset, tally);
    if(r.error) console.error(`${spec.question}: ${r.error.message}`);
    return r;
  };

  // Layer 1: decides which sheets the readings below are shown. Pointless
  // for a single page.
  let classification = null;
  if(allPages.length > 1){
    const c = await run(layer('classify', PROMPT_VERSIONS.classify, buildPageClassificationPrompt,
      'Classify each page.', mergeClassification), pages);
    classification = c.error ? null : c.parsed;
  }
  const roles = pagesByRole(classification, allPages);

  // Layer 2: independent, so in parallel.
  const [partsPass, calloutPass, dimsPass] = await Promise.all([
    run(layer('parts', PROMPT_VERSIONS.parts, () => buildPartsListPrompt(includeJobFields),
      'Transcribe the parts list from these pages.', mergeParts), forPages(roles.bom)),
    run(layer('callouts', PROMPT_VERSIONS.callouts, buildCalloutPrompt,
      'Report every balloon callout on these views and where its leader points.', mergeCallouts), forPages(roles.views)),
    run(layer('dimensions', PROMPT_VERSIONS.dimensions, () => buildSpecPrompt(includeJobFields, classification),
      'Read this complete drawing set and return the engineering specification JSON.', mergeSpec), pages)
  ]);

  const readings = [partsPass, calloutPass, dimsPass];
  if(readings.every(r => r.error)){
    const err = readings[0].error;
    err.readingsAlreadySaved = readings.filter(r => r.reused).length;
    throw err;
  }

  const parsedOf = r => (r.parsed && typeof r.parsed === 'object') ? r.parsed : {};
  const partsParsed = parsedOf(partsPass), calloutParsed = parsedOf(calloutPass), dimsParsed = parsedOf(dimsPass);

  // Layer 3: whitelist, then join balloons to table rows, then settle
  // which end of the machine each part belongs to -- in code, where
  // there is one right answer.
  const { components: tableParts, report: filterReport } = normalizeComponentsDetailed(partsParsed);
  const { components: placed, report: joinReport } = joinPartsAndCallouts(tableParts, calloutParsed);
  const { components, report: locationReport } = resolveLocations(placed, dimsParsed.orientation);

  // Nothing left to recover: "Re-scan" should read the sheet again.
  if(!readings.some(r => r.error)) forgetPages(pages.map(p => p.hash));

  return {
    components,
    titleBlock: mergeTitleBlock(dimsParsed, partsParsed),
    diagnostics: {
      ...filterReport, ...joinReport, ...locationReport,
      pagesRead: { bom: roles.bom, views: roles.views, total: allPages.length },
      failedReadings: readings.filter(r => r.error).map(r => ({ pass: r.error.pass || r.question || 'reading', message: r.error.message })),
      incompleteReadings: readings.filter(r => r.partial).map(r => `${r.question || 'reading'}: ${r.partial.message}`),
      repairedReadings: tally.repairs,
      requestsMade: tally.requests,
      readingsReused: tally.reused,
      timesDivided: tally.splits,
      substitution: substitutions[0] || null
    }
  };
}

/** One line for the person, saying what the scan found or why it didn't. */
export function scanSummary(components, d){
  const reused = d.readingsReused
    ? ` (${d.readingsReused} reading${d.readingsReused === 1 ? '' : 's'} carried over from the last attempt)` : '';
  const sub = d.substitution ? ` Read by ${d.substitution.used}: ${d.substitution.asked} ${d.substitution.reason || 'was busy'}.` : '';
  if(components.length) return `Found ${components.length} part${components.length === 1 ? '' : 's'} on the drawing${reused}.${sub}`;
  const failed = d.failedReadings.map(f => f.pass);
  if(failed.includes('parts')) return `The parts list couldn't be read (${failed.join(' and ')} failed). Try again -- it often works on a second attempt.${sub}`;
  if((d.droppedNames || []).length && !d.kept){
    return `The scan found ${d.returnedByAi} items, but none are parts this app tracks (${d.droppedNames.slice(0, 3).join(', ')}…). Add what you need by hand.${sub}`;
  }
  return `The scan finished but found no parts on this drawing. Re-scanning sometimes helps; otherwise add them by hand.${sub}`;
}

/** Only worth recording when a scan came back thin or something failed. */
export function diagnosticsWorthLogging(components, d){
  return !components.length || d.failedReadings.length || (d.droppedNames || []).length
    || (d.notVisible || []).length || (d.unmatchedBalloons || []).length || (d.quantityMismatches || []).length;
}
