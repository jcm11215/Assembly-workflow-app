/** Blueprint UI: upload modals, engineering panel, verification, viewer. */


// A proportional schematic built from the dimensions read off the drawing --
// NOT a CAD model. It is accurate to the numbers extracted (diameter,
// length, incline, hanger count) and nothing more, which is enough to
// orient someone on the floor without pretending to be engineering data.
import { blueprintImageCache } from './images.js';
import { bomListHtml } from './bom.js';
import * as blueprintsRepo from '../db/blueprintsRepo.js';
import { confLabel, dimIn, validateSpec } from './spec.js';
import { state } from '../state/store.js';
import { modalRefresh, openModal, setCurrentJobId, setModalRefresh } from '../ui/components/modal.js';
import { escapeHtml } from '../utils/dom.js';
import { setSelectedBlueprintFile } from '../state/store.js';

export function dimRowHtml(label, d, extra){
  const flag = confLabel(d);
  const cls = { 'HIGH':'cf-high','MEDIUM':'cf-med','LOW':'cf-low','INFERRED':'cf-inf','NOT FOUND':'cf-none','CONFLICT':'cf-conflict' }[flag];
  const val = (d && d.status==='ok' && d.value!=null)
    ? `${d.value}${d.unit && d.unit!=='in' ? ' '+d.unit : '"'}`
    : '--';
  const src = (d && d.status==='ok' && d.source_page!=null)
    ? `p.${d.source_page}${d.source ? ' &middot; '+escapeHtml(d.source) : ''}`
    : (d && d.status!=='ok' ? 'not on drawing' : '');
  return `
  <div class="eng-row">
    <div class="eng-label">${escapeHtml(label)}</div>
    <div class="eng-val">${escapeHtml(val)}${extra?` <span class="eng-extra">${escapeHtml(extra)}</span>`:''}</div>
    <div class="eng-meta"><span class="cf ${cls}">${flag}</span>${src?`<span class="eng-src">${src}</span>`:''}</div>
  </div>`;
}

