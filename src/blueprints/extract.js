/**
 * Blueprint -> spec extraction workflows (existing job + new job).
 *
 * Phase 8 pipeline: classify pages -> extract with page-role guidance ->
 * normalize (installation_location, never AI-assigned stage) -> combined
 * validation (spec-level + component cross-checks) -> confidence scoring
 * -> status determination -> save as a new version.
 */

import { explainFetchError } from '../ai/errors.js';
import { callClaudeAPI } from '../ai/providers.js';
import { requestRender as render } from '../app/bus.js';
import { bomListHtml } from './bom.js';
import * as blueprintsRepo from '../db/blueprintsRepo.js';
import { blueprintImageCache } from './images.js';
import { MAX_PDF_PAGES, fileToBase64Raw, fileToImageBase64Resized, parsePageSelection, pdfFileToImages, shrinkBase64Image } from './pdf.js';
import { PROMPT_VERSIONS, buildCalloutPrompt, buildPageClassificationPrompt, buildPartsListPrompt, buildSpecPrompt, pagesByRole } from './prompt.js';
import { parseJsonLenient } from './jsonRepair.js';
import { preparePages, readQuestion } from './scanLayers.js';
import { mergeCallouts, mergeClassification, mergeParts, mergeSpec } from './scanMerge.js';
import { evictOld, forgetPages } from './scanStore.js';
import { joinPartsAndCallouts, resolveLocations } from './scanJoin.js';
import {
  normalizeComponentsDetailed, normalizeSpec, validateExtraction,
  computeAggregateConfidence, determineExtractionStatus
} from './spec.js';
import { logActivity, persistJobs } from '../db/repository.js';
import { reportError } from '../monitoring/errorHandler.js';
import { openJobForm } from '../jobs/jobForm.js';
import { getSelectedBlueprintFile, state } from '../state/store.js';
import { closeModal, refreshOpenModal } from '../ui/components/modal.js';
import { showToast } from '../ui/components/toast.js';
import { escapeHtml } from '../utils/dom.js';
import { uid } from '../utils/id.js';

/**
 * Parses a pass's reply, repairing what can be repaired.
 *
 * A drawing is wall-to-wall inch and foot marks, and a model
 * transcribing 12" DIA X 20' LG into a JSON string gets the escaping
 * wrong now and then. One bad backslash used to discard the entire
 * reply -- every dimension and the title block with it -- so a
 * salvageable reply is now salvaged, and what had to be changed is
 * reported rather than passing silently. Never throws: a pass that came
 * back genuinely unreadable says why, and the scan carries on with what
 * the other passes found.
 */
function parseJsonReply(text, label){
  const { parsed, repairs, reason } = parseJsonLenient(text);
  if(repairs.length){
    console.warn(`${label}: reply needed repair before it would parse:`, repairs);
  }
  if(parsed) return { parsed, parseError: null, repairs };
  const cleaned = String(text || '').trim();
  console.error(`${label}: reply could not be salvaged --`, reason, cleaned.slice(0, 600));
  return {
    parsed: {},
    repairs,
    parseError: {
      pass: label,
      message: reason,
      repairsAttempted: repairs.length ? repairs : undefined,
      replyLength: cleaned.length,
      head: cleaned.slice(0, 200),
      tail: cleaned.slice(-200)          // a truncated reply shows up here
    }
  };
}

/**
 * The job number, customer and description, from whichever reading got
 * them.
 *
 * Both the parts and dimensions readings are asked for these, because
 * having them in only the longest and most truncation-prone reply meant
 * one bad escape character cost the job number, the customer AND the
 * description along with the dimensions -- a new job's form came up
 * blank off a drawing the scan had actually read fine. Dimensions wins
 * where it has a value, since it is looking at the title block most
 * directly; parts fills the gaps.
 */
export function mergeTitleBlock(dims, parts){
  const a = dims || {}, b = parts || {};
  const out = {};
  for(const field of ['jobNumber', 'customer', 'description', 'drawing_number']){
    const pick = [a[field], b[field]].find(v => v != null && String(v).trim() !== '');
    out[field] = pick != null ? String(pick).trim() : '';
  }
  return out;
}

