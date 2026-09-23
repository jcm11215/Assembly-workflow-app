/**
 * Reading a drawing: file in, parts (with where they sit on the sheet)
 * and title-block fields out. No saving -- the caller decides that.
 *
 * Small, simple questions in order rather than one big call, because one
 * call doing several jobs did all of them worse and slower:
 *
 *   0  prepare     no AI -- render the sheets, hash each one
 *   1  classify    which kind of page each sheet is (multi-page only)
 *   2  line items  the parts table, and in parallel a tiny layout
 *                  question: which side is the drive end (+ title block)
 *   3  balloons    find the balloons for exactly those item numbers,
 *                  and say which end of the machine each one is at
 *   4  assemble    no AI -- whitelist, join, place, sort by location
 *
 * Each reading is stored against the pages it covered (scanStore.js), so
 * a second attempt at the same drawing asks only for what is still
 * missing. A reading that fails for a reason fewer pages would fix is
 * split and asked about each half (scanLayers.js).
 */
import { askAI } from '../lib/ai.js';
import { MAX_PDF_PAGES, fileToImageBase64Resized, pdfFileToImages, shrinkBase64Image } from './pdf.js';
import { PROMPT_VERSIONS, buildCalloutPrompt, buildLayoutPrompt, buildPageClassificationPrompt, buildPartsListPrompt, pagesByRole } from './prompt.js';
import { parseJsonLenient } from './jsonRepair.js';
import { preparePages, readQuestion } from './scanLayers.js';
import { mergeCallouts, mergeClassification, mergeLayout, mergeParts } from './scanMerge.js';
import { evictOld, forgetPages, hashContent } from './scanStore.js';
import { joinPartsAndCallouts, resolveLocations, sortByLocation } from './scanJoin.js';
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
 *  the layout reading looks at the title block most directly. */
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
 * Reads `blocks` in the steps above and assembles the result.
 * `includeJobFields` asks for the title block too (a new job).
 * Throws only when nothing at all could be read -- a scan that never
 * happened, which the person needs to see as such.
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
  const layer = (question, promptVersion, buildPrompt, instruction, merge) => ({
    question, promptVersion, buildPrompt, instruction, merge,
    call: async (system, pageBlocks, text) => {
      return (await askAI(system, [...pageBlocks, { type: 'text', text }])).text;
    },
    parse: text => parseJsonReply(text, question)
  });
  const run = async (spec, subset) => {
    const r = await readQuestion(spec, subset, tally);
    if(r.error) console.error(`${spec.question}: ${r.error.message}`);
    return r;
  };
  const parsedOf = r => (r.parsed && typeof r.parsed === 'object') ? r.parsed : {};

  // 1: which sheets each question below is shown. Pointless for one page.
  let classification = null;
  if(allPages.length > 1){
    const c = await run(layer('classify', PROMPT_VERSIONS.classify, buildPageClassificationPrompt,
      'Classify each page.', mergeClassification), pages);
    classification = c.error ? null : c.parsed;
  }
  const roles = pagesByRole(classification, allPages);
  const layoutPages = forPages([...new Set([...roles.assembly, ...roles.titles])].sort((a, b) => a - b));

  // 2: the line items, and the drive side alongside -- independent.
  const [partsPass, layoutPass] = await Promise.all([
    run(layer('parts', PROMPT_VERSIONS.parts, () => buildPartsListPrompt(includeJobFields),
      'Transcribe the parts list from these pages.', mergeParts), forPages(roles.bom)),
    run(layer('layout', PROMPT_VERSIONS.layout, () => buildLayoutPrompt(includeJobFields),
      'Which side is the drive end?', mergeLayout), layoutPages)
  ]);
  const partsParsed = parsedOf(partsPass), layoutParsed = parsedOf(layoutPass);
  const { components: tableParts, report: filterReport } = normalizeComponentsDetailed(partsParsed);
  const driveSide = (layoutParsed.orientation && layoutParsed.orientation.drive_end_side) || 'unknown';

  // 3: the balloons for exactly those items. The question depends on the
  // answers above, so they are part of its cache key.
  const items = tableParts.map(p => ({ balloon: p.balloon, item_as_drawn: p.item_as_drawn, item: p.item }));
  const calloutVersion = `${PROMPT_VERSIONS.callouts}:${hashContent(JSON.stringify([items.map(i => [i.balloon, i.item_as_drawn]), driveSide]))}`;
  const calloutPass = (tableParts.length || partsPass.error)
    ? await run(layer('callouts', calloutVersion, () => buildCalloutPrompt(items, driveSide),
        'Find these balloons on the drawn views.', mergeCallouts), forPages(roles.views))
    : { parsed: { callouts: [], unballooned: [] } };

  const readings = [partsPass, layoutPass, calloutPass];
  if(readings.every(r => r.error)){
    const err = readings[0].error;
    err.readingsAlreadySaved = readings.filter(r => r.reused).length;
    throw err;
  }

  // 4: join balloons to table rows, settle which end each part is at,
  // and sort drive end -> run -> tail end -- in code, where there is one
  // right answer.
  const { components: placed, report: joinReport } = joinPartsAndCallouts(tableParts, parsedOf(calloutPass));
  const { components: located, report: locationReport } = resolveLocations(placed, layoutParsed.orientation);
  const components = sortByLocation(located).map(({ drawn_end, ...c }) => c);

  // Nothing left to recover: "Re-scan" should read the sheet again.
  if(!readings.some(r => r.error)) forgetPages(pages.map(p => p.hash));

  return {
    components,
    titleBlock: mergeTitleBlock(layoutParsed, partsParsed),
    diagnostics: {
      ...filterReport, ...joinReport, ...locationReport,
      driveEndSide: driveSide,
      pagesRead: { bom: roles.bom, views: roles.views, total: allPages.length },
      failedReadings: readings.filter(r => r.error).map(r => ({ pass: r.error.pass || r.question || 'reading', message: r.error.message })),
      incompleteReadings: readings.filter(r => r.partial).map(r => `${r.question || 'reading'}: ${r.partial.message}`),
      repairedReadings: tally.repairs,
      requestsMade: tally.requests,
      readingsReused: tally.reused,
      timesDivided: tally.splits
    }
  };
}

/** One line for the person, saying what the scan found or why it didn't. */
export function scanSummary(components, d){
  const reused = d.readingsReused
    ? ` (${d.readingsReused} reading${d.readingsReused === 1 ? '' : 's'} carried over from the last attempt)` : '';
  if(components.length) return `Found ${components.length} part${components.length === 1 ? '' : 's'} on the drawing${reused}.`;
  const failed = d.failedReadings.map(f => f.pass);
  if(failed.includes('parts')) return `The parts list couldn't be read (${failed.join(' and ')} failed). Try again -- it often works on a second attempt.`;
  if((d.droppedNames || []).length && !d.kept){
    return `The scan found ${d.returnedByAi} items, but none are parts this app tracks (${d.droppedNames.slice(0, 3).join(', ')}…). Add what you need by hand.`;
  }
  return `The scan finished but found no parts on this drawing. Re-scanning sometimes helps; otherwise add them by hand.`;
}

/** Only worth recording when a scan came back thin or something failed. */
export function diagnosticsWorthLogging(components, d){
  return !components.length || d.failedReadings.length || (d.droppedNames || []).length
    || (d.notVisible || []).length || (d.unmatchedBalloons || []).length || (d.quantityMismatches || []).length;
}
