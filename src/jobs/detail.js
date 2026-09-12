/** The job's own page: the called-out drawing, checklist, hardware,
 *  blockers. A full view rather than a modal, because this is where an
 *  assembler actually works the job. */

import { bomListHtml } from '../blueprints/bom.js';
import { blueprintImageCache, ensureBlueprintImageLoaded } from '../blueprints/images.js';
import { blueprintImageSectionHtml } from '../blueprints/ui.js';
import { calloutDiagramHtml } from '../blueprints/calloutDiagram.js';
import { jobErrorsSectionHtml } from '../errors/index.js';
import { canLogErrors } from '../auth/permissions.js';
import { PROCEDURE, STAGES, STAGE_PROCEDURE, stageChecklistProgress, stageLabel } from './procedure.js';
import { dueStatus } from './selectors.js';
import { state } from '../state/store.js';
import { partGuideHtml, resetTips, stepTipsHtml } from '../tips/partTips.js';
import { setCurrentJobId } from '../ui/components/modal.js';
import { daysUntil, fmtDate } from '../utils/date.js';
import { escapeHtml } from '../utils/dom.js';

export function jobPageHtml(job){
  const ds = dueStatus(job);
  const du = daysUntil(job.dueDate);
  const dueText = ds==='complete' ? 'Complete' : ds==='overdue' ? `${Math.abs(du)}d overdue` : du===0 ? 'Due today' : `Due in ${du}d`;
  const idx = STAGES.findIndex(s=>s.id===job.assemblyStatus);
  const nextStage = STAGES[idx+1];
  const stageProgress = stageChecklistProgress(job, job.assemblyStatus);
  const stepIdxs = STAGE_PROCEDURE[job.assemblyStatus] || [];
  const checked = job.checklist || {};

  const checklistHtml = stepIdxs.length ? stepIdxs.map(si=>{
    const step = PROCEDURE[si];
    const stepDone = step.items.filter((_,ii)=>checked[si+'-'+ii]).length;
    const itemsHtml = step.items.map((text,ii)=>{
      const key = si+'-'+ii;
      const isDone = !!checked[key];
      return `
      <div class="checklist-item ${isDone?'done':''}" data-action="toggle-stage-checklist-item" data-id="${job.id}" data-key="${key}">
        <div class="checklist-check">${isDone?'&#10003;':''}</div>
        <div class="checklist-text">${escapeHtml(text)}</div>
      </div>`;
    }).join('');
    return `
    <div class="checklist-step">
      <div class="checklist-step-head"><span>${escapeHtml(step.title)}</span><span class="checklist-badge ${stepDone===step.items.length?'complete':''}">${stepDone}/${step.items.length}</span></div>
      ${stepTipsHtml(si, step.title)}
      ${itemsHtml}
    </div>`;
  }).join('') : `<div class="bp-hint" style="margin-bottom:10px;">No checklist steps for this stage -- it's a sign-off stage.</div>`;

  const openBlockers = state.blockers.filter(b=>b.jobNumber===job.jobNumber && b.status!=='Resolved');
  const blockersHtml = openBlockers.length ? openBlockers.map(b=>`
    <div class="blocker-card" style="margin-bottom:8px;">
      <div class="blocker-top">
        <div class="job-cust">${escapeHtml(b.responsibleDepartment)} &middot; reported ${fmtDate(b.dateReported)}</div>
        <span class="sev-badge sev-${b.severity.toLowerCase()}">${escapeHtml(b.severity)}</span>
      </div>
      <div class="job-desc">${escapeHtml(b.issueDescription)}</div>
    </div>`).join('') : `<div class="bp-hint" style="margin-bottom:10px;">No open blockers for this job.</div>`;

  const diagram = calloutDiagramHtml(job);

  return `
  <div class="job-page">
    <div class="job-page-bar">
      <button class="btn btn-outline btn-sm" data-action="job-back">&#8592; Back</button>
      <div class="job-page-title">${escapeHtml(job.jobNumber)}</div>
      <span class="badge badge-${(job.priority||'Medium').toLowerCase()}">${escapeHtml(job.priority||'Medium')}</span>
    </div>

    <div class="job-card due-${ds}" style="margin:0 0 14px 0;">
      <div class="job-card-top">
        <div>
          <div class="job-num">${escapeHtml(job.jobNumber)}</div>
          <div class="job-cust">${escapeHtml(job.customer)}</div>
        </div>
        <span class="badge badge-${(job.priority||'Medium').toLowerCase()}">${escapeHtml(job.priority||'Medium')}</span>
      </div>
      <div class="job-desc">${escapeHtml(job.description)}</div>
      <div class="job-meta-row">
        <span>Stage: <b>${escapeHtml(stageLabel(job.assemblyStatus))}</b></span>
        <span>Assembler: <b>${escapeHtml(job.assignedAssembler||'Unassigned')}</b></span>
        <span>Due: <b>${fmtDate(job.dueDate)}</b></span>
        ${job.lastMovedBy ? `<span>Last moved by: <b>${escapeHtml(job.lastMovedBy)}</b></span>` : ''}
      </div>
      <div class="gauge">
        <div class="gauge-track"><div class="gauge-fill" style="width:${job.percentComplete}%;"></div></div>
        <div class="gauge-label"><span class="due-tag due-${ds}">${dueText}</span> &middot; ${job.percentComplete}%</div>
      </div>
    </div>

    ${nextStage ? `<div class="fab-row"><button class="btn btn-primary btn-block" data-action="attempt-advance" data-id="${job.id}">Advance &#9656; ${escapeHtml(nextStage.label)}${stageProgress.total?` (${stageProgress.done}/${stageProgress.total})`:''}</button></div>` : ''}
    <div class="fab-row">
      <button class="btn btn-outline btn-sm" data-action="edit-job" data-id="${job.id}">Edit Details</button>
      <button class="btn btn-outline btn-sm" data-action="report-blocker" data-jobnumber="${escapeHtml(job.jobNumber)}">Report Blocker</button>
      ${canLogErrors() ? `<button class="btn btn-outline btn-sm" data-action="log-error" data-jobnumber="${escapeHtml(job.jobNumber)}">Log Error</button>` : ''}
    </div>

    ${diagram ? `
    <div class="section-title" style="margin-top:18px;">What You're Building</div>
    ${diagram}` : ''}

    <div class="section-title" style="margin-top:18px;">Current Stage Checklist</div>
    ${checklistHtml}
    ${partGuideHtml()}

    <div class="section-title">Blueprint &amp; Hardware</div>
    ${blueprintImageSectionHtml(job)}
    ${bomListHtml(job) || `<div class="bp-hint" style="margin-bottom:10px;">No blueprint scanned yet for this job.</div>`}
    <div class="fab-row">
      <button class="btn btn-outline btn-block" data-action="open-blueprint" data-id="${job.id}">&#128208; ${job.billOfMaterials && job.billOfMaterials.length ? 'Re-Scan Blueprint' : 'Scan Blueprint'}</button>
    </div>

    <div class="section-title">Open Blockers</div>
    ${blockersHtml}

    ${jobErrorsSectionHtml(job)}
  </div>`;
}

/** Paints the open job into #content. Called by the render router, so a
 *  realtime update or a checklist tick redraws the page like any tab. */
export function renderJobPage(){
  const job = state.jobs.find(j => j.id === state.openJobId);
  const content = document.getElementById('content');
  if(!content) return;
  if(!job){
    // The job went away underneath us (deleted on another device).
    content.innerHTML = `<div class="empty-state"><div class="big">&#9888;</div>That job is no longer here.
      <div class="fab-row" style="justify-content:center;margin-top:12px;"><button class="btn btn-outline btn-sm" data-action="job-back">&#8592; Back</button></div></div>`;
    return;
  }
  content.innerHTML = jobPageHtml(job);
}