/** Which sheet each image block belongs to. contentBlocksFor labels PDF
 *  pages with their real sheet number; a single uploaded image is page 1. */
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
 * Shared by both extraction entry points: images in, spec + components +
 * confidence + status decision out. No DB writes -- callers decide how
 * and when to persist.
 *
 * Four passes rather than one call, because one call did three unrelated
 * jobs at once and did all of them worse for it: sixty dimension objects,
 * a parts table, and a set of screen coordinates, in a single reply long
 * enough that a truncation came back looking like a drawing with no
 * hardware on it.
 *
 *   Layer 0  prepare    no AI -- render the sheets, hash each one
 *   Layer 1  classify   which kind of page each sheet is
 *   Layer 2  read       parts / callouts / dimensions, in parallel
 *   Layer 3  assemble   no AI -- whitelist, join, place, validate
 *
 * The layers that cost requests are 1 and 2, and each reading in them is
 * stored against the pages it covered and the wording it was asked with
 * (scanStore.js). So a second attempt at the same drawing asks only for
 * what is still missing -- usually one reading rather than four -- and
 * that holds across a reload, not just within a session.
 *
 * Layer 2's three readings do not depend on each other, so they run
 * concurrently: the scan takes about as long as its slowest reading
 * rather than the sum. Any of them that fails for a reason fewer pages
 * would fix divides its sheets and asks about each half separately
 * (scanLayers.js), so a set too big to answer in one go still comes back
 * -- and the half that worked is never asked for again.
 *
 * Layer 3 costs nothing and is always re-run: joining balloons to parts
 * and placing them on the machine are lookups with one right answer, so
 * they belong in code rather than in a prompt (scanJoin.js).
 */
