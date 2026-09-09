/**
 * Modal lifecycle. Tracks the open job by ID (never by object reference)
 * so a modal can't operate on a stale snapshot after a sync.
 */


import { state } from '../../state/store.js';

export let modalRefresh = null;
// Identity, not an object reference. Every consumer re-looks-up the job
// from state at use time, so a modal can never operate on a detached
// snapshot that a sync or edit has since replaced.
export let currentJobId = null;

// Setters -- ES module bindings are read-only to importing modules, so
// anything that needs to change these goes through a setter instead.
export function setModalRefresh(fn){ modalRefresh = fn || null; return modalRefresh; }
export function setCurrentJobId(id){ currentJobId = id || null; return currentJobId; }

export function getCurrentJob(){
  return currentJobId ? (state.jobs.find(j=>j.id===currentJobId) || null) : null;
}

export function closeModal(){
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
    modalRoot.innerHTML = `<div class="modal-overlay" data-close-overlay>${modalRefresh()}</div>`;
  }
}
document.addEventListener('click', e=>{
  if(e.target.hasAttribute('data-close-overlay')) closeModal();
});

/* ---------------- Metrics ---------------- */