export function engineeringPanelHtml(job){
  const spec = job.spec;
  if(!spec) return '';
  const o = spec.overall||{}, tr = spec.trough||{}, sc = spec.screw||{}, hg = spec.hangers||{}, dr = spec.drive||{}, tl = spec.tail||{}, fr = spec.frame||{};
  const isScrew = spec.conveyorType !== 'belt';
  const v = job.validation || validateSpec(spec);

  const pages = (spec.pages_analyzed||[]).map(p=>`p.${p.page} ${escapeHtml(p.view||'')}`).join(' &middot; ');

  const valHtml = v.checks.length ? v.checks.map(ck=>{
    const cls = ck.level==='error'?'vc-error':ck.level==='conflict'?'vc-conflict':'vc-warn';
    return `<div class="val-line ${cls}">${escapeHtml(ck.message)}</div>`;
  }).join('') : `<div class="val-line vc-ok">All validation checks passed.</div>`;

  let sections = `
    <div class="eng-group">OVERALL</div>
    ${dimRowHtml('Length', o.overall_length)}
    ${dimRowHtml('Width', o.overall_width)}
    ${dimRowHtml('Height', o.overall_height)}
    ${dimRowHtml('Incline', o.incline_angle)}
    ${dimRowHtml('Elevation', o.elevation)}`;

  if(isScrew){
    sections += `
    <div class="eng-group">TROUGH</div>
    ${dimRowHtml('Trough width', tr.trough_width)}
    ${dimRowHtml('Trough depth', tr.trough_depth)}
    ${dimRowHtml('Gauge', tr.trough_gauge)}
    ${dimRowHtml('Flange height', tr.flange_height)}
    ${tr.style?`<div class="eng-row"><div class="eng-label">Style</div><div class="eng-val">${escapeHtml(tr.style)}</div><div class="eng-meta"></div></div>`:''}
    ${tr.material?`<div class="eng-row"><div class="eng-label">Material</div><div class="eng-val">${escapeHtml(tr.material)}</div><div class="eng-meta"></div></div>`:''}

    <div class="eng-group">SCREW</div>
    ${dimRowHtml('Diameter', sc.screw_diameter)}
    ${dimRowHtml('Pitch', sc.screw_pitch)}
    ${dimRowHtml('Shaft dia', sc.shaft_diameter)}
    ${dimRowHtml('Flight thk', sc.flight_thickness)}
    <div class="eng-row"><div class="eng-label">Shaftless</div><div class="eng-val">${sc.shaftless?'Yes':'No'}</div><div class="eng-meta"></div></div>

    <div class="eng-group">HANGER BEARINGS</div>
    <div class="eng-row"><div class="eng-label">Count</div><div class="eng-val">${hg.count!=null?escapeHtml(String(hg.count)):'--'}</div><div class="eng-meta"><span class="cf ${hg.count!=null?'cf-high':'cf-none'}">${hg.count!=null?'HIGH':'NOT FOUND'}</span></div></div>
    ${dimRowHtml('Spacing', hg.hanger_spacing)}
    ${dimRowHtml('Bearing bore', hg.bearing_bore)}
    ${hg.bearing_type?`<div class="eng-row"><div class="eng-label">Bearing type</div><div class="eng-val">${escapeHtml(hg.bearing_type)}</div><div class="eng-meta"></div></div>`:''}

    <div class="eng-group">DRIVE END</div>
    <div class="eng-row"><div class="eng-label">Location</div><div class="eng-val">${escapeHtml(dr.location||'--')}</div><div class="eng-meta"></div></div>
    ${dimRowHtml('Sprocket dia', dr.sprocket_diameter)}
    ${dimRowHtml('Shaft dia', dr.shaft_diameter)}
    ${dimRowHtml('Bearing bore', dr.bearing_bore)}
    ${dr.motor_hp?`<div class="eng-row"><div class="eng-label">Motor</div><div class="eng-val">${escapeHtml(dr.motor_hp)}</div><div class="eng-meta"></div></div>`:''}
    ${dr.gearbox?`<div class="eng-row"><div class="eng-label">Gearbox</div><div class="eng-val">${escapeHtml(dr.gearbox)}</div><div class="eng-meta"></div></div>`:''}

    <div class="eng-group">TAIL END</div>
    ${dimRowHtml('Shaft dia', tl.shaft_diameter)}
    ${dimRowHtml('Shaft length', tl.shaft_length)}
    ${dimRowHtml('Bearing bore', tl.bearing_bore)}`;
  }else{
    const hd = spec.head||{}, be = spec.belt||{}, id = spec.idlers||{};
    sections += `
    <div class="eng-group">BELT</div>
    ${dimRowHtml('Belt width', be.belt_width)}
    ${dimRowHtml('Belt thickness', be.belt_thickness)}
    <div class="eng-group">HEAD</div>
    ${dimRowHtml('Pulley dia', (hd.pulley||{}).pulley_diameter)}
    ${dimRowHtml('Pulley width', (hd.pulley||{}).pulley_width)}
    ${dimRowHtml('Shaft dia', hd.shaft_diameter)}
    <div class="eng-group">IDLERS</div>
    ${dimRowHtml('Roller dia', id.roller_diameter)}
    ${dimRowHtml('Roller spacing', id.roller_spacing)}`;
  }

  sections += `
    <div class="eng-group">FRAME</div>
    ${dimRowHtml('Frame height', fr.frame_height)}
    ${dimRowHtml('Side rail', fr.side_rail_height)}
    ${dimRowHtml('Leg spacing', fr.leg_spacing)}`;

  return `
  <div class="section-title" style="margin-top:16px;">Engineering Data <span class="count-badge">${escapeHtml(spec.conveyorType)}</span></div>
  ${pages?`<div class="bp-hint" style="margin-bottom:8px;">Pages analyzed: ${pages}</div>`:''}
  <div class="val-box ${v.errors?'val-bad':v.conflicts?'val-conflict':v.warnings?'val-warn':'val-ok'}">
    <div class="val-head">Validation${v.errors?` -- ${v.errors} error${v.errors>1?'s':''}`:''}${v.conflicts?` -- ${v.conflicts} conflict${v.conflicts>1?'s':''}`:''}${v.warnings?` -- ${v.warnings} warning${v.warnings>1?'s':''}`:''}</div>
    ${valHtml}
  </div>
  <div class="eng-table">${sections}</div>
  ${spec.notes?`<div class="bp-hint" style="margin-top:8px;">${escapeHtml(spec.notes)}</div>`:''}`;
}