async function runExtractionPipeline(contentBlocks, includeJobFields){
  evictOld();                                   // housekeeping, never awaited
  const pages = preparePages(pageOfBlocks(contentBlocks));
  const allPages = pages.map(p => p.page);
  const byNumber = new Map(pages.map(p => [p.page, p]));
  const forPages = wanted => {
    const picked = (wanted || []).map(n => byNumber.get(n)).filter(Boolean);
    return picked.length ? picked : pages;      // never ask about nothing
  };

  const tally = { reused: 0, requests: 0, splits: 0, repairs: [] };
  const layer = (question, promptVersion, buildPrompt, instruction, merge) => ({
    question, promptVersion, buildPrompt, instruction, merge,
    call: (systemPrompt, blocks, text) => callClaudeAPI(systemPrompt, [...blocks, {type:'text', text}]),
    parse: text => parseJsonReply(text, question)
  });
  const run = async (spec, subset) => {
    const r = await readQuestion(spec, subset, tally);
    if(r.error) console.error(`${spec.question}: ${r.error.message}`);
    return r;
  };

  // Layer 1. Its answer decides which sheets the readings below are
  // shown, so on a multi-sheet set it pays for itself by shrinking their
  // uploads. Skipped for a single page, where it cannot change anything:
  // every role falls back to the only page there is.
  let classification = null;
  if(allPages.length > 1){
    const c = await run(layer('classify', PROMPT_VERSIONS.classify,
      buildPageClassificationPrompt, 'Classify each page.', mergeClassification), pages);
    classification = c.error ? null : c.parsed;   // losing this costs targeting, not the scan
  }
  const roles = pagesByRole(classification, allPages);

  // Layer 2.
  const [partsPass, calloutPass, dimsPass] = await Promise.all([
    run(layer('parts', PROMPT_VERSIONS.parts,
      () => buildPartsListPrompt(includeJobFields),
      'Transcribe the parts list from these pages.', mergeParts), forPages(roles.bom)),
    run(layer('callouts', PROMPT_VERSIONS.callouts,
      buildCalloutPrompt,
      'Report every balloon callout on these views and where its leader points.', mergeCallouts), forPages(roles.views)),
    run(layer('dimensions', PROMPT_VERSIONS.dimensions,
      () => buildSpecPrompt(includeJobFields, classification),
      'Read this complete drawing set and return the engineering specification JSON.', mergeSpec), pages)
  ]);

  // Every reading failing is not a thin scan -- it is a scan that never
  // happened, and almost always one cause for all three: a rejected key,
  // no connection, or an exhausted quota. Rethrowing puts it back in
  // front of the person as "could not read the blueprint, here's why".
  // Returning nothing would open a blank job form off a drawing the AI
  // never saw, and send them hunting for a fault in the drawing.
  const readings = [partsPass, calloutPass, dimsPass];
  if(readings.every(r => r.error)){
    const err = readings[0].error;
    err.passesAlreadyRead = readings.filter(r => r.reused).map(() => 'reading');
    err.scanTally = { ...tally };
    throw err;
  }

  const parsedOf = r => (r.parsed && typeof r.parsed === 'object') ? r.parsed : {};
  const partsParsed = parsedOf(partsPass);
  const calloutParsed = parsedOf(calloutPass);
  const dimsParsed = parsedOf(dimsPass);

  // Whitelisted and normalized first, so the join only ever has to add
  // location to parts that were going to be kept anyway.
  const { components: tableParts, report: filterReport } = normalizeComponentsDetailed(partsParsed);
  const { components: placed, report: joinReport } = joinPartsAndCallouts(tableParts, calloutParsed);
  // A table row often doesn't say which end of the machine its part goes
  // on. Settled here from the part's category and, for the genuinely
  // ambiguous ones, from where its balloon sits relative to the drive end
  // -- not by asking the model, which is where drive/tail mixups came
  // from when one call did all of this at once.
  const { components, report: locationReport } =
    resolveLocations(placed, dimsParsed.orientation);

  const parsed = { ...dimsParsed, ...mergeTitleBlock(dimsParsed, partsParsed), components };

  const spec = normalizeSpec(parsed);
  const validation = spec ? validateExtraction(spec, components) : null;
  const confidence = spec ? computeAggregateConfidence(spec, components) : 0;
  const decision = spec
    ? determineExtractionStatus(confidence, validation)
    : { status:'review_required', urgency:'required', autoApproved:false, reason:'No usable specification extracted.' };

  // Nothing left to recover, so the stored readings stop being useful
  // and start being stale: "Re-Scan" has to mean read the sheet again.
  if(!readings.some(r => r.error)) forgetPages(pages.map(p => p.hash));

  return {
    parsed, spec, components, validation, confidence, decision,
    pageCount: contentBlocks.filter(b => b.type === 'image').length,
    // Why a scan came back thin: a pass that didn't parse, an AI that
    // listed nothing, a whitelist that rejected what it did list, or a
    // parts table whose numbers never met a balloon.
    diagnostics: {
      ...filterReport,
      ...joinReport,
      ...locationReport,
      pagesRead: { bom: roles.bom, views: roles.views, total: allPages.length },
      parseError: readings.filter(r => r.error)
        .map(r => ({ pass: r.error.pass || 'reading', message: r.error.message })),
      // A reply that only parsed after repair is worth seeing: it means
      // the model is mis-escaping, which is one bad character away from
      // costing a whole pass.
      repairedPasses: tally.repairs,
      // What the scan actually cost, and what it saved by not asking
      // again for readings it already had.
      requestsMade: tally.requests,
      readingsReused: tally.reused,
      timesDivided: tally.splits,
      // A reading that came back for most of its sheets but not all.
      // Without this an incomplete answer reads as a complete one, which
      // is how a drawing quietly loses a sheet's worth of parts.
      incompleteReadings: readings.filter(r => r.partial)
        .map(r => `${r.question || 'reading'}: ${r.partial.message}`),
      reusedPasses: tally.reused ? new Array(tally.reused).fill('reading') : []
    }
  };
}

