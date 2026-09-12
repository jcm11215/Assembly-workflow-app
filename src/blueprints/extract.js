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
import { buildCalloutPrompt, buildPageClassificationPrompt, buildPartsListPrompt, buildSpecPrompt, pagesByRole } from './prompt.js';
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

/** Strips fences a model adds despite being asked not to, then parses.
 *  Never throws: a pass that came back unreadable reports why and the
 *  scan carries on with what the other passes found. */
function parseJsonReply(text, label){
  const cleaned = String(text || '').trim()
    .replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
  try {
    return { parsed: JSON.parse(cleaned), parseError: null };
  } catch (e) {
    console.error(`${label}: reply did not parse as JSON`, e, cleaned.slice(0, 600));
    return {
      parsed: {},
      parseError: {
        pass: label,
        message: e.message,
        replyLength: cleaned.length,
        head: cleaned.slice(0, 200),
        tail: cleaned.slice(-200)        // a truncated reply shows up here
      }
    };
  }
}

/** One pass: prompt in, parsed JSON out. A pass that fails outright is
 *  recorded and returns {} rather than taking the whole scan down with
 *  it -- three narrow passes mean two good ones are still worth having. */
async function runPass(label, systemPrompt, blocks, instruction){
  try {
    const text = await callClaudeAPI(systemPrompt, [...blocks, {type:'text', text:instruction}]);
    return { label, ...parseJsonReply(text, label) };
  } catch (e) {
    console.error(`${label}: the call itself failed`, e);
    return { label, parsed: {}, parseError: { pass: label, message: String(e && e.message || e), failed: true } };
  }
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

/** The subset of the upload a pass needs to see. Fewer pages per pass is
 *  most of why this is both quicker and more accurate: the parts table
 *  pass isn't distracted by six view sheets, and the callout pass isn't
 *  reading a table. Falls back to everything rather than nothing when
 *  the wanted pages aren't identifiable. */
export function blocksForPages(pairs, pages){
  const want = new Set((pages || []).map(Number));
  const kept = pairs.filter(p => want.has(p.page)).flatMap(p => p.blocks);
  return kept.length ? kept : pairs.flatMap(p => p.blocks);
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
 *   1. classify  -- what kind of page is each one (cheap, and the other
 *                   passes need it to know which pages to read)
 *   2. parts     -- the parts table, off the BOM sheets \
 *   3. callouts  -- balloon numbers and positions, off  } in parallel
 *                   the drawn views                     /
 *   4. dimensions -- the engineering spec, across the set
 *
 * 2, 3 and 4 don't depend on each other, so they run concurrently: the
 * scan now takes about as long as its slowest pass instead of the sum of
 * all of them. Parts and callouts are then joined by item number in code
 * (scanJoin.js), which is the other half of the accuracy win -- the model
 * is never asked to do the matching it used to get wrong.
 */
async function runExtractionPipeline(contentBlocks, includeJobFields){
  const pairs = pageOfBlocks(contentBlocks);
  const allPages = pairs.map(p => p.page);

  // Preliminary, cheap pass: what kind of page is each one? Its answer
  // decides which pages the other three passes are shown.
  let pageClassification = null;
  try {
    const classifyText = await callClaudeAPI(buildPageClassificationPrompt(),
      [...contentBlocks, {type:'text', text:'Classify each page.'}]);
    pageClassification = parseJsonReply(classifyText, 'page classification').parsed;
  } catch (e) {
    console.error('page classification failed -- continuing without it', e);
    pageClassification = null;   // pagesByRole/buildSpecPrompt both tolerate null
  }
  const roles = pagesByRole(pageClassification, allPages);

  const [partsPass, calloutPass, dimsPass] = await Promise.all([
    runPass('parts list', buildPartsListPrompt(), blocksForPages(pairs, roles.bom),
      'Transcribe the parts list from these pages.'),
    runPass('callouts', buildCalloutPrompt(), blocksForPages(pairs, roles.views),
      'Report every balloon callout on these views and where its leader points.'),
    runPass('dimensions', buildSpecPrompt(includeJobFields, pageClassification), contentBlocks,
      'Read this complete drawing set and return the engineering specification JSON.')
  ]);

  // Whitelisted and normalized first, so the join only ever has to add
  // location to parts that were going to be kept anyway.
  const { components: tableParts, report: filterReport } = normalizeComponentsDetailed(partsPass.parsed);
  const { components: placed, report: joinReport } = joinPartsAndCallouts(tableParts, calloutPass.parsed);
  // A table row often doesn't say which end of the machine its part goes
  // on. Settled here from the part's category and, for the genuinely
  // ambiguous ones, from where its balloon sits relative to the drive end
  // -- not by asking the model, which is where drive/tail mixups came
  // from when one call did all of this at once.
  const { components, report: locationReport } =
    resolveLocations(placed, dimsPass.parsed.orientation);

  // The title-block fields live in the dimensions reply; the parts pass
  // reads the drawing number off it too, and either will do.
  const parsed = {
    ...dimsPass.parsed,
    drawing_number: dimsPass.parsed.drawing_number || partsPass.parsed.drawing_number || '',
    components
  };

  const spec = normalizeSpec(parsed);
  const validation = spec ? validateExtraction(spec, components) : null;
  const confidence = spec ? computeAggregateConfidence(spec, components) : 0;
  const decision = spec
    ? determineExtractionStatus(confidence, validation)
    : { status:'review_required', urgency:'required', autoApproved:false, reason:'No usable specification extracted.' };

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
      parseError: [partsPass, calloutPass, dimsPass].map(p => p.parseError).filter(Boolean)
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
    pagesRead: d.pagesRead,
    partsListedByAi: d.returnedByAi,
    partsKept: d.kept,
    partsPlacedOnDrawing: d.placed,
    calloutsFound: d.calloutsFound,
    rejectedByPartsWhitelist: some(d.droppedNames),
    // Listed in the table but not drawn on a view -- normal, not a fault.
    notVisibleOnDrawing: some(d.notVisible),
    // Drawn but absent from the table: a missed row, or a misread balloon.
    balloonsWithNoTableRow: some(d.unmatchedBalloons),
    quantityDisagreements: some(d.quantityMismatches)
  }, null).catch(()=>{});
}

