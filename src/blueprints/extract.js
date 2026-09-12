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
import { buildPageClassificationPrompt, buildSpecPrompt } from './prompt.js';
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

/** Shared by both extraction entry points: images in, classification +
 *  spec + components + confidence + status decision out. No DB writes --
 *  callers decide how and when to persist. */
async function runExtractionPipeline(contentBlocks, includeJobFields){
  // Preliminary, cheap pass: what kind of page is each one? Its only
  // purpose is to make the main prompt's instructions page-role-aware.
  let pageClassification = null;
  try {
    const classifyContent = [...contentBlocks, {type:'text', text:'Classify each page.'}];
    let classifyText = await callClaudeAPI(buildPageClassificationPrompt(), classifyContent);
    classifyText = classifyText.trim().replace(/^```json/i,'').replace(/^```/,'').replace(/```$/,'').trim();
    pageClassification = JSON.parse(classifyText);
  } catch (e) {
    console.error('page classification failed -- continuing without it', e);
    pageClassification = null;   // buildSpecPrompt tolerates null; just loses the page-guide block
  }

  const systemPrompt = buildSpecPrompt(includeJobFields, pageClassification);
  const content = [...contentBlocks, {type:'text', text:'Read this complete drawing set and return the unified engineering specification JSON.'}];
  let text = await callClaudeAPI(systemPrompt, content);
  text = text.trim().replace(/^```json/i,'').replace(/^```/,'').replace(/```$/,'').trim();

  // A parse failure used to be swallowed here, which made a truncated or
  // fenced-wrong reply indistinguishable from a drawing with no hardware
  // on it: zero components, no error, nothing recorded. Keep going -- a
  // half-readable extraction still beats refusing outright -- but carry
  // the reason out so the caller can record it.
  let parsed = {}, parseError = null;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    parsed = {};
    parseError = {
      message: e.message,
      replyLength: text.length,
      head: text.slice(0, 200),
      tail: text.slice(-200)          // truncation shows up here
    };
    console.error('extraction JSON did not parse', e, text.slice(0, 600));
  }

  const { components, report } = normalizeComponentsDetailed(parsed);
  const spec = normalizeSpec(parsed);
  const validation = spec ? validateExtraction(spec, components) : null;
  const confidence = spec ? computeAggregateConfidence(spec, components) : 0;
  const decision = spec
    ? determineExtractionStatus(confidence, validation)
    : { status:'review_required', urgency:'required', autoApproved:false, reason:'No usable specification extracted.' };

  return {
    parsed, spec, components, validation, confidence, decision,
    pageCount: contentBlocks.filter(b => b.type === 'image').length,
    // Why a scan came back with nothing: the reply didn't parse, the AI
    // listed no parts, or the whitelist rejected the ones it listed.
    diagnostics: { ...report, parseError }
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
 * open at the time. Only writes when there's something to explain --
 * a clean scan that kept everything it found says nothing.
 */
function recordScanDiagnostics(jobNumber, components, diagnostics){
  if(!diagnostics) return;
  const { parseError, returnedByAi, kept, positioned, droppedNames } = diagnostics;
  if(components.length && !droppedNames.length && !parseError) return;
  logActivity('Blueprint scan diagnostics', {
    jobNumber,
    reply: parseError ? 'did not parse as JSON' : 'parsed',
    parseError: parseError || undefined,
    partsListedByAi: returnedByAi,
    partsKept: kept,
    partsWithALocation: positioned,
    rejectedByPartsWhitelist: droppedNames.length ? droppedNames : undefined
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
