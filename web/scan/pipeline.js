/**
 * Reading a drawing: file in, parts (with where they sit on the sheet)
 * and title-block fields out. No saving -- the caller decides that.
 *
 * Small, simple questions in order rather than one big call, because one
 * call doing several jobs did all of them worse and slower:
 *
 *   0  prepare     no AI -- render the sheets; for a CAD-exported PDF,
 *                  index its own text: where the parts table is (then
 *                  render that table enlarged) and where every number is
 *   1  sheets      which sheet is which -- from that text when it can,
 *                  the AI only for scans and photos
 *   2  line items  the parts table, one sheet at a time, read from the
 *                  enlarged table when there is one
 *   3  layout      which side is the drive end (+ title block), from the
 *                  main view only
 *   4  balloons    the balloons for exactly the table's item numbers, one
 *                  view at a time, with where the PDF's text already
 *                  shows each number; and which end each one is at
 *   5  assemble    no AI -- whitelist, join, place, sort by location
 *
 * Each reading is stored against the pages it covered (scanStore.js), so
 * a second attempt at the same drawing asks only for what is still
 * missing. A reading that fails for a reason fewer pages would fix is
 * split and asked about each half (scanLayers.js).
 */
import { askAI } from '../lib/ai.js';
import { MAX_PDF_PAGES, fileToImageBase64Resized, imageFileToCanvas, inBox, ocrIndex, pdfFileToImages, shrinkBase64Image } from './pdf.js';
import { ocrDone } from './ocr.js';
import { PROMPT_VERSIONS, buildCalloutPrompt, buildLayoutPrompt, buildPageClassificationPrompt, buildPartsListPrompt, pagesByRole } from './prompt.js';
import { parseJsonLenient } from './jsonRepair.js';
import { preparePages, readQuestion } from './scanLayers.js';
import { mergeCallouts, mergeClassification, mergeLayout, mergeParts } from './scanMerge.js';
import { evictOld, forgetPages, hashContent } from './scanStore.js';
import { joinPartsAndCallouts, resolveLocations, sortByLocation } from './scanJoin.js';
import { normalizeComponentsDetailed } from './spec.js';
import { categorize, learnKey } from './categories.js';

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

/** Which sheet each block belongs to. A "PDF page N:" label starts a
 *  sheet, and everything after it (the sheet, its enlarged parts table)
 *  belongs to it; an unlabelled image is the next sheet. */
export function pageOfBlocks(contentBlocks){
  const pairs = [];
  let current = null;
  for(const b of contentBlocks){
    const m = b.type === 'text' && /^(?:PDF )?page (\d+)/i.exec(b.text || '');
    if(m){ current = { page: Number(m[1]), blocks: [b] }; pairs.push(current); continue; }
    if(b.type === 'image' && (!current || current.blocks.some(x => x.type === 'image' && !x.role))){
      if(b.role){ if(current) current.blocks.push(b); continue; }
      current = { page: pairs.length + 1, blocks: [b] }; pairs.push(current); continue;
    }
    if(current) current.blocks.push(b);
  }
  return pairs.filter(p => p.blocks.some(b => b.type === 'image'));
}

/** The whole sheet, without the enlarged table. */
const sheetBlocks = p => p.blocks.filter(b => !b.role);
/** For reading the parts table: the enlarged table when there is one. */
const tableBlocks = p => (p.blocks.some(b => b.role === 'bom-crop')
  ? [p.blocks[0], ...p.blocks.filter(b => b.role === 'bom-crop')] : sheetBlocks(p));
/** What the PDF's own text says about a sheet, or null for a scan/photo. */
const indexOf = p => (p.blocks.find(b => b.type === 'image' && !b.role) || {}).index || null;

/**
 * Renders the file into content blocks for the AI, plus a small thumbnail.
 * PDF pages are labelled with their real sheet numbers so references stay
 * right when pages are skipped; with `withText`, each page also carries
 * its selectable text (only the local AI is sent it).
 */