export function blueprintImageSectionHtml(job){
  if(!job.hasBlueprintImage) return `<div class="bp-hint" style="margin-bottom:10px;">No blueprint file saved for this job yet.</div>`;
  const cached = blueprintImageCache[job.id];
  if(cached === undefined) return `<div id="bpImageArea" class="bp-hint" style="margin-bottom:10px;">Loading blueprint file...</div>`;
  if(!cached) return `<div class="bp-hint" style="margin-bottom:10px;">Blueprint file not found -- it may not have finished saving. Try Re-Scan.</div>`;
  if(cached.mimeType === 'application/pdf'){
    return `
    <div class="bp-file-chip" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;">
      <span>&#128196; ${escapeHtml(cached.filename || 'blueprint.pdf')}</span>
      <button type="button" class="btn btn-primary btn-sm" data-action="open-blueprint-fullscreen" data-id="${job.id}">Open PDF</button>
    </div>`;
  }
  // Any image type: inline preview, tap to open the pinch-zoom viewer.
  return `<img src="data:${cached.mimeType};base64,${cached.base64}" class="bp-preview-img" style="max-height:340px;margin-bottom:10px;" alt="Blueprint for ${escapeHtml(job.jobNumber)}" data-action="open-blueprint-fullscreen" data-id="${job.id}">
  <div class="bp-hint" style="margin-top:-4px;margin-bottom:10px;">Tap the drawing to open it full screen and zoom in.</div>`;
}

export function blueprintModalHtml(job){
  return `
  <div class="modal-sheet">
    <div class="modal-title">Blueprint -- ${escapeHtml(job.jobNumber)} <button class="modal-close" data-close-overlay>&times;</button></div>
    <div class="field">
      <label>Upload or Photograph Blueprint</label>
      <input type="file" id="bpFileInput" accept="image/*,application/pdf" capture="environment">
      <div class="bp-hint">Take a photo of a paper drawing, or upload a saved image or PDF (only the first page is read). Gemini will read the parts list or callouts and pull out the hardware and components.</div>
    </div>
    <div id="bpPreviewArea"></div>
    <div class="fab-row">
      <button class="btn btn-primary btn-block" id="bpExtractBtn" data-action="extract-bom" data-id="${job.id}" disabled>Extract Components</button>
    </div>
    <div id="bpResultArea">${bomListHtml(job)}</div>
  </div>`;
}

export function openBlueprintModal(jobId){
  const job = state.jobs.find(j=>j.id===jobId);
  if(!job) return;
  setSelectedBlueprintFile(null);
  // The BOM edit handlers resolve their job through currentJobId, so it
  // has to be set here too -- previously only openJobDetail() set it,
  // which meant every add/remove/reorder in THIS modal looked up an
  // undefined job and silently did nothing.
  setCurrentJobId(jobId);
  // Refresher is required, not optional: without it modalRefresh stays
  // null and refreshOpenModal() silently no-ops, so anything that edits
  // content in this modal (BOM add/remove/reorder) updates the database
  // but never redraws. Re-resolve the job each time rather than closing
  // over the stale object.
  openModal(blueprintModalHtml(job), ()=>{
    const j = state.jobs.find(x=>x.id===jobId);
    return j ? blueprintModalHtml(j) : '';
  });
}

export function newJobBlueprintModalHtml(){
  return `
  <div class="modal-sheet">
    <div class="modal-title">New Job from Blueprint <button class="modal-close" data-close-overlay>&times;</button></div>
    <div class="field">
      <label>Upload or Photograph Blueprint</label>
      <input type="file" id="bpFileInput" accept="image/*,application/pdf" capture="environment">
      <div class="bp-hint">Take a photo of a paper drawing, or upload a saved image or PDF (only the first page is read). Gemini will read the title block for the job number, customer, and description, plus pull out the hardware list -- then you review everything before it's saved.</div>
    </div>
    <div id="bpPreviewArea"></div>
    <div class="fab-row">
      <button class="btn btn-primary btn-block" id="bpExtractBtn" data-action="extract-new-job" disabled>Read Blueprint &amp; Create Job</button>
    </div>
    <div id="bpResultArea"></div>
  </div>`;
}