function statusToast(componentCount){
  if(componentCount === 0){
    return 'Scan finished but found no matching components. Only drives, motors, reducers, seals, gaskets, bearings, hangers, coupling/tail/drive shafts, augers, coupling bolts and UHMW are pulled in -- check the browser console for what was skipped, or add parts by hand via Blueprint > Edit.';
  }
  return `Extracted ${componentCount} component${componentCount===1?'':'s'} from the drawing.`;
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
    showToast(statusToast(components.length), 5000);
    if(originalFile && !saved.storage_path){
      showToast('Components saved, but the original file could not be attached -- the thumbnail works, but "Open PDF" won\'t. Try Re-Scan.', 7000);
    }
    render();
    refreshOpenModal();
  }catch(err){
    console.error(err);
    const detail = explainFetchError(err);
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
      : 'Read the blueprint, but found no components -- fill in details manually.');
  }catch(err){
    console.error(err);
    const detail = explainFetchError(err);
    reportError('blueprint scan failed (new job)', err, {});
    logActivity('Blueprint scan failed', { jobNumber:'(new job)', error: detail }, null).catch(()=>{});
    if(resultArea) resultArea.innerHTML = `<div class="empty-state"><div class="big">&#9888;</div>Could not read the blueprint.<br><span style="font-size:11px;color:var(--text-faint);">${escapeHtml(detail)}</span></div>`;
    if(btn){ btn.disabled = false; btn.textContent = 'Read Blueprint & Create Job'; }
  }
}