export async function contentFor(file, pageNumbers, { withText = false, ocr = true, onStatus = null } = {}){
  try {
    return await renderContent(file, pageNumbers, { withText, ocr, onStatus });
  } finally {
    ocrDone();
  }
}

async function renderContent(file, pageNumbers, { withText, ocr, onStatus }){
  if(file.type === 'application/pdf'){
    if(onStatus) onStatus('Opening the drawing…');
    const images = await pdfFileToImages(file, MAX_PDF_PAGES, 1600, 0.75, pageNumbers, { textLayer: withText, ocr, onStatus });
    if(!images.length) throw new Error('The PDF has no readable pages.');
    const thumbnail = await shrinkBase64Image(images[0].base64, images[0].mime).catch(() => null);
    return {
      thumbnail,
      blocks: images.flatMap(img => [
        { type: 'text', text: `PDF page ${img.page}:` },
        { type: 'image', source: { type: 'base64', media_type: img.mime, data: img.base64 },
          ...(img.text ? { textLayer: { page: img.page, text: img.text } } : {}),
          ...(img.index ? { index: img.index } : {}) },
        ...(img.crop ? [
          { type: 'text', role: 'bom-crop', text: `The parts table on page ${img.page}, enlarged:` },
          { type: 'image', role: 'bom-crop', source: { type: 'base64', media_type: img.crop.mime, data: img.crop.base64 },
            ...(img.crop.text ? { textLayer: { page: img.page, text: img.crop.text } } : {}) }
        ] : [])
      ])
    };
  }
  const { base64, mime } = await fileToImageBase64Resized(file);
  const thumbnail = await shrinkBase64Image(base64, mime).catch(() => null);
  // A photo has no text of its own: recognise it, so its parts table
  // and item numbers are found the same way as on a PDF.
  let index = null, crop = null;
  if(ocr){
    try {
      if(onStatus) onStatus('Reading the text on the photo…');
      ({ index, crop } = await ocrIndex(await imageFileToCanvas(file)));
    } catch (e) { console.error('text recognition failed', e); }
  }
  return {
    thumbnail,
    blocks: [
      { type: 'text', text: 'Page 1 (a photo):' },
      { type: 'image', source: { type: 'base64', media_type: mime, data: base64 }, ...(index ? { index } : {}) },
      ...(crop ? [
        { type: 'text', role: 'bom-crop', text: 'The parts table in the photo, enlarged:' },
        { type: 'image', role: 'bom-crop', source: { type: 'base64', media_type: crop.mime, data: crop.base64 } }
      ] : [])
    ]
  };
}

/**
 * Asks one question of each sheet in turn and merges the answers. One
 * sheet per request is smaller, faster and better read by a local model
 * than several at once; each sheet's answer is cached on its own.
 */
async function perSheet(spec, pages, tally, blocksFor, onStatus, label){
  const answers = [];
  for(const p of pages){
    if(onStatus) onStatus(`${label} on page ${p.page}…`);
    const r = await readQuestion(spec, [{ ...p, blocks: blocksFor(p) }], tally);
    if(r.error) console.error(`${spec.question}, page ${p.page}: ${r.error.message}`);
    answers.push(r);
  }
  const ok = answers.filter(r => !r.error);
  if(!ok.length) return { question: spec.question, parsed: null, error: (answers[0] || {}).error || null, reused: false };
  const parsed = ok.map(r => r.parsed).reduce((acc, x) => (acc ? spec.merge(acc, x) : x), null);
  const failed = answers.filter(r => r.error);
  return {
    question: spec.question, parsed, error: null,
    reused: answers.every(r => r.reused),
    ...(failed.length ? { partial: { message: `page${failed.length > 1 ? 's' : ''} ${pages.filter((p, i) => answers[i].error).map(p => p.page).join(', ')} could not be read` } } : {})
  };
}

/** Table rows read from the PDF's text, as parts-list entries. The type
 *  comes from the rules in categories.js; rows that aren't a tracked
 *  type keep their description and are dropped by the whitelist. */
