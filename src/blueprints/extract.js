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
import { fileToBase64Raw, fileToImageBase64Resized, pdfFileToImages, shrinkBase64Image } from './pdf.js';
import { buildPageClassificationPrompt, buildSpecPrompt } from './prompt.js';
import {
  normalizeComponents, normalizeSpec, validateExtraction,
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

  let parsed = {};
  try { parsed = JSON.parse(text); } catch (e) { parsed = {}; }

  const components = normalizeComponents(parsed);
  const spec = normalizeSpec(parsed);
  const validation = spec ? validateExtraction(spec, components) : null;
  const confidence = spec ? computeAggregateConfidence(spec, components) : 0;
  const decision = spec
    ? determineExtractionStatus(confidence, validation)
    : { status:'review_required', urgency:'required', autoApproved:false, reason:'No usable specification extracted.' };

  return {
    parsed, spec, components, validation, confidence, decision,
    pageCount: contentBlocks.filter(b => b.type === 'image').length
  };
}

async function contentBlocksFor(file){
  const originalBase64 = await fileToBase64Raw(file);
  const originalFile = { base64: originalBase64, mimeType: file.type, filename: file.name };
  if(file.type === 'application/pdf'){
    const images = await pdfFileToImages(file, 1);   // page 1 only, for the AI call
    if(!images.length) throw new Error('The PDF has no readable pages.');
    const thumbnail = await shrinkBase64Image(images[0].base64, images[0].mime).catch(()=>null);
    return {
      contentBlocks: images.map(img=>({type:'image', source:{type:'base64', media_type:img.mime, data:img.base64}})),
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

function statusToast(componentCount){
  if(componentCount === 0){
    return 'Scan finished but found no matching components. Only seals, bearings, shafts, augers, motors and reducers are pulled in -- check the browser console for what was skipped, or add parts by hand via Blueprint > Edit.';
  }
  return `Extracted ${componentCount} component${componentCount===1?'':'s'} from the drawing.`;
}

/** Re-scan an EXISTING job's blueprint. Saves directly since the job's
 *  real id is already known -- no ordering concern here. */
export async function extractComponents(jobId){
  const job = state.jobs.find(j=>j.id===jobId);
  const file = getSelectedBlueprintFile();
  if(!job || !file) return;
  const btn = document.getElementById('bpExtractBtn');
  const resultArea = document.getElementById('bpResultArea');
  if(btn){ btn.disabled = true; btn.textContent = 'Reading blueprint...'; }
  if(resultArea) resultArea.innerHTML = `<div class="empty-state"><div class="big">&#8987;</div>Analyzing drawing...</div>`;

  try{
    const { contentBlocks, originalFile, thumbnail } = await contentBlocksFor(file);
    const { spec, components, validation } = await runExtractionPipeline(contentBlocks, false);
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
  const btn = document.getElementById('bpExtractBtn');
  const resultArea = document.getElementById('bpResultArea');
  if(btn){ btn.disabled = true; btn.textContent = 'Reading blueprint...'; }
  if(resultArea) resultArea.innerHTML = `<div class="empty-state"><div class="big">&#8987;</div>Analyzing drawing...</div>`;

  try{
    const { contentBlocks, originalFile, thumbnail } = await contentBlocksFor(file);
    const { parsed, components } = await runExtractionPipeline(contentBlocks, true);
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