/** @param push  false when restoring from a history pop -- the entry is
 *               already there, and pushing again would trap Back. */
export function openJobDetail(jobId, push = true){
  const job = state.jobs.find(j=>j.id===jobId);
  if(!job) return;
  if(state.tab !== 'job') state.returnTab = state.tab;
  state.openJobId = jobId;
  state.tab = 'job';
  state.bomEditing = false;
  resetTips();
  setCurrentJobId(jobId);
  // A real history entry, so the phone's back gesture leaves the job
  // rather than closing the whole app.
  if(push && typeof history !== 'undefined' && history.pushState){
    try { history.pushState({ job: jobId }, '', `#job/${jobId}`); } catch { /* file:// */ }
  }
  renderShell();
  if(job.hasBlueprintImage && blueprintImageCache[jobId] === undefined) ensureBlueprintImageLoaded(jobId);
}

/** Leaves the job page for whichever list it was opened from. */
export function closeJobPage(){
  state.tab = state.returnTab || 'dashboard';
  state.openJobId = null;
  renderShell();
}

// render() imports this module, so reach it lazily to avoid an import
// cycle at module-evaluation time.
function renderShell(){
  import('../app/render.js').then(m => {
    m.render();
    window.scrollTo(0, 0);
    const content = document.getElementById('content');
    if(content) content.scrollTop = 0;
  });
}

// Fetches the saved blueprint image once and caches it (see
// blueprintImageCache above), then refreshes whatever is on screen so
// the image appears -- this survives any number of re-renders in between
// (checklist toggles, stage advances) since the cache is what gets read,
// not a one-shot DOM patch.