async function contentBlocksFor(file, pageNumbers){
  const originalBase64 = await fileToBase64Raw(file);
  const originalFile = { base64: originalBase64, mimeType: file.type, filename: file.name };
  if(file.type === 'application/pdf'){
    // The pages picked in "Pages to scan" (default: every page, up to the
    // cap). Rendered a little smaller/softer than a single page would be
    // so a 20-sheet set stays a reasonable upload for the AI provider.
    const images = await pdfFileToImages(file, MAX_PDF_PAGES, 1600, 0.75, pageNumbers);
    if(!images.length) throw new Error('The PDF has no readable pages.');
    const thumbnail = await shrinkBase64Image(images[0].base64, images[0].mime).catch(()=>null);
    return {
      // Each image is labeled with its real sheet number, so page
      // references stay right when pages are skipped (scanning 3, 7, 12
      // would otherwise read back as pages 1, 2, 3).
      contentBlocks: images.flatMap(img=>[
        {type:'text', text:`PDF page ${img.page}:`},
        {type:'image', source:{type:'base64', media_type:img.mime, data:img.base64}}
      ]),
      originalFile, thumbnail
    };
  }
  const {base64, mime} = await fileToImageBase64Resized(file);
  const thumbnail = await shrinkBase64Image(base64, mime).catch(()=>null);
  return {
    contentBlocks: [{type:'image', source:{type:'base64', media_type:mime, data:base64}}],
    originalFile, thumbnail
  };
}

/** The PDF pages to scan, from the "Pages to scan" box on the scan screen.
 *  {pages: null} means every page -- not a PDF, or the count isn't in yet. */
function pagesToScan(file){
  if(file.type !== 'application/pdf') return { pages: null };
  const input = document.getElementById('bpPages');
  const total = Number(input && input.dataset.pageCount) || 0;
  if(!total) return { pages: null };
  return parsePageSelection(input.value, total, MAX_PDF_PAGES);
}

/**
 * Records why a scan came back thin, so "I scanned it and got nothing"
 * is answerable afterwards instead of needing a console that nobody had
 * open at the time. Only writes when there's something to explain -- a
 * clean scan that placed everything it found says nothing.
 */
function recordScanDiagnostics(jobNumber, components, d){
  if(!d) return;
  const failures = (d.parseError || []);
  const worthSaying = !components.length || failures.length
    || (d.droppedNames || []).length || (d.notVisible || []).length
    || (d.unmatchedBalloons || []).length || (d.quantityMismatches || []).length;
  if(!worthSaying) return;
  const some = list => (list && list.length) ? list : undefined;
  logActivity('Blueprint scan diagnostics', {
    jobNumber,
    passesThatFailed: some(failures.map(f => f.pass)),
    passErrors: some(failures),
    // Replies that only parsed after repair -- the model is mis-escaping,
    // which is one character away from costing a whole pass.
    passesRepaired: some(d.repairedPasses),
    pagesRead: d.pagesRead,
    partsListedByAi: d.returnedByAi,
    partsKept: d.kept,
    partsPlacedOnDrawing: d.placed,
    calloutsFound: d.calloutsFound,
    rejectedByPartsWhitelist: some(d.droppedNames),
    // What the scan cost, and what it did not have to pay twice for.
    requestsMade: d.requestsMade,
    readingsReusedFromLastTime: d.readingsReused || undefined,
    timesDividedToFit: d.timesDivided || undefined,
    sheetsNotRead: some(d.incompleteReadings),
    // Listed in the table but not drawn on a view -- normal, not a fault.
    notVisibleOnDrawing: some(d.notVisible),
    // Drawn but absent from the table: a missed row, or a misread balloon.
    balloonsWithNoTableRow: some(d.unmatchedBalloons),
    quantityDisagreements: some(d.quantityMismatches)
  }, null).catch(()=>{});
}

/**
 * What to tell them when a scan comes back with nothing.
 *
 * "Check the browser console" is not an answer on a shop floor, and the
 * three reasons for an empty scan need three different actions: a pass
 * that never completed is worth retrying, a whitelist that rejected
 * everything means the drawing lists parts we deliberately skip, and an
 * AI that listed nothing means there was nothing there to find. The
 * diagnostics already know which -- so say it.
 */
/**
 * What a retry will actually cost, for someone deciding whether to hit
 * it now or wait out a rate limit.
 */