export function partsFromTable(rows, page){
  return (rows || []).map(r => ({
    balloon: r.balloon, item: categorize(r.description) || r.description, item_as_drawn: r.description,
    part_number: r.part_number || '', specification: r.specification || '', quantity: r.quantity,
    installation_location: 'unknown', source_page: page, extraction_method: 'bom_table', confidence: 0.95
  }));
}

/**
 * Corrections people made to earlier scans: a description someone
 * re-typed or moved to another end is read that way from now on.
 * `learned` maps learnKey(description) -> {item?, location?}.
 */
export function applyLearned(parts, learned){
  let used = 0;
  const keys = new Set();
  const out = (parts || []).map(p => {
    const key = p && p.item_as_drawn ? learnKey(p.item_as_drawn) : '';
    const hit = learned && key ? learned.get(key) : null;
    if(!hit) return p;
    used++;
    keys.add(key);
    return { ...p, ...(hit.item ? { item: hit.item } : {}), ...(hit.location ? { installation_location: hit.location } : {}), learned: true };
  });
  return { parts: out, used, keys: [...keys] };
}

/** "3 at (0.86, 0.41)" hints: where the table's item numbers appear on a
 *  sheet in the PDF's own text, outside the table itself. */
function balloonHints(page, itemNumbers){
  const idx = indexOf(page);
  if(!idx) return [];
  return idx.numbers.filter(n => itemNumbers.has(n.n) && !inBox(n, idx.bomBox));
}

/**
 * Reads `blocks` in the steps above and assembles the result.
 * `includeJobFields` asks for the title block too (a new job).
 * Throws only when nothing at all could be read -- a scan that never
 * happened, which the person needs to see as such.
 */