export function openNewJobBlueprintModal(){
  setSelectedBlueprintFile(null);
  // Refresher needed for the same reason as openBlueprintModal above --
  // this modal renders a BOM after a scan, and editing it must redraw.
  openModal(newJobBlueprintModalHtml(), newJobBlueprintModalHtml);
}

/** Decodes a base64 string to a Blob, entirely client-side -- used to
 *  turn the cached original file into something a new tab can open. */
function base64ToBlobLocal(base64, mimeType){
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for(let i=0;i<bytes.length;i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mimeType });
}

/** Dispatches to the pinch-zoom image viewer or, for a PDF, opens it in
 *  a new tab -- browsers already handle PDF pan/zoom/pinch natively,
 *  so there's no custom viewer to build for that case. */
export function openBlueprintFullscreen(jobId){
  const job = state.jobs.find(j=>j.id===jobId);
  const cached = blueprintImageCache[jobId];
  if(!job || !cached) return;
  if(cached.mimeType === 'application/pdf'){
    const blob = base64ToBlobLocal(cached.base64, cached.mimeType);
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    // Objection URLs are cheap to leak short-term (one per tap), but
    // release it once the browser's had a moment to load the tab.
    setTimeout(()=>URL.revokeObjectURL(url), 60000);
    return;
  }
  openImageFullscreen(job, cached);
}

/** Fullscreen image viewer -- pinch/drag to inspect the drawing, the
    practical everyday need on a shop floor where the detail you want
    is smaller than a phone screen shows at fit-width. */