function retryCostLine(err){
  const banked = (err && err.passesAlreadyRead) || [];
  const TOTAL = 4;                       // classify, parts, callouts, dimensions
  if(!banked.length) return '';
  const left = Math.max(1, TOTAL - banked.length);
  return ` ${banked.length} of the ${TOTAL} readings of this drawing are already saved, so trying again re-reads only the other ${left}.`;
}

function statusToast(componentCount, d){
  const reused = (d && d.reusedPasses) || [];
  const carried = reused.length
    ? ` (${reused.length} section${reused.length===1?'':'s'} carried over from the last attempt, so this retry re-read only what failed)`
    : '';
  if(componentCount > 0){
    return `Extracted ${componentCount} component${componentCount===1?'':'s'} from the drawing${carried}.`;
  }
  const failed = ((d && d.parseError) || []).map(f => f.pass);
  if(failed.includes('parts list')){
    return `The parts list couldn't be read from this drawing (${failed.join(' and ')} failed). Try the scan again -- it often works on a second attempt.`;
  }
  if(d && d.droppedNames && d.droppedNames.length && !d.kept){
    return `Scan found ${d.returnedByAi} items but none are parts we track -- ${d.droppedNames.slice(0,3).join(', ')} and similar are skipped on purpose. Add what you need by hand via Blueprint > Edit.`;
  }
  return 'Scan finished but found no parts on this drawing. Re-scanning sometimes helps; otherwise add them by hand via Blueprint > Edit.';
}

/** Re-scan an EXISTING job's blueprint. Saves directly since the job's
 *  real id is already known -- no ordering concern here. */
export async function extractComponents(jobId){
  const job = state.jobs.find(j=>j.id===jobId);
  const file = getSelectedBlueprintFile();
  if(!job || !file) return;
  const selection = pagesToScan(file);
  if(selection.error){ showToast(selection.error, 5000); return; }
  const btn = document.getElementById('bpExtractBtn');
  const resultArea = document.getElementById('bpResultArea');
  if(btn){ btn.disabled = true; btn.textContent = 'Reading blueprint...'; }
  if(resultArea) resultArea.innerHTML = `<div class="empty-state"><div class="big">&#8987;</div>Analyzing drawing...</div>`;

  try{
    const { contentBlocks, originalFile, thumbnail } = await contentBlocksFor(file, selection.pages);
    const { spec, components, validation, diagnostics } = await runExtractionPipeline(contentBlocks, false);
    recordScanDiagnostics(job.jobNumber, components, diagnostics);
    // spec/validation are used ABOVE (inside runExtractionPipeline, via
    // normalizeComponents/validateExtraction) to classify and cross-check
    // components correctly -- the drive/tail safety net depends on
    // spec.drive.location. Neither is kept past this point: no 3D model,
    // no engineering panel, no review workflow anymore, only the
    // components list and the original file survive a scan.
    void validation;

    job.billOfMaterials = components;
    job.blueprintExtractedAt = new Date().toISOString();
    await persistJobs();

    const saved = await blueprintsRepo.saveExtraction(job.id, { components, originalFile, thumbnail });
    job.hasBlueprintImage = true;
    delete blueprintImageCache[job.id];

    // Re-read the saved components so they carry their real database ids.
    // The parsed AI output has none, and without ids every edit action
    // (remove/reorder/recategorize) sends id=eq.undefined and fails.
    try {
      job.blueprintId = saved.id;
      job.billOfMaterials = await blueprintsRepo.listComponents(saved.id);
    } catch { /* keep the parsed list; ids arrive on next full reload */ }

    if(resultArea) resultArea.innerHTML = bomListHtml(job);
    if(btn){ btn.disabled = false; btn.textContent = 'Re-Extract from New Photo'; }
    logActivity('Blueprint scanned', `${job.jobNumber}: v${saved.version}, ${components.length} components`);
    showToast(statusToast(components.length, diagnostics), components.length ? 5000 : 8000);
    if(originalFile && !saved.storage_path){
      showToast('Components saved, but the original file could not be attached -- the thumbnail works, but "Open PDF" won\'t. Try Re-Scan.', 7000);
    }
    render();
    refreshOpenModal();
  }catch(err){
    console.error(err);
    const detail = explainFetchError(err) + retryCostLine(err);
    reportError('blueprint scan failed', err, { jobId, jobNumber: job && job.jobNumber });
    logActivity('Blueprint scan failed', { jobNumber: job && job.jobNumber, error: detail }, job ? {type:'job', id:job.id} : null).catch(()=>{});
    if(resultArea) resultArea.innerHTML = `<div class="empty-state"><div class="big">&#9888;</div>Could not read the blueprint.<br><span style="font-size:11px;color:var(--text-faint);">${escapeHtml(detail)}</span></div>`;
    if(btn){ btn.disabled = false; btn.textContent = 'Extract Components'; }
  }
}

