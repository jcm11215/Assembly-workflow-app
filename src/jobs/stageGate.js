/** Stage checklist gate: the modal that must be cleared to advance. */


import { logActivity, persistJobs } from '../db/repository.js';
import { PROCEDURE, STAGES, STAGE_PROCEDURE, checklistItemLabel, stageChecklistProgress, stageLabel } from './procedure.js';
import { state } from '../state/store.js';
import { openModal, refreshOpenModal } from '../ui/components/modal.js';
import { escapeHtml } from '../utils/dom.js';

export function stageGateModalHtml(job){
  const stageId = job.assemblyStatus;
  const stepIdxs = STAGE_PROCEDURE[stageId] || [];
  const idx = STAGES.findIndex(s=>s.id===stageId);
  const nextStage = STAGES[idx+1];
  const checked = job.checklist || {};
  const { done, total } = stageChecklistProgress(job, stageId);
  const allDone = total>0 && done===total;
  const stepsHtml = stepIdxs.map(si=>{
    const step = PROCEDURE[si];
    const stepDone = step.items.filter((_,ii)=>checked[si+'-'+ii]).length;
    const itemsHtml = step.items.map((text, ii)=>{
      const key = si+'-'+ii;
      const isDone = !!checked[key];
      return `
      <div class="checklist-item ${isDone?'done':''}" data-action="toggle-stage-checklist-item" data-id="${job.id}" data-key="${key}">
        <div class="checklist-check">${isDone ? '&#10003;' : ''}</div>
        <div class="checklist-text">${escapeHtml(text)}</div>
      </div>`;
    }).join('');
    return `
    <div class="checklist-step">
      <div class="checklist-step-head"><span>${escapeHtml(step.title)}</span><span class="checklist-badge ${stepDone===step.items.length?'complete':''}">${stepDone}/${step.items.length}</span></div>
      ${itemsHtml}
    </div>`;
  }).join('');
  return `
  <div class="modal-sheet">
    <div class="modal-title">${escapeHtml(stageLabel(stageId))} -- ${escapeHtml(job.jobNumber)} <button class="modal-close" data-close-overlay>&times;</button></div>
    <div class="checklist-progress">
      <div class="cp-label"><span>Before Advancing</span><span>${done}/${total}</span></div>
      <div class="gauge-track"><div class="gauge-fill" style="width:${total?Math.round(done/total*100):0}%;"></div></div>
    </div>
    ${stepsHtml}
    <div class="fab-row">
      <button class="btn btn-primary btn-block" data-action="confirm-advance" data-id="${job.id}" ${allDone?'':'disabled'}>
        ${allDone ? `Confirm &amp; Advance &#9656; ${nextStage?escapeHtml(nextStage.label):''}` : `Complete all steps to advance`}
      </button>
    </div>
  </div>`;
}

export function openStageGateModal(jobId){
  const job = state.jobs.find(j=>j.id===jobId);
  if(!job) return;
  openModal(stageGateModalHtml(job), ()=>{
    const j = state.jobs.find(x=>x.id===jobId);
    return j ? stageGateModalHtml(j) : '';
  });
}

export function toggleStageChecklistItem(jobId, key){
  const job = state.jobs.find(j=>j.id===jobId);
  if(!job) return;
  if(!job.checklist) job.checklist = {};
  job.checklist[key] = !job.checklist[key];
  persistJobs();
  logActivity(job.checklist[key] ? 'Checklist item done' : 'Checklist item un-done',
    `${job.jobNumber}: ${checklistItemLabel(key)}`);
  // Re-render whichever modal is open (stage gate or job detail) so the
  // checkmark updates in place without closing it.
  refreshOpenModal();
}
// Tapping Advance: if this stage has checklist items and they're not all
// done yet, open the gate modal instead of moving the job. Stages with no
// checklist items (or already fully checked) advance immediately.