function openImageFullscreen(job, cached){
  const root = document.getElementById('modalRoot');
  const prevHtml = root.innerHTML;
  const prevRefresh = modalRefresh;

  const holder = document.createElement('div');
  holder.className = 'bp-fullscreen';
  holder.innerHTML = `
    <div class="bp-fs-bar">
      <span class="bp-fs-title">${escapeHtml(job.jobNumber)} Blueprint</span>
      <button class="btn btn-outline btn-sm" id="bpFsClose">Close</button>
    </div>
    <div class="bp-fs-stage" id="bpFsStage">
      <img class="bp-fs-img" id="bpFsImg" src="data:${cached.mimeType};base64,${cached.base64}" alt="Blueprint">
      <div class="bp-fs-hint">Pinch to zoom &middot; drag to pan &middot; double-tap to reset</div>
    </div>`;
  document.body.appendChild(holder);

  const stage = holder.querySelector('#bpFsStage');
  const img = holder.querySelector('#bpFsImg');
  let scale=1, tx=0, ty=0, baseScale=1;
  function apply(){ img.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`; }
  function fit(){
    const sw = stage.clientWidth, sh = stage.clientHeight;
    const iw = img.naturalWidth || sw, ih = img.naturalHeight || sh;
    baseScale = Math.min(sw/iw, sh/ih);
    scale = baseScale;
    tx = (sw - iw*scale)/2;
    ty = (sh - ih*scale)/2;
    apply();
  }
  if(img.complete) fit(); else img.onload = fit;

  let dragging=false, lastX=0, lastY=0, pinchStart=0, scaleStart=1, lastTap=0;
  stage.addEventListener('pointerdown', e=>{
    dragging=true; lastX=e.clientX; lastY=e.clientY;
    const now=Date.now();
    if(now-lastTap < 300){ fit(); dragging=false; }
    lastTap=now;
  });
  stage.addEventListener('pointermove', e=>{
    if(!dragging) return;
    tx += e.clientX-lastX; ty += e.clientY-lastY;
    lastX=e.clientX; lastY=e.clientY;
    apply();
  });
  stage.addEventListener('pointerup', ()=>{ dragging=false; });
  stage.addEventListener('pointercancel', ()=>{ dragging=false; });
  stage.addEventListener('wheel', e=>{
    e.preventDefault();
    const f = 1 - Math.sign(e.deltaY)*0.15;
    const nx = e.clientX - stage.getBoundingClientRect().left;
    const ny = e.clientY - stage.getBoundingClientRect().top;
    tx = nx - (nx-tx)*f; ty = ny - (ny-ty)*f;
    scale = Math.max(baseScale*0.5, Math.min(baseScale*12, scale*f));
    apply();
  }, {passive:false});
  stage.addEventListener('touchstart', e=>{
    if(e.touches.length===2){
      pinchStart = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
      scaleStart = scale;
      dragging = false;
    }
  }, {passive:true});
  stage.addEventListener('touchmove', e=>{
    if(e.touches.length===2 && pinchStart){
      const d = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
      const rect = stage.getBoundingClientRect();
      const cx = (e.touches[0].clientX+e.touches[1].clientX)/2 - rect.left;
      const cy = (e.touches[0].clientY+e.touches[1].clientY)/2 - rect.top;
      const ns = Math.max(baseScale*0.5, Math.min(baseScale*12, scaleStart*(d/pinchStart)));
      const f = ns/scale;
      tx = cx - (cx-tx)*f; ty = cy - (cy-ty)*f;
      scale = ns;
      apply();
    }
  }, {passive:true});

  holder.querySelector('#bpFsClose').addEventListener('click', ()=>{
    document.body.removeChild(holder);
    root.innerHTML = prevHtml;
    setModalRefresh(prevRefresh);
  });
}

/* ================================================================
   REVIEW WORKFLOW (Phase 8)
   Status/confidence for the job's currently-active blueprint (latest
   approved, or latest overall if none approved -- see
   blueprintsRepo.getForJob()), plus version history and comparison.
   ================================================================ */

const STATUS_LABEL = {
  uploaded: 'Uploaded', processing: 'Processing', review_required: 'Review Required',
  approved: 'Approved', rejected: 'Rejected', extracted: 'Extracted'  // legacy value, pre-Phase-8
};
const STATUS_CLASS = {
  approved: 'val-ok', rejected: 'val-bad', review_required: 'val-warn',
  processing: 'val-warn', uploaded: 'val-warn', extracted: 'val-warn'
};

function confidencePctHtml(confidence){
  if(confidence == null) return '';
  const pct = Math.round(confidence * 100);
  const cls = confidence >= 0.9 ? 'cf-high' : confidence >= 0.7 ? 'cf-med' : 'cf-low';
  return `<span class="cf ${cls}">${pct}% CONFIDENCE</span>`;
}

/**
 * The panel a lead actually acts on: status, confidence, urgency, and
 * Approve/Reject -- separate from engineeringPanelHtml() so the dense
 * dimension table doesn't bury the one decision that matters.
 */
export function reviewPanelHtml(job){
  if(!job.spec) return '';   // no review workflow anymore -- spec is never populated, so this never renders
  const status = job.blueprintStatus || (job.spec ? 'review_required' : null);
  if(!status) return '';

  const urgencyNote = job.blueprintReviewUrgency === 'suggested'
    ? '<div class="val-line vc-warn">Review suggested -- moderate confidence, no hard issues found.</div>'
    : job.blueprintReviewUrgency === 'required'
      ? '<div class="val-line vc-error">Review required before this spec drives assembly.</div>' : '';

  const autoNote = job.blueprintAutoApproved
    ? '<div class="bp-hint" style="margin-top:6px;">Auto-approved by confidence threshold -- no human has reviewed this yet. A lead can still reject it below.</div>'
    : '';

  return `
  <div class="section-title" style="margin-top:16px;">Extraction Review</div>
  <div class="val-box ${STATUS_CLASS[status]||'val-warn'}">
    <div class="val-head">${escapeHtml(STATUS_LABEL[status]||status)}
      ${job.blueprintVersion ? ` &middot; v${job.blueprintVersion}` : ''}
      ${confidencePctHtml(job.blueprintConfidence)}
    </div>
    ${urgencyNote}
    ${autoNote}
  </div>
  ${status !== 'approved' && status !== 'rejected' ? `
  <div class="fab-row">
    <button class="btn btn-primary btn-sm" data-action="bp-approve" data-id="${job.blueprintId}">Approve</button>
    <button class="btn btn-outline btn-sm" data-action="bp-reject" data-id="${job.blueprintId}">Reject</button>
  </div>` : ''}
  <div class="fab-row">
    <button class="btn btn-outline btn-block" data-action="bp-show-versions" data-id="${job.id}">Version History</button>
  </div>`;
}

let versionListCache = {};   // jobId -> array, populated by openVersionHistory
let compareSelection = [];   // up to 2 blueprint ids picked for compare

export function versionHistoryModalHtml(jobId, versions){
  const job = state.jobs.find(j=>j.id===jobId);
  const rows = (versions||[]).map(v=>{
    const checked = compareSelection.includes(v.id) ? 'checked' : '';
    return `
    <div class="eng-row">
      <div class="eng-label">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" data-action="bp-toggle-compare" data-id="${v.id}" ${checked}>
          v${v.version} &middot; ${escapeHtml(new Date(v.extracted_at).toLocaleDateString())}
        </label>
      </div>
      <div class="eng-val">${confidencePctHtml(v.confidence)}</div>
      <div class="eng-meta">
        <span class="cf ${STATUS_CLASS[v.status]==='val-ok'?'cf-high':STATUS_CLASS[v.status]==='val-bad'?'cf-conflict':'cf-med'}">${escapeHtml(STATUS_LABEL[v.status]||v.status)}</span>
        ${v.status!=='approved' ? `<button class="btn btn-outline btn-sm" data-action="bp-approve" data-id="${v.id}" style="margin-left:auto;">Approve this version</button>` : ''}
      </div>
    </div>`;
  }).join('');

  return `
  <div class="modal-sheet">
    <div class="modal-title">${escapeHtml(job?job.jobNumber:'')} Blueprint History <button class="modal-close" data-close-overlay>&times;</button></div>
    <div class="bp-hint" style="margin-bottom:10px;">Every scan is kept as a version. The job uses the newest <b>approved</b> version -- older or unapproved scans don't affect it until approved.</div>
    <div class="eng-table">${rows || '<div class="eng-row"><div class="eng-label">No versions yet.</div></div>'}</div>
    <div class="fab-row">
      <button class="btn btn-primary btn-block" data-action="bp-compare" ${compareSelection.length!==2?'disabled':''}>
        Compare Selected (${compareSelection.length}/2)
      </button>
    </div>
  </div>`;
}

export async function openVersionHistory(jobId){
  const versions = await blueprintsRepo.listVersions(jobId);
  versionListCache[jobId] = versions;
  compareSelection = [];
  openModal(versionHistoryModalHtml(jobId, versions), () => versionHistoryModalHtml(jobId, versionListCache[jobId]));
}

export function toggleCompareSelection(blueprintId){
  const i = compareSelection.indexOf(blueprintId);
  if(i >= 0) compareSelection.splice(i, 1);
  else if(compareSelection.length < 2) compareSelection.push(blueprintId);
  else { compareSelection.shift(); compareSelection.push(blueprintId); }   // FIFO swap past 2
}

function diffRowsHtml(diff){
  const dimRows = diff.dimensionChanges.map(d => `
    <div class="val-line ${d.to==null?'vc-warn':'vc-ok'}">
      ${escapeHtml(d.field)}: ${d.from!=null?d.from.toFixed(2)+'"':'not found'} &rarr; ${d.to!=null?d.to.toFixed(2)+'"':'not found'}
    </div>`).join('');
  const added = diff.addedComponents.map(c => `<div class="val-line vc-ok">+ ${escapeHtml(c.item)} (${escapeHtml(c.installation_location)})</div>`).join('');
  const removed = diff.removedComponents.map(c => `<div class="val-line vc-error">&minus; ${escapeHtml(c.item)} (${escapeHtml(c.installation_location)})</div>`).join('');
  const changed = diff.changedComponents.map(c => `<div class="val-line vc-warn">~ ${escapeHtml(c.item)}: "${escapeHtml(c.from.specification)}" &rarr; "${escapeHtml(c.to.specification)}"</div>`).join('');
  return { dimRows, added, removed, changed };
}

export function compareModalHtml(diff){
  const { dimRows, added, removed, changed } = diffRowsHtml(diff);
  return `
  <div class="modal-sheet">
    <div class="modal-title">v${diff.fromVersion} vs v${diff.toVersion} <button class="modal-close" data-close-overlay>&times;</button></div>
    ${diff.statusChange ? `<div class="val-line vc-warn">Status: ${escapeHtml(diff.statusChange.from)} &rarr; ${escapeHtml(diff.statusChange.to)}</div>` : ''}
    <div class="section-title" style="margin-top:0;">Dimension Changes</div>
    ${dimRows || '<div class="bp-hint">No dimension changes.</div>'}
    <div class="section-title">Components</div>
    ${added}${removed}${changed}
    ${!added && !removed && !changed ? '<div class="bp-hint">No component changes.</div>' : ''}
  </div>`;
}
