/** Dashboard view: metrics, focus banner, job list. */


import { STAGES, stageChecklistProgress, stageLabel } from './procedure.js';
import { computeFocusJobs, computeMetrics, dueStatus, dueStatusLabel, getJobFilters, openBlockerJobSet } from './selectors.js';
import { state } from '../state/store.js';
import { daysUntil, fmtDate } from '../utils/date.js';
import { escapeHtml } from '../utils/dom.js';

export function renderMetrics(){
  const m = computeMetrics();
  const el = document.getElementById('metricsStrip');
  el.innerHTML = `
    <button class="metric-card m-blue" data-action="goto-filter" data-filter="inprogress"><div class="num">${m.inProgress}</div><div class="lbl">In Progress</div></button>
    <button class="metric-card m-yellow" data-action="goto-filter" data-filter="ready"><div class="num">${m.readyCount}</div><div class="lbl">Ready to Start</div></button>
    <button class="metric-card m-red" data-action="goto-filter" data-filter="blocked"><div class="num">${m.blockedCount}</div><div class="lbl">Blocked</div></button>
    <button class="metric-card m-amber" data-action="goto-filter" data-filter="week"><div class="num">${m.dueThisWeek}</div><div class="lbl">Due This Week</div></button>
    <button class="metric-card m-red" data-action="goto-filter" data-filter="overdue"><div class="num">${m.overdue}</div><div class="lbl">Overdue</div></button>
  `;
  const blkTab = document.querySelector('.tab-btn[data-tab="blockers"]');
  if(blkTab){
    const existing = blkTab.querySelector('.dot');
    if(existing) existing.remove();
    if(m.blockedCount>0){
      const dot=document.createElement('span'); dot.className='dot'; blkTab.appendChild(dot);
    }
  }
}

/* ================= DASHBOARD ================= */

export function focusBannerHtml(){
  const scored = computeFocusJobs();
  const top = scored.filter(s=>s.score>=80).slice(0,3);
  if(top.length===0){
    return `
    <div class="focus-banner">
      <div class="focus-banner-head">Today's Focus</div>
      <div class="focus-calm">&#9989; Nothing urgent -- schedule looks on track.</div>
      <button class="btn btn-outline btn-sm" data-action="ask-ai-focus">Ask AI for full plan &#9656;</button>
    </div>`;
  }
  const chips = top.map(s=>{
    const ds = dueStatus(s.job);
    return `<span class="focus-job-chip">${escapeHtml(s.job.jobNumber)}<span class="fd due-tag due-${ds}">${dueStatusLabel(ds)}</span></span>`;
  }).join('');
  return `
  <div class="focus-banner">
    <div class="focus-banner-head">Today's Focus</div>
    <div class="focus-jobs">${chips}</div>
    <button class="btn btn-primary btn-sm" data-action="ask-ai-focus">Ask AI for full plan &#9656;</button>
  </div>`;
}

export function renderDashboard(){
  const filters = getJobFilters();
  document.getElementById('content').innerHTML = `
    ${focusBannerHtml()}
    <div class="sticky-bar">
      <input type="search" class="search-input" id="dashSearch" placeholder="Search job # or customer..." value="${escapeHtml(state.jobSearch)}">
      <div class="chip-row" id="jobFilterChips">
        ${filters.map(f=>`<button class="chip ${state.jobFilter===f.id?'active':''}" data-action="filter-jobs" data-filter="${f.id}">${f.label}</button>`).join('')}
      </div>
    </div>
    <div class="section-title">Jobs <span class="count-badge" id="jobCountBadge">0</span></div>
    <div id="jobCardsList"></div>
    <div class="fab-row">
      <button class="btn btn-primary btn-block" data-action="new-job">+ Add Job</button>
    </div>
    <div class="fab-row">
      <button class="btn btn-outline btn-block" data-action="new-job-from-blueprint">&#128208; New Job from Blueprint</button>
    </div>
  `;
  updateDashboardList();
}

