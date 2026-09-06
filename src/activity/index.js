/** Activity log view. */


/* ================= ACTIVITY LOG ================= */
import { fetchActivityLog } from '../db/repository.js';
import { state } from '../state/store.js';
import { fmtWhen } from '../utils/date.js';
import { escapeHtml } from '../utils/dom.js';

export function renderActivity(){
  document.getElementById('content').innerHTML = `
    <div class="sticky-bar">
      <input type="search" class="search-input" id="actSearch" placeholder="Search by name, job #, or action..." value="${escapeHtml(state.activitySearch)}">
    </div>
    <div class="section-title">Activity Log <span class="count-badge" id="actCountBadge">--</span></div>
    <div id="actList"><div class="empty-state"><div class="big">&#8987;</div>Loading activity...</div></div>
    <div class="fab-row"><button class="btn btn-outline btn-block" data-action="refresh-activity">Refresh</button></div>
  `;
  loadActivity();
}

export async function loadActivity(){
  const rows = await fetchActivityLog(300);
  state.activity = rows;
  updateActivityList();
}

export function updateActivityList(){
  const el = document.getElementById('actList');
  if(!el) return;
  const q = state.activitySearch.trim().toLowerCase();
  let rows = state.activity || [];
  if(q){
    rows = rows.filter(r =>
      (r.who||'').toLowerCase().includes(q) ||
      (r.action||'').toLowerCase().includes(q) ||
      (r.detail||'').toLowerCase().includes(q)
    );
  }
  const badge = document.getElementById('actCountBadge');
  if(badge) badge.textContent = rows.length;
  if(!rows.length){
    el.innerHTML = `<div class="empty-state"><div class="big">&#128203;</div>No activity recorded yet.</div>`;
    return;
  }
  el.innerHTML = rows.map(r=>`
    <div class="act-row">
      <div class="act-head">
        <span class="act-who">${escapeHtml(r.who||'Unknown')}</span>
        <span class="act-when">${fmtWhen(r.at)}</span>
      </div>
      <div class="act-action">${escapeHtml(r.action||'')}</div>
      ${r.detail ? `<div class="act-detail">${escapeHtml(r.detail)}</div>` : ''}
    </div>`).join('');
}
