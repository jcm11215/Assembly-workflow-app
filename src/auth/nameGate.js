/** Mandatory first-run name prompt. */


import { getUserName, setUserName } from './identity.js';
import { showToast } from '../ui/components/toast.js';

export function nameModalHtml(){
  return `
  <div class="modal-sheet">
    <div class="modal-title">Who's Using This?</div>
    <div class="bp-hint" style="margin-bottom:10px;">
      Enter your name to continue -- it'll be attached to notes, blockers, stage moves, and everything else you do
      in the app, so there's a clear record of who did what. No password, nothing else to remember. You can correct
      it later in Settings if needed.
    </div>
    <form id="nameForm">
      <div class="field"><label>Your Name</label><input name="username" placeholder="e.g. D. Reyes" autocomplete="off" required></div>
      <div class="fab-row"><button type="submit" class="btn btn-primary btn-block">Continue</button></div>
    </form>
  </div>`;
}

export function ensureUserName(){
  if(getUserName()) return;
  // Deliberately not using openModal() here -- this overlay has no
  // data-close-overlay attribute, so tapping outside it can't dismiss it.
  // Entering a name is a required first step, not a skippable one.
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal-overlay">${nameModalHtml()}</div>`;
  const form = document.getElementById('nameForm');
  form.addEventListener('submit', e=>{
    e.preventDefault();
    const fd = new FormData(e.target);
    const name = (fd.get('username')||'').trim();
    if(!name){ showToast('Please enter your name to continue'); return; }
    setUserName(name);
    root.innerHTML = '';
    showToast(`Welcome, ${name}`);
  });
  setTimeout(()=>{ const f = document.querySelector('#nameForm input'); if(f) f.focus(); }, 50);
}

/* ================= BLUEPRINT EXTRACTION ================= */