/** Scan a blueprint to prefill a NEW job's form. Nothing is written to
 *  the blueprints table here -- the job doesn't have a real database id
 *  yet, and blueprints.job_id is a NOT NULL foreign key. The full
 *  extraction (including the image) is held on the prefill object and
 *  saved by jobForm.js immediately after the job itself is created,
 *  once a real id exists to attach it to. */
export async function extractNewJobFromBlueprint(){
  const file = getSelectedBlueprintFile();
  if(!file) return;
  const selection = pagesToScan(file);
  if(selection.error){ showToast(selection.error, 5000); return; }
  const btn = document.getElementById('bpExtractBtn');
  const resultArea = document.getElementById('bpResultArea');
  if(btn){ btn.disabled = true; btn.textContent = 'Reading blueprint...'; }
  if(resultArea) resultArea.innerHTML = `<div class="empty-state"><div class="big">&#8987;</div>Analyzing drawing...</div>`;

  try{
    const { contentBlocks, originalFile, thumbnail } = await contentBlocksFor(file, selection.pages);
    const { parsed, components, diagnostics } = await runExtractionPipeline(contentBlocks, true);
    recordScanDiagnostics('(new job)', components, diagnostics);
    // spec/validation (used inside runExtractionPipeline for classification
    // quality) are deliberately not kept here -- see extractComponents'
    // comment above for why.

    const prefill = {
      id: uid('job'),
      jobNumber: parsed.jobNumber ? String(parsed.jobNumber) : '',
      customer: parsed.customer ? String(parsed.customer) : '',
      description: parsed.description ? String(parsed.description) : '',
      billOfMaterials: components,
      blueprintExtractedAt: new Date().toISOString(),
      hasBlueprintImage: true,
      // Picked up by jobForm.js's submit handler once the job has a real id.
      _pendingBlueprint: { components, originalFile, thumbnail }
    };

    closeModal();
    openJobForm(null, prefill);
    showToast(components.length
      ? `Read the blueprint -- found ${components.length} components. Review and save.`
      : statusToast(0, diagnostics), components.length ? 5000 : 8000);
  }catch(err){
    console.error(err);
    const detail = explainFetchError(err) + retryCostLine(err);
    reportError('blueprint scan failed (new job)', err, {});
    logActivity('Blueprint scan failed', { jobNumber:'(new job)', error: detail }, null).catch(()=>{});
    if(resultArea) resultArea.innerHTML = `<div class="empty-state"><div class="big">&#9888;</div>Could not read the blueprint.<br><span style="font-size:11px;color:var(--text-faint);">${escapeHtml(detail)}</span></div>`;
    if(btn){ btn.disabled = false; btn.textContent = 'Read Blueprint & Create Job'; }
  }
}

/** The pipeline, for the end-to-end scan test. Production callers go
 *  through extractComponents / extractNewJobFromBlueprint, which own the
 *  file handling and the saving; this is the middle of that, exposed so
 *  a test can drive all four passes without a real File or a real key. */
export const runExtractionPipelineForTest = runExtractionPipeline;

/** The empty-scan message, for the test that pins its wording -- what it
 *  says is the whole point of it. */
export const statusToastForTest = statusToast;
