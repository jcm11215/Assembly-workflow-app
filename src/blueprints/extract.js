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
import { fileToImageBase64Resized, pdfFileToImages } from './pdf.js';
import { buildPageClassificationPrompt, buildSpecPrompt } from './prompt.js';
import {
  normalizeComponents, normalizeSpec, validateExtraction,
  computeAggregateConfidence, determineExtractionStatus
} from './spec.js';
import { logActivity, persistJobs } from '../db/repository.js';
import { reportError } from '../monitoring/errorHandler.js';
import { openJobForm } from '../jobs/jobForm.js';
import { specToLegacyGeometry } from '../models/geometry.js';
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
  if(file.type === 'application/pdf'){
    const images = await pdfFileToImages(file);
    if(!images.length) throw new Error('The PDF has no readable pages.');
    return {
      contentBlocks: images.map(img=>({type:'image', source:{type:'base64', media_type:img.mime, data:img.base64}})),
      primaryImageBase64: images[0].base64
    };
  }
  const {base64, mime} = await fileToImageBase64Resized(file);
  return {
    contentBlocks: [{type:'image', source:{type:'base64', media_type:mime, data:base64}}],
    primaryImageBase64: base64
  };
}

function statusToast(decision, componentCount){
  if(decision.autoApproved){
    return `Extracted and auto-approved (${componentCount} components, ${decision.reason.match(/[\d.]+/)?.[0]||''} confidence).`;
  }
  if(decision.urgency === 'suggested'){
    return `Extracted ${componentCount} components -- review suggested before use.`;
  }
  return `Extracted ${componentCount} components -- review required before use.`;
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
    const { contentBlocks, primaryImageBase64 } = await contentBlocksFor(file);
    const { spec, components, validation, confidence, decision, pageCount } =
      await runExtractionPipeline(contentBlocks, false);

    // Deterministic: a scan always fully defines these three fields. No
    // fallback to a prior value -- a stale geometry paired with a fresh
    // spec is a worse state than no geometry at all.
    job.spec = spec;
    job.validation = validation;
    job.geometry = spec ? specToLegacyGeometry(spec) : null;
    job.billOfMaterials = components;
    job.blueprintExtractedAt = new Date().toISOString();
    await persistJobs();

    const saved = await blueprintsRepo.saveExtraction(job.id, {
      spec, validation, components, imageBase64: primaryImageBase64, pageCount,
      status: decision.status, confidence, urgency: decision.urgency,
      autoApproved: decision.autoApproved, reason: decision.reason
    });
    job.hasBlueprintImage = true;
    delete blueprintImageCache[job.id];

    if(resultArea) resultArea.innerHTML = bomListHtml(job);
    if(btn){ btn.disabled = false; btn.textContent = 'Re-Extract from New Photo'; }
    logActivity('Blueprint scanned',
      `${job.jobNumber}: v${saved.version}, ${components.length} components, ${decision.status}` +
      (decision.autoApproved ? ' (auto-approved)' : ''));
    showToast(statusToast(decision, components.length), 5000);
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
    const { contentBlocks, primaryImageBase64 } = await contentBlocksFor(file);
    const { parsed, spec, components, validation, confidence, decision, pageCount } =
      await runExtractionPipeline(contentBlocks, true);
    const geometry = spec ? specToLegacyGeometry(spec) : null;

    const prefill = {
      id: uid('job'),
      jobNumber: parsed.jobNumber ? String(parsed.jobNumber) : '',
      customer: parsed.customer ? String(parsed.customer) : '',
      description: parsed.description ? String(parsed.description) : '',
      billOfMaterials: components,
      geometry,
      spec,
      validation,
      blueprintExtractedAt: new Date().toISOString(),
      hasBlueprintImage: !!primaryImageBase64,
      // Picked up by jobForm.js's submit handler once the job has a real id.
      _pendingBlueprint: {
        spec, validation, components, imageBase64: primaryImageBase64, pageCount,
        status: decision.status, confidence, urgency: decision.urgency,
        autoApproved: decision.autoApproved, reason: decision.reason
      }
    };

    closeModal();
    openJobForm(null, prefill);
    showToast(components.length
      ? `Read the blueprint -- found ${components.length} components (${decision.status.replace('_',' ')}). Review and save.`
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
