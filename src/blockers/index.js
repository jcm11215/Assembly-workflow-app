/** Blockers: list view + report form. */


/* ================= BLOCKERS ================= */
import { requestRender as render } from '../app/bus.js';
import { currentActorName } from '../auth/authService.js';
import { logActivity, persistBlockers } from '../db/repository.js';
import { BLOCKER_FILTERS } from '../jobs/selectors.js';
import { state } from '../state/store.js';
import { closeModal, openModal } from '../ui/components/modal.js';
import { showToast } from '../ui/components/toast.js';
import { distinctValues } from '../utils/collection.js';
import { fmtDate, todayISO } from '../utils/date.js';
import { datalistHtml, escapeHtml } from '../utils/dom.js';
import { uid } from '../utils/id.js';

export function renderBlockers(){
  document.getElementById('content').innerHTML = `
    <div class="sticky-bar">
      <div class="chip-row" id="blockerFilterChips">
        ${BLOCKER_FILTERS.map(f=>`<button class="chip ${state.blockerFilter===f.id?'active':''}" data-action="filter-blockers" data-filter="${f.id}">${f.label}</button>`).join('')}
      </div>
    </div>
    <div class="section-title">Blockers <span class="count-badge" id="blockerCountBadge">0</span></div>
    <div id="blockerCardsList"></div>
    <div class="fab-row"><button class="btn btn-primary btn-block" data-action="new-blocker">+ Report Blocker</button></div>
  `;
  updateBlockersList();
}

export function updateBlockersList(){
  const activeFilter = BLOCKER_FILTERS.find(f=>f.id===state.blockerFilter) || BLOCKER_FILTERS[0];
  const list = state.blockers.filter(activeFilter.test).slice()
    .sort((a,b)=> (a.status==='Resolved')-(b.status==='Resolved') || new Date(b.dateReported)-new Date(a.dateReported));
  const html = list.length ? list.map(b=>`
    <div class="blocker-card ${b.status==='Resolved'?'resolved':''}" data-id="${b.id}">
      <div class="blocker-top">
        <div>
          <div class="job-num">${escapeHtml(b.jobNumber)}</div>
          <div class="job-cust">${escapeHtml(b.responsibleDepartment)} &middot; reported ${fmtDate(b.dateReported)}${b.reportedBy ? ` by ${escapeHtml(b.reportedBy)}` : ''}</div>
        </div>
        <span class="sev-badge sev-${b.severity.toLowerCase()}">${escapeHtml(b.severity)}</span>
      </div>
      <div class="job-desc">${escapeHtml(b.issueDescription)}</div>
      <div class="job-card-actions" style="align-items:center;">
        <span class="status-pill status-${b.status.toLowerCase().replace(' ','')}">${escapeHtml(b.status)}</span>
        <button class="btn btn-outline btn-sm" data-action="cycle-blocker-status" data-id="${b.id}">Update Status</button>
        <button class="btn btn-outline btn-sm" data-action="delete-blocker" data-id="${b.id}">Delete</button>
      </div>
    </div>
  `).join('') : `<div class="empty-state"><div class="big">&#9989;</div>No blockers in this view.</div>`;
  document.getElementById('blockerCardsList').innerHTML = html;
  const badge = document.getElementById('blockerCountBadge');
  if(badge) badge.textContent = `${state.blockers.filter(b=>b.status!=='Resolved').length} open`;
}

/* ================= DAILY NOTES ================= */

export function blockerFormHtml(prefillJobNumber){
  const depts = distinctValues('responsibleDepartment', state.blockers, ['Purchasing','Engineering','QC','Maintenance','Shipping','Production']);
  return `
  <div class="modal-sheet">
    <div class="modal-title">Report Blocker <button class="modal-close" data-close-overlay>&times;</button></div>
    <form id="blockerForm">
      <div class="field"><label>Job Number</label>
        <select name="jobNumber" required>
          ${state.jobs.map(j=>`<option value="${escapeHtml(j.jobNumber)}" ${j.jobNumber===prefillJobNumber?'selected':''}>${escapeHtml(j.jobNumber)} -- ${escapeHtml(j.customer)}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Issue Description</label><textarea required name="issueDescription" placeholder="What's blocking this job?"></textarea></div>
      <div class="field"><label>Responsible Department</label><input required name="responsibleDepartment" list="deptList" placeholder="e.g. Purchasing, Engineering, QC"></div>
      <div class="field"><label>Date Reported</label><input required type="date" name="dateReported" value="${todayISO()}"></div>
      <div class="field"><label>Severity</label>
        <select name="severity">
          ${['Critical','High','Medium','Low'].map(s=>`<option value="${s}">${s}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Status</label>
        <select name="status">
          ${['Open','In Progress','Resolved'].map(s=>`<option value="${s}">${s}</option>`).join('')}
        </select>
      </div>
      <div class="fab-row"><button type="submit" class="btn btn-primary btn-block">Report Blocker</button></div>
    </form>
    ${datalistHtml('deptList', depts)}
  </div>`;
}

export function openBlockerForm(prefillJobNumber){
  openModal(blockerFormHtml(prefillJobNumber));
  document.getElementById('blockerForm').addEventListener('submit', e=>{
    e.preventDefault();
    const fd = new FormData(e.target);
    const vals = Object.fromEntries(fd.entries());
    state.blockers.push({id:uid('blk'), reportedBy:currentActorName(), ...vals});
    persistBlockers();
    logActivity('Blocker reported', `${vals.jobNumber}: ${vals.severity} -- ${vals.issueDescription}`);
    closeModal();
    showToast('Blocker reported');
    render();
  });
}
