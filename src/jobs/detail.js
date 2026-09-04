/** Job detail view: info, checklist, blueprint, 3D, blockers. */


import { bomListHtml } from '../blueprints/bom.js';
import { blueprintImageCache, ensureBlueprintImageLoaded } from '../blueprints/images.js';
import { blueprintImageSectionHtml, engineeringPanelHtml, reviewPanelHtml } from '../blueprints/ui.js';
import { PROCEDURE, STAGES, STAGE_PROCEDURE, stageChecklistProgress, stageLabel } from './procedure.js';
import { dueStatus } from './selectors.js';
import { buildModel, modelSectionHtml } from '../models/geometry.js';
import { state } from '../state/store.js';
import { currentJobId, openModal, setCurrentJobId } from '../ui/components/modal.js';
import { daysUntil, fmtDate } from '../utils/date.js';
import { escapeHtml } from '../utils/dom.js';

export function jobDetailModalHtml(job){
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

  return `
  <div class="modal-sheet">
    <div class="modal-title">${escapeHtml(job.jobNumber)} <button class="modal-close" data-close-overlay>&times;</button></div>

    <div class="job-card due-${ds}" style="margin:0 0 14px 0;">
      <div class="job-card-top">
        <div>
          <div class="job-num">${escapeHtml(job.jobNumber)}</div>
          <div class="job-cust">${escapeHtml(job.customer)}</div>
        </div>
        <span class="badge badge-${job.priority.toLowerCase()}">${escapeHtml(job.priority)}</span>
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
    </div>

    <div class="section-title" style="margin-top:18px;">Current Stage Checklist</div>
    ${checklistHtml}

    <div class="section-title">Blueprint &amp; Hardware</div>
    ${blueprintImageSectionHtml(job)}
    ${modelSectionHtml(job)}
    ${reviewPanelHtml(job)}
    ${engineeringPanelHtml(job)}
    ${bomListHtml(job) || `<div class="bp-hint" style="margin-bottom:10px;">No blueprint scanned yet for this job.</div>`}
    <div class="fab-row">
      <button class="btn btn-outline btn-block" data-action="open-blueprint" data-id="${job.id}">&#128208; ${job.billOfMaterials && job.billOfMaterials.length ? 'Re-Scan Blueprint' : 'Scan Blueprint'}</button>
    </div>

    <div class="section-title">Open Blockers</div>
    ${blockersHtml}
  </div>`;
}

export function openJobDetail(jobId){
  const job = state.jobs.find(j=>j.id===jobId);
  if(!job) return;
  openModal(jobDetailModalHtml(job), ()=>{
    const j = state.jobs.find(x=>x.id===jobId);
    return j ? jobDetailModalHtml(j) : '';
  });
  setCurrentJobId(jobId);
  if(job.hasBlueprintImage && blueprintImageCache[jobId] === undefined) ensureBlueprintImageLoaded(jobId);
  if(job.geometry) setTimeout(()=>buildModel(job), 60);
}
// Fetches the saved blueprint image once and caches it (see
// blueprintImageCache above), then refreshes whichever modal is open so
// the image appears -- this survives any number of re-renders in between
// (checklist toggles, stage advances) since the cache is what gets read,
// not a one-shot DOM patch.
