/** Blueprint UI: upload modals, the component map, and the viewer. */
import { blueprintImageCache, componentMapPageCache, ensureComponentMapPageLoaded } from './images.js';
import { bomListHtml } from './bom.js';
import { state } from '../state/store.js';
import { modalRefresh, openModal, setCurrentJobId, setModalRefresh } from '../ui/components/modal.js';
import { escapeHtml } from '../utils/dom.js';
import { getSelectedBlueprintFile, setSelectedBlueprintFile } from '../state/store.js';
import { MAX_PDF_PAGES, parsePageSelection, pdfPageCount } from './pdf.js';
import { BOM_BUCKET_META, bomBucketFor } from '../models/stageMeta.js';

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

// jobId -> which source_page's pins are currently shown, when a scan
// placed components across more than one page.
let componentMapPage = {};
export function setComponentMapPage(jobId, page){ componentMapPage[jobId] = page; }

/**
 * Pins on the ACTUAL scanned drawing -- not a synthesized schematic --
 * showing where each extracted component physically sits. A component
 * only appears here when the AI could visually pinpoint it on a page
 * (see spec.js's normPosition/prompt.js's POSITION rule); a scan read
 * entirely from a BOM table has nothing to pin and falls back to a hint.
 */
export function componentMapHtml(job){
  if(!job.hasBlueprintImage) return '';
  const positioned = (job.billOfMaterials || []).filter(c => c.position && c.source_page);
  if(!positioned.length) return '';

  const byPage = {};
  positioned.forEach(c => { (byPage[c.source_page] = byPage[c.source_page] || []).push(c); });
  const pages = Object.keys(byPage).map(Number).sort((a,b)=>a-b);
  const remembered = componentMapPage[job.id];
  const current = (remembered && byPage[remembered])
    ? remembered
    : pages.reduce((best,p) => byPage[p].length > byPage[best].length ? p : best, pages[0]);
  componentMapPage[job.id] = current;

  const key = `${job.id}:${current}`;
  const cached = componentMapPageCache[key];

  const pageTabs = pages.length > 1 ? `
    <div class="fab-row" style="margin-bottom:8px;">
      ${pages.map(p => `<button type="button" class="btn btn-sm ${p===current?'btn-primary':'btn-outline'}" data-action="bp-map-page" data-id="${job.id}" data-index="${p}">Page ${p}</button>`).join('')}
    </div>` : '';

  if(cached === undefined){
    ensureComponentMapPageLoaded(job.id, current);
    return `<div class="section-title" style="margin-top:16px;">Where Each Part Goes</div>${pageTabs}<div class="bp-hint" style="margin-bottom:10px;">Loading drawing...</div>`;
  }
  if(!cached){
    return `<div class="section-title" style="margin-top:16px;">Where Each Part Goes</div>${pageTabs}<div class="bp-hint" style="margin-bottom:10px;">Could not load the drawing image for this scan.</div>`;
  }

  const pins = byPage[current].map(c=>{
    const meta = BOM_BUCKET_META[bomBucketFor(c)] || BOM_BUCKET_META.other;
    // The pin itself stays the short category name (it has to fit on the
    // drawing); the drawing's own wording rides along in the tooltip.
    const drawn = (c.item_as_drawn || '').trim();
    const title = [
      drawn && drawn.toLowerCase() !== (c.item||'').toLowerCase() ? `${c.item} -- ${drawn}` : c.item,
      c.specification || '',
      c.quantity ? `x${c.quantity}` : ''
    ].filter(Boolean).join(' · ');
    return `
    <div class="bp-pin" style="left:${(c.position.x*100).toFixed(2)}%;top:${(c.position.y*100).toFixed(2)}%;" title="${escapeHtml(title)}">
      <div class="bp-pin-dot" style="background:${meta.color};"></div>
      <div class="bp-pin-label" style="color:${meta.color};">${escapeHtml(c.item)}</div>
    </div>`;
  }).join('');

  return `
  <div class="section-title" style="margin-top:16px;">Where Each Part Goes</div>
  ${pageTabs}
  <div class="bp-map">
    <img src="data:${cached.mime};base64,${cached.base64}" class="bp-map-img" alt="Blueprint page ${current} for ${escapeHtml(job.jobNumber)}">
    ${pins}
  </div>`;
}

// "Pages to scan" -- hidden until a PDF is picked; showPdfPagesField()
// (called from the file input's change handler) reveals and fills it.
const PDF_PAGES_FIELD = `
    <div class="field" id="bpPagesField" hidden>
      <label for="bpPages">Pages to scan</label>
      <input type="text" id="bpPages" placeholder="All pages" autocomplete="off">
      <div class="bp-hint" id="bpPagesHint"></div>
    </div>`;

export function blueprintModalHtml(job){
  return `
  <div class="modal-sheet">
    <div class="modal-title">Blueprint -- ${escapeHtml(job.jobNumber)} <button class="modal-close" data-close-overlay>&times;</button></div>
    <div class="field">
      <label>Upload or Photograph Blueprint</label>
      <input type="file" id="bpFileInput" accept="image/*,application/pdf" capture="environment">
      <div class="bp-hint">Take a photo of a paper drawing, or upload a saved image or PDF. The AI reads the parts list or callouts and pulls out the hardware and components.</div>
    </div>
    ${PDF_PAGES_FIELD}
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
      <div class="bp-hint">Take a photo of a paper drawing, or upload a saved image or PDF. The AI reads the title block for the job number, customer, and description, plus pulls out the hardware list -- then you review everything before it's saved.</div>
    </div>
    ${PDF_PAGES_FIELD}
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

/** Reveals "Pages to scan" for a PDF (hides it for photos) and fills in
 *  the page count once pdf.js has it. */
export function showPdfPagesField(file){
  const field = document.getElementById('bpPagesField');
  const input = document.getElementById('bpPages');
  if(!field || !input) return;
  const isPdf = !!file && file.type === 'application/pdf';
  field.hidden = !isPdf;
  input.value = '';
  delete input.dataset.pageCount;
  if(!isPdf) return;
  setPagesHint('Counting pages...');
  pdfPageCount(file).then(n => {
    if(getSelectedBlueprintFile() !== file) return;   // a different file was picked meanwhile
    input.dataset.pageCount = String(n);
    updatePdfPagesHint();
  }).catch(() => setPagesHint('Could not count the pages -- every page will be scanned.'));
}

/** Live summary under the box: what will be scanned, or what's wrong. */
export function updatePdfPagesHint(){
  const input = document.getElementById('bpPages');
  const total = Number(input && input.dataset.pageCount) || 0;
  if(!total) return;
  const sel = parsePageSelection(input.value, total, MAX_PDF_PAGES);
  if(sel.error){ setPagesHint(`⚠ ${sel.error}`, true); return; }
  const plural = total === 1 ? '' : 's';
  if(input.value.trim()){
    setPagesHint(`Scanning ${sel.pages.length} of ${total} page${plural}.`);
  }else if(total > MAX_PDF_PAGES){
    setPagesHint(`${total} pages -- the first ${MAX_PDF_PAGES} will be scanned. Enter pages like 1-3, 7 to choose.`);
  }else{
    setPagesHint(`${total} page${plural} -- all will be scanned. To scan fewer, enter pages like 1-3, 7.`);
  }
}

function setPagesHint(text, isError){
  const hint = document.getElementById('bpPagesHint');
  if(!hint) return;
  hint.textContent = text;
  hint.style.color = isError ? 'var(--amber)' : '';
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
