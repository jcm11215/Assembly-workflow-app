/** Daily notes: list view + entry form. */


/* ================= DAILY NOTES ================= */
import { requestRender as render } from '../app/bus.js';
import { currentActorName } from '../auth/authService.js';
import { logActivity, persistNotes } from '../db/repository.js';
import { state } from '../state/store.js';
import { closeModal, openModal } from '../ui/components/modal.js';
import { showToast } from '../ui/components/toast.js';
import { fmtDate, todayISO } from '../utils/date.js';
import { escapeHtml } from '../utils/dom.js';
import { uid } from '../utils/id.js';

export function renderNotes(){
  document.getElementById('content').innerHTML = `
    <div class="sticky-bar">
      <input type="search" class="search-input" id="noteSearch" placeholder="Search notes by job # or text..." value="${escapeHtml(state.noteSearch)}">
    </div>
    <div class="section-title">Daily Notes</div>
    <div id="noteCardsList"></div>
    <div class="fab-row"><button class="btn btn-primary btn-block" data-action="new-note">+ Add Daily Note</button></div>
  `;
  updateNotesList();
}

export function updateNotesList(){
  const q = state.noteSearch.trim().toLowerCase();
  let list = state.notes.slice().sort((a,b)=> new Date(b.date)-new Date(a.date));
  if(q){
    list = list.filter(n => (n.jobNumber||'').toLowerCase().includes(q) || (n.notes||'').toLowerCase().includes(q));
  }
  const typeClass = {Progress:'note-progress', Issue:'note-issue', NextSteps:'note-next'};
  const typeLabel = {Progress:'Progress', Issue:'Issue', NextSteps:'Next Steps'};
  const html = list.length ? list.map(n=>`
    <div class="note-card" data-id="${n.id}">
      <div class="note-head">
        <span><span class="note-type-tag ${typeClass[n.noteType]||''}">${typeLabel[n.noteType]||n.noteType}</span>${escapeHtml(n.jobNumber||'General')}</span>
        <span>${fmtDate(n.date)}</span>
      </div>
      <div class="note-body">${escapeHtml(n.notes)}</div>
      ${n.author ? `<div class="note-author">&mdash; ${escapeHtml(n.author)}</div>` : ''}
    </div>
  `).join('') : `<div class="empty-state"><div class="big">&#128221;</div>No notes match.</div>`;
  document.getElementById('noteCardsList').innerHTML = html;
}

/* ================= ACTIVITY LOG ================= */

export function noteFormHtml(prefillJobNumber){
  return `
  <div class="modal-sheet">
    <div class="modal-title">Add Daily Note <button class="modal-close" data-close-overlay>&times;</button></div>
    <form id="noteForm">
      <div class="field"><label>Date</label><input required type="date" name="date" value="${todayISO()}"></div>
      <div class="field"><label>Job Number</label>
        <select name="jobNumber">
          <option value="">General / Shop-wide</option>
          ${state.jobs.map(j=>`<option value="${escapeHtml(j.jobNumber)}" ${j.jobNumber===prefillJobNumber?'selected':''}>${escapeHtml(j.jobNumber)} -- ${escapeHtml(j.customer)}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Progress Notes</label><textarea name="progressNotes" placeholder="What got done?"></textarea></div>
      <div class="field"><label>Issues</label><textarea name="issues" placeholder="Anything that came up?"></textarea></div>
      <div class="field"><label>Next Steps</label><textarea name="nextSteps" placeholder="What's next?"></textarea></div>
      <div class="fab-row"><button type="submit" class="btn btn-primary btn-block">Save Note</button></div>
    </form>
  </div>`;
}

export function openNoteForm(prefillJobNumber){
  openModal(noteFormHtml(prefillJobNumber));
  document.getElementById('noteForm').addEventListener('submit', e=>{
    e.preventDefault();
    const fd = new FormData(e.target);
    const vals = Object.fromEntries(fd.entries());
    const entries = [];
    if(vals.progressNotes && vals.progressNotes.trim()) entries.push({noteType:'Progress', notes:vals.progressNotes.trim()});
    if(vals.issues && vals.issues.trim()) entries.push({noteType:'Issue', notes:vals.issues.trim()});
    if(vals.nextSteps && vals.nextSteps.trim()) entries.push({noteType:'NextSteps', notes:vals.nextSteps.trim()});
    if(!entries.length){ showToast('Enter at least one note field'); return; }
    entries.forEach(en=>{
      state.notes.push({id:uid('note'), date:vals.date, jobNumber:vals.jobNumber, author:currentActorName(), ...en});
    });
    persistNotes();
    logActivity('Note added', `${vals.jobNumber || 'General'}: ${entries.map(e=>e.noteType).join(', ')}`);
    closeModal();
    showToast('Note saved');
    render();
  });
}

/* ================= SETTINGS ================= */