export async function readDrawing(blocks, { includeJobFields = false, learned = null, onStatus = () => {} } = {}){
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
      const clean = pageBlocks.map(({ index, role, ...b }) => b);
      return (await askAI(system, [...clean, { type: 'text', text }])).text;
    },
    parse: text => parseJsonReply(text, question)
  });
  const parsedOf = r => (r && r.parsed && typeof r.parsed === 'object') ? r.parsed : {};

  // 1: which sheet is which. A CAD export's own text finds the parts
  // table with no AI at all; only a scan or photo set needs asking.
  const tablePages = pages.filter(p => indexOf(p) && indexOf(p).bomBox).map(p => p.page);
  const allHaveText = pages.every(p => indexOf(p));
  let classification = null, classifiedBy = 'none';
  if(allPages.length > 1 && !(allHaveText && tablePages.length)){
    onStatus('Sorting out which sheet is which…');
    const c = await readQuestion(layer('classify', PROMPT_VERSIONS.classify, buildPageClassificationPrompt,
      'Classify each page.', mergeClassification), pages.map(p => ({ ...p, blocks: sheetBlocks(p) })), tally);
    classification = c.error ? null : c.parsed;
    classifiedBy = classification ? 'ai' : 'none';
  } else if(tablePages.length) classifiedBy = 'text';
  const roles = pagesByRole(classification, allPages);
  const bomPages = tablePages.length ? tablePages : roles.bom;

  // 2: the line items. A table the PDF's text spelled out cleanly is
  // read from that text -- no AI; any other table sheet is asked about
  // one at a time, from its enlarged crop when there is one.
  const textTables = forPages(bomPages).filter(p => indexOf(p) && indexOf(p).table);
  const fromText = textTables.flatMap(p => partsFromTable(indexOf(p).table, p.page));
  const askPages = forPages(bomPages).filter(p => !textTables.includes(p));
  const partsPass = askPages.length
    ? await perSheet(layer('parts', PROMPT_VERSIONS.parts, () => buildPartsListPrompt(includeJobFields),
        'Transcribe the parts list from this page.', mergeParts), askPages, tally, tableBlocks, onStatus, 'Reading the parts table')
    : { question: 'parts', parsed: { parts: [] }, error: null };
  const partsParsed = parsedOf(partsPass);
  const { parts: withLearning, used: learnedUsed, keys: learnedKeys } = applyLearned([...fromText, ...(partsParsed.parts || [])], learned);
  const { components: tableParts, report: filterReport } = normalizeComponentsDetailed({ parts: withLearning });
  const itemNumbers = new Set(tableParts.map(p => Number(p.balloon)).filter(n => Number.isFinite(n)));

  // Which sheets show the assembly: with the PDF's text, the ones where
  // the table's item numbers appear outside the table; otherwise the
  // classification's drawn views.
  const hinted = pages.filter(p => balloonHints(p, itemNumbers).length);
  const viewPages = hinted.length
    ? hinted.sort((a, b) => balloonHints(b, itemNumbers).length - balloonHints(a, itemNumbers).length)
    : forPages(roles.views);

  // 3: which side is the drive end, from the main view -- one sheet,
  // a few words each way.
  const mainView = viewPages[0] || pages[0];
  onStatus('Finding the drive end…');
  const layoutPass = await readQuestion(layer('layout', PROMPT_VERSIONS.layout, () => buildLayoutPrompt(includeJobFields),
    'Which side is the drive end?', mergeLayout), [{ ...mainView, blocks: sheetBlocks(mainView) }], tally);
  if(layoutPass.error) console.error(`layout: ${layoutPass.error.message}`);
  const layoutParsed = parsedOf(layoutPass);
  const driveSide = (layoutParsed.orientation && layoutParsed.orientation.drive_end_side) || 'unknown';

  // 4: the balloons for exactly those items, one view at a time, with
  // where the PDF's text already shows each number as a starting point.
  const items = tableParts.map(p => ({ balloon: p.balloon, item_as_drawn: p.item_as_drawn, item: p.item, quantity: p.quantity }));
  const calloutVersion = `${PROMPT_VERSIONS.callouts}:${hashContent(JSON.stringify([items.map(i => [i.balloon, i.item_as_drawn, i.quantity]), driveSide]))}`;
  const withHints = p => {
    const hints = balloonHints(p, itemNumbers);
    if(!hints.length) return sheetBlocks(p);
    const where = hints.slice(0, 60).map(h => `${h.n} at (${h.x.toFixed(2)}, ${h.y.toFixed(2)})`).join('; ');
    return [...sheetBlocks(p), { type: 'text', text: `The PDF's own text shows these item numbers on page ${p.page} (x, y as fractions of the page) -- likely balloons, but some may be dimensions or notes: ${where}.` }];
  };
  const calloutPass = (tableParts.length || partsPass.error)
    ? await perSheet(layer('callouts', calloutVersion, () => buildCalloutPrompt(items, driveSide),
        'Find these balloons on this page.', mergeCallouts), viewPages, tally, withHints, onStatus, 'Finding the balloons')
    : { parsed: { callouts: [], unballooned: [] } };

  const readings = [partsPass, layoutPass, calloutPass];
  if(readings.every(r => r.error)){
    const err = readings[0].error || readings.find(r => r.error).error;
    err.readingsAlreadySaved = readings.filter(r => r.reused).length;
    throw err;
  }

  // 5: join balloons to table rows, settle which end each part is at,
  // and sort drive end -> tail end -> the run -- in code, where there is
  // one right answer.
  const { components: placed, report: joinReport } = joinPartsAndCallouts(tableParts, parsedOf(calloutPass));
  const { components: located, report: locationReport } = resolveLocations(placed, layoutParsed.orientation);
  const components = sortByLocation(located).map(({ drawn_end, ...c }) => c);

  // Nothing left to recover: "Re-scan" should read the sheet again.
  if(!readings.some(r => r.error || r.partial)) forgetPages(pages.map(p => p.hash));

  return {
    components,
    titleBlock: mergeTitleBlock(layoutParsed, partsParsed),
    diagnostics: {
      ...filterReport, ...joinReport, ...locationReport,
      driveEndSide: driveSide,
      pagesRead: { bom: bomPages, views: viewPages.map(p => p.page), total: allPages.length },
      sheetsFoundBy: classifiedBy,
      tablesReadFromText: textTables.map(p => p.page),
      tablesEnlarged: tablePages.filter(n => !textTables.some(p => p.page === n)),
      correctionsApplied: learnedUsed,
      learnedKeys,
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