export function updateDashboardList(){
  const filters = getJobFilters();
  const activeFilter = filters.find(f=>f.id===state.jobFilter) || filters[0];
  const q = state.jobSearch.trim().toLowerCase();
  let jobs = state.jobs.filter(activeFilter.test);
  if(q){
    jobs = jobs.filter(j => j.jobNumber.toLowerCase().includes(q) || j.customer.toLowerCase().includes(q));
  }
  jobs = jobs.slice().sort((a,b)=> daysUntil(a.dueDate)-daysUntil(b.dueDate));

  const blockedSet = openBlockerJobSet();
  const cardsHtml = jobs.length ? jobs.map(j=>{
    const ds = dueStatus(j);
    const du = daysUntil(j.dueDate);
    const dueText = ds==='complete' ? 'Complete' : ds==='overdue' ? `${Math.abs(du)}d overdue` : du===0 ? 'Due today' : `Due in ${du}d`;
    const isBlocked = blockedSet.has(j.jobNumber);
    const idx = STAGES.findIndex(s=>s.id===j.assemblyStatus);
    const nextStage = STAGES[idx+1];
    const stageProgress = stageChecklistProgress(j, j.assemblyStatus);
    const advanceLabel = nextStage
      ? (stageProgress.total>0
          ? `Advance &#9656; ${escapeHtml(nextStage.label)} (${stageProgress.done}/${stageProgress.total})`
          : `Advance &#9656; ${escapeHtml(nextStage.label)}`)
      : '';
    return `
    <div class="job-card due-${ds}" data-id="${j.id}" data-action="open-job-detail">
      <div class="job-card-top">
        <div>
          <div class="job-num">${escapeHtml(j.jobNumber)}</div>
          <div class="job-cust">${escapeHtml(j.customer)}</div>
        </div>
        <span class="badge badge-${j.priority.toLowerCase()}">${escapeHtml(j.priority)}</span>
      </div>
      <div class="job-desc">${escapeHtml(j.description)}</div>
      <div class="job-meta-row">
        <span>Stage: <b>${escapeHtml(stageLabel(j.assemblyStatus))}</b></span>
        <span>Assembler: <b>${escapeHtml(j.assignedAssembler||'Unassigned')}</b></span>
        <span>Due: <b>${fmtDate(j.dueDate)}</b></span>
        ${isBlocked ? `<span style="color:var(--red);font-weight:700;">&#9888; Blocked</span>` : ''}
      </div>
      <div class="gauge">
        <div class="gauge-track"><div class="gauge-fill" style="width:${j.percentComplete}%;"></div></div>
        <div class="gauge-label"><span class="due-tag due-${ds}">${dueText}</span> &middot; ${j.percentComplete}%</div>
      </div>
      <div class="job-card-actions">
        ${nextStage ? `<button class="btn btn-primary btn-sm" data-action="attempt-advance" data-id="${j.id}">${advanceLabel}</button>` : ''}
        <button class="btn btn-outline btn-sm" data-action="edit-job" data-id="${j.id}">Edit</button>
        <button class="btn btn-outline btn-sm" data-action="report-blocker" data-jobnumber="${escapeHtml(j.jobNumber)}">Blocker</button>
        <button class="btn btn-outline btn-sm" data-action="open-blueprint" data-id="${j.id}">&#128208; Blueprint${j.billOfMaterials && j.billOfMaterials.length ? ` (${j.billOfMaterials.length})` : ''}</button>
      </div>
    </div>`;
  }).join('') : `<div class="empty-state"><div class="big">&#128203;</div>No jobs match this filter.</div>`;

  document.getElementById('jobCardsList').innerHTML = cardsHtml;
  const badge = document.getElementById('jobCountBadge');
  if(badge) badge.textContent = jobs.length;
}

/* ================= BOARD ================= */
