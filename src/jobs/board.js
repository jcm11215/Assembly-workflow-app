/** Kanban board view + drag-and-drop (gated by transitions). */


/* ================= BOARD ================= */
import { moveJobToStage } from './actions.js';
import { STAGES } from './procedure.js';
import { state } from '../state/store.js';
import { escapeHtml } from '../utils/dom.js';

export let dragJobId = null;

export function renderBoard(){
  const cols = STAGES.map(stage=>{
    const jobs = state.jobs.filter(j=>j.assemblyStatus===stage.id);
    const cardsHtml = jobs.length ? jobs.map(j=>`
      <div class="board-card" draggable="true" data-id="${j.id}">
        <div class="bn" data-action="open-job-detail" data-id="${j.id}">${escapeHtml(j.jobNumber)}</div>
        <div class="bc" data-action="open-job-detail" data-id="${j.id}">${escapeHtml(j.customer)}</div>
        <div class="ba" data-action="open-job-detail" data-id="${j.id}">${escapeHtml(j.assignedAssembler||'Unassigned')} &middot; ${j.percentComplete}%</div>
        <div class="board-card-actions">
          <button class="icon-btn" data-action="stage-prev" data-id="${j.id}" title="Move back">&#8592;</button>
          <button class="move-btn" data-action="open-mover" data-id="${j.id}">Move&#8230;</button>
          <button class="icon-btn" data-action="attempt-advance" data-id="${j.id}" title="Move forward">&#8594;</button>
        </div>
      </div>
    `).join('') : `<div class="empty-col">No jobs</div>`;
    return `
    <div class="board-col">
      <div class="board-col-head"><span class="t">${stage.label}</span><span class="c">${jobs.length}</span></div>
      <div class="board-col-body" data-stage="${stage.id}">${cardsHtml}</div>
    </div>`;
  }).join('');

  document.getElementById('content').innerHTML = `
    <div class="section-title">Assembly Workflow Board</div>
    <div class="board-wrap" id="boardWrap">${cols}</div>
  `;
  attachBoardDnD();
}

export function attachBoardDnD(){
  const cards = document.querySelectorAll('.board-card');
  cards.forEach(c=>{
    c.addEventListener('dragstart', e=>{
      dragJobId = c.getAttribute('data-id');
      e.dataTransfer.effectAllowed = 'move';
    });
  });
  const cols = document.querySelectorAll('.board-col-body');
  cols.forEach(col=>{
    col.addEventListener('dragover', e=>{ e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', ()=> col.classList.remove('drag-over'));
    col.addEventListener('drop', e=>{
      e.preventDefault();
      col.classList.remove('drag-over');
      if(dragJobId){
        // Single gate -- no duplicated rule here any more.
        moveJobToStage(dragJobId, col.getAttribute('data-stage'), { openGateOnBlock:true });
        dragJobId = null;
      }
    });
  });
}
/* ================================================================
   STAGE TRANSITION VALIDATION -- SINGLE SOURCE OF TRUTH
   Every stage change in the app routes through validateStageTransition().
   It is pure (no DOM, no state mutation, no I/O) and depends only on
   values that also exist as database columns, so the identical rule set
   can later be expressed as a Postgres BEFORE UPDATE trigger without
   restating the logic.

   Returns: { allowed:boolean, reason:string|null, code:string }
   ================================================================ */
