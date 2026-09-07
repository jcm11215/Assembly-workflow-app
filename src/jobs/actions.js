/**
 * Job mutations. moveJobToStage() is the ONLY function permitted to change
 * assemblyStatus, and it refuses anything validateStageTransition() denies.
 */


// The ONLY function permitted to mutate job.assemblyStatus. Every caller
// -- arrows, Advance button, Move... picker, drag-and-drop -- goes
// through here, and it refuses anything validateStageTransition() denies.
import { requestRender as render } from '../app/bus.js';
import { currentActorName } from '../auth/authService.js';
import { logActivity, persistJobs } from '../db/repository.js';
import { STAGES, STAGE_DEFAULT_PERCENT, stageLabel } from './procedure.js';
import { openStageGateModal } from './stageGate.js';
import { TRANSITION, validateStageTransition } from './transitions.js';
import { state } from '../state/store.js';
import { closeModal, openModal, refreshOpenModal } from '../ui/components/modal.js';
import { showToast } from '../ui/components/toast.js';
import { escapeHtml } from '../utils/dom.js';

export function moveJobToStage(jobId, stageId, opts){
  opts = opts || {};
  const job = state.jobs.find(j=>j.id===jobId);
  if(!job) return { allowed:false, code:TRANSITION.NO_JOB };

  const verdict = validateStageTransition(job, stageId, opts);
  if(!verdict.allowed){
    // SAME_STAGE is a no-op, not an error worth interrupting anyone over.
    if(verdict.code !== TRANSITION.SAME_STAGE && !opts.silent){
      showToast(verdict.reason, 4000);
    }
    if(verdict.code === TRANSITION.CHECKLIST_INCOMPLETE && opts.openGateOnBlock){
      openStageGateModal(jobId);
    }
    return verdict;
  }

  const prevStage = job.assemblyStatus;
  job.assemblyStatus = stageId;
  // Automation: snap percent-complete to the stage's standard baseline so
  // the Lead doesn't have to also open the edit form to update progress.
  job.percentComplete = STAGE_DEFAULT_PERCENT[stageId] !== undefined ? STAGE_DEFAULT_PERCENT[stageId] : job.percentComplete;
  const who = currentActorName();
  if(who) job.lastMovedBy = who;
  persistJobs();
  logActivity('Stage moved', `${job.jobNumber}: ${stageLabel(prevStage)} -> ${stageLabel(stageId)}`);
  showToast(`${job.jobNumber} \u2192 ${stageLabel(stageId)}${who ? ` (${who})` : ''}`);
  render();
  refreshOpenModal();
  return { allowed:true, code:TRANSITION.OK };
}

export function stepStage(jobId, dir){
  const job = state.jobs.find(j=>j.id===jobId);
  if(!job) return;
  const idx = STAGES.findIndex(s=>s.id===job.assemblyStatus);
  const newIdx = idx + dir;
  if(newIdx < 0 || newIdx >= STAGES.length) return;
  moveJobToStage(jobId, STAGES[newIdx].id, { openGateOnBlock: dir > 0 });
}

export function openMover(jobId){
  const job = state.jobs.find(j=>j.id===jobId);
  if(!job) return;
  openModal(`
    <div class="modal-sheet">
      <div class="modal-title">Move ${escapeHtml(job.jobNumber)} <button class="modal-close" data-close-overlay>&times;</button></div>
      <div class="stage-picker">
        ${STAGES.map(s=>`<button class="${s.id===job.assemblyStatus?'current':''}" data-action="pick-stage" data-id="${job.id}" data-stage="${s.id}">${s.label}</button>`).join('')}
      </div>
    </div>
  `);
}

/* ================= BLOCKERS ================= */

// Tapping Advance: if this stage has checklist items and they're not all
// done yet, open the gate modal instead of moving the job. Stages with no
// checklist items (or already fully checked) advance immediately.
export function attemptAdvance(jobId){
  const job = state.jobs.find(j=>j.id===jobId);
  if(!job) return;
  const idx = STAGES.findIndex(s=>s.id===job.assemblyStatus);
  const nextStage = STAGES[idx+1];
  if(!nextStage){ showToast('Already at the final stage.'); return; }
  // Blocked-by-checklist opens the gate modal instead of just refusing,
  // so the person lands where they can actually clear it.
  moveJobToStage(job.id, nextStage.id, { openGateOnBlock:true, silent:true });
}

export function confirmAdvance(jobId){
  const job = state.jobs.find(j=>j.id===jobId);
  if(!job) return;
  const idx = STAGES.findIndex(s=>s.id===job.assemblyStatus);
  const nextStage = STAGES[idx+1];
  if(!nextStage) return;
  const verdict = moveJobToStage(job.id, nextStage.id);
  if(verdict.allowed) closeModal();   // stay open if it was rejected
}
/* ---------------- Component groups + 3D schematic ----------------
   The AI classifies each extracted component by where it gets installed
   ("trough", "screw", "drive", "bearings", "tail"). That drives both the
   grouped parts list and the colour coding in the 3D view, so a part in
   the list and the thing on screen are visibly the same subassembly. */
