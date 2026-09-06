/**
 * Modal lifecycle. Tracks the open job by ID (never by object reference)
 * so a modal can't operate on a stale snapshot after a sync.
 */


/* ---------------- Modal helpers ---------------- */
// Modals that need to update themselves in place (checklist toggles, a
// stage advancing while its detail view is open) register a refresher
// here instead of hardcoding which modal to redraw.
import { buildModel, disposeModel } from '../../models/geometry.js';
import { state } from '../../state/store.js';

export let modalRefresh = null;
// Identity, not an object reference. Every consumer re-looks-up the job
// from state at use time, so a modal can never operate on a detached
// snapshot that a sync or edit has since replaced.

// Identity, not an object reference. Every consumer re-looks-up the job
// from state at use time, so a modal can never operate on a detached
// snapshot that a sync or edit has since replaced.
export let currentJobId = null;

// Setters -- see the note in models/geometry.js. Imported bindings
// cannot be assigned directly by consuming modules.
export function setModalRefresh(fn){ modalRefresh = fn || null; return modalRefresh; }
export function setCurrentJobId(id){ currentJobId = id || null; return currentJobId; }

export function getCurrentJob(){
  return currentJobId ? (state.jobs.find(j=>j.id===currentJobId) || null) : null;
}

export function closeModal(){
  disposeModel();
  currentJobId = null;
  document.getElementById('modalRoot').innerHTML='';
  modalRefresh = null;
}

export function openModal(html, refresher){
  modalRefresh = refresher || null;
  document.getElementById('modalRoot').innerHTML = `<div class="modal-overlay" data-close-overlay>${html}</div>`;
  setTimeout(()=>{
    const f = document.querySelector('.modal-sheet input:not([readonly]):not([type=range]), .modal-sheet select, .modal-sheet textarea');
    if(f) f.focus();
  }, 50);
}

export function refreshOpenModal(){
  const modalRoot = document.getElementById('modalRoot');
  if(modalRefresh && modalRoot && modalRoot.innerHTML.trim()){
    // Re-rendering the sheet destroys the 3D canvas, so tear the old
    // renderer down and rebuild it against the new DOM node.
    disposeModel();
    modalRoot.innerHTML = `<div class="modal-overlay" data-close-overlay>${modalRefresh()}</div>`;
    const job = getCurrentJob();
    if(document.getElementById('modelStage') && job){
      setTimeout(()=>{
        const fresh = getCurrentJob();   // re-resolve; may have changed during the delay
        if(fresh && document.getElementById('modelStage')) buildModel(fresh);
      }, 60);
    }
  }
}
document.addEventListener('click', e=>{
  if(e.target.hasAttribute('data-close-overlay')) closeModal();
});

/* ---------------- Metrics ---------------- */
