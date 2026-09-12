/**
 * Engineering / purchasing error log.
 *
 * Two views over one list (state.jobErrors, the whole log):
 *   - a section on a job's own page, showing just that job's errors
 *   - the Errors tab, showing every error across every job, with the
 *     rollup that is the actual reason to record them
 *
 * The rollup is the feature. One error is a story someone tells at the
 * morning meeting; two hundred sorted by department, category and the
 * stage that caught them is the answer to "what do we keep getting
 * wrong", which is the only version of this that changes anything.
 */
import { requestRender as render } from '../app/bus.js';
import { createJobError, deleteJobError, setJobErrorStatus } from '../db/errorsRepo.js';
import { logActivity } from '../db/repository.js';
import { canCloseErrors, canDeleteErrors, canLogErrors } from '../auth/permissions.js';
import {
  ERROR_DEPARTMENTS, errorCategoryLabel, errorCostSummary, errorDepartment,
  errorDepartmentColor, errorDepartmentLabel, isErrorCategory, isErrorDepartment
} from '../models/errorMeta.js';
import { byCategory, byJob, byStageCaught, errorTotals } from './rollup.js';
import { STAGES, stageLabel } from '../jobs/procedure.js';
import { state } from '../state/store.js';
import { closeModal, openModal } from '../ui/components/modal.js';
import { showToast } from '../ui/components/toast.js';
import { fmtDate } from '../utils/date.js';
import { escapeHtml } from '../utils/dom.js';

/* ================= shared pieces ================= */

export function errorsForJob(jobNumber){
  return state.jobErrors.filter(e => e.jobNumber === jobNumber);
}

function stageCaughtLabel(id){
  return id === 'unknown' ? 'Stage not recorded' : `Caught at ${stageLabel(id)}`;
}

/**
 * One error as a card. `showJob` is off inside a job's own page, where
 * repeating the job number on every row is noise, and on in the central
 * log, where it is the first thing you need.
 */
function errorCardHtml(e, showJob){
  const corrected = e.status === 'Corrected';
  const cost = errorCostSummary(e);
  return `
  <div class="err-card${corrected ? ' corrected' : ''}" data-id="${e.id}"
       style="border-left-color:${errorDepartmentColor(e.department)};">
    <div class="err-top">
      <div>
        ${showJob ? `<div class="job-num">${escapeHtml(e.jobNumber || '(job deleted)')}</div>` : ''}
        <div class="job-cust">
          ${stageCaughtLabel(e.foundAtStage)} &middot; logged ${fmtDate(e.dateReported)}${e.reportedBy ? ` by ${escapeHtml(e.reportedBy)}` : ''}
        </div>
      </div>
      <span class="err-dept" style="background:${errorDepartmentColor(e.department)};">${escapeHtml(errorDepartmentLabel(e.department))}</span>
    </div>
    <div class="err-cat">${escapeHtml(errorCategoryLabel(e.department, e.category))}</div>
    <div class="job-desc">${escapeHtml(e.description)}</div>
    ${cost ? `<div class="err-cost">${escapeHtml(cost)}</div>` : ''}
    ${e.correction ? `<div class="err-fix"><b>Correction:</b> ${escapeHtml(e.correction)}</div>` : ''}
    <div class="job-card-actions" style="align-items:center;">
      <span class="status-pill status-${corrected ? 'resolved' : 'open'}">${escapeHtml(e.status)}</span>
      ${canCloseErrors() ? `<button class="btn btn-outline btn-sm" data-action="toggle-error-status" data-id="${e.id}">${corrected ? 'Reopen' : 'Mark Corrected'}</button>` : ''}
      ${canDeleteErrors() ? `<button class="btn btn-outline btn-sm" data-action="delete-error" data-id="${e.id}">Delete</button>` : ''}
    </div>
  </div>`;
}

/* ================= a job's own errors ================= */

/** The section for a job's page. Rendered even when empty: a job with no
 *  errors is worth saying out loud, and the button to log one has to
 *  live somewhere. */
export function jobErrorsSectionHtml(job){
  const list = errorsForJob(job.jobNumber);
  const open = list.filter(e => e.status !== 'Corrected').length;
  const rows = list.length
    ? list.map(e => errorCardHtml(e, false)).join('')
    : `<div class="bp-hint" style="margin-bottom:10px;">No engineering or purchasing errors logged on this job.</div>`;
  return `
  <div class="section-title" style="margin-top:18px;display:flex;justify-content:space-between;align-items:center;">
    <span>Engineering &amp; Purchasing Errors ${list.length ? `<span class="count-badge">${list.length}</span>` : ''}</span>
    ${open ? `<span class="chip-tiny">${open} still open</span>` : ''}
  </div>
  ${rows}
  ${canLogErrors() ? `<div class="fab-row">
    <button class="btn btn-outline btn-block" data-action="log-error" data-jobnumber="${escapeHtml(job.jobNumber)}">
      &#9873; Log an Error
    </button>
  </div>` : ''}`;
}

/* ================= the log form ================= */

function categoryOptions(departmentId){
  return errorDepartment(departmentId).categories
    .map(c => `<option value="${c.id}">${escapeHtml(c.label)}</option>`).join('');
}

export function errorFormHtml(prefillJobNumber){
  return `
  <div class="modal-sheet">
    <div class="modal-title">Log an Error <button class="modal-close" data-close-overlay>&times;</button></div>
    <form id="errorForm">
      <div class="field"><label>Job Number</label>
        <select name="jobNumber" required>
          ${state.jobs.map(j => `<option value="${escapeHtml(j.jobNumber)}"${j.jobNumber === prefillJobNumber ? ' selected' : ''}>${escapeHtml(j.jobNumber)} -- ${escapeHtml(j.customer)}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Where did it come from?</label>
        <select name="department" id="errDept" required>
          ${ERROR_DEPARTMENTS.map(d => `<option value="${d.id}">${escapeHtml(d.label)}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>What kind of error?</label>
        <select name="category" id="errCategory" required>${categoryOptions(ERROR_DEPARTMENTS[0].id)}</select>
      </div>
      <div class="field"><label>What happened?</label>
        <textarea required name="description" placeholder="e.g. Drawing called for a 2-7/16 bore, the shaft supplied is 2-3/16"></textarea>
      </div>
      <div class="field"><label>Which stage caught it?</label>
        <select name="foundAtStage">
          ${STAGES.map(s => `<option value="${s.id}">${escapeHtml(s.label)}</option>`).join('')}
          <option value="unknown" selected>Not sure</option>
        </select>
      </div>
      <div class="field"><label>Rework hours</label>
        <input type="number" name="reworkHours" min="0" step="0.25" placeholder="leave blank if nobody timed it">
      </div>
      <label class="err-check"><input type="checkbox" name="causedDelay"> It pushed the ship date</label>
      <label class="err-check"><input type="checkbox" name="scrapped"> Material had to be scrapped</label>
      <div class="fab-row"><button type="submit" class="btn btn-primary btn-block">Log Error</button></div>
    </form>
  </div>`;
}

/** Categories are per-department, so the second list is repopulated when
 *  the first changes -- a purchasing error can't be a "wrong dimension". */
function wireDepartmentCategories(){
  const dept = document.getElementById('errDept');
  const cat = document.getElementById('errCategory');
  if(!dept || !cat) return;
  dept.addEventListener('change', () => { cat.innerHTML = categoryOptions(dept.value); });
}

export function openErrorForm(prefillJobNumber){
  openModal(errorFormHtml(prefillJobNumber), () => errorFormHtml(prefillJobNumber));
  wireDepartmentCategories();
  const form = document.getElementById('errorForm');
  if(!form) return;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const vals = Object.fromEntries(new FormData(e.target).entries());
    const job = state.jobs.find(j => j.jobNumber === vals.jobNumber);
    if(!job){ showToast('Pick a job first'); return; }

    // Re-checked here and not just in the form, so a stale open modal
    // from before a vocabulary change can't write an uncountable row.
    const department = isErrorDepartment(vals.department) ? vals.department : 'other';
    const record = {
      jobId: job.id,
      department,
      category: isErrorCategory(department, vals.category) ? vals.category : 'other',
      description: (vals.description || '').trim(),
      foundAtStage: vals.foundAtStage || 'unknown',
      reworkHours: vals.reworkHours,          // '' means nobody timed it
      causedDelay: !!vals.causedDelay,        // absent when unchecked
      scrapped: !!vals.scrapped,
      status: 'Open'
    };

    try {
      const created = await createJobError(record);
      // The insert response carries no joined job number or reporter name.
      state.jobErrors.unshift({ ...created, jobNumber: job.jobNumber });
      logActivity('Error logged', {
        jobNumber: job.jobNumber,
        department: errorDepartmentLabel(department),
        category: errorCategoryLabel(department, record.category),
        foundAtStage: record.foundAtStage,
        description: record.description
      }, { type: 'job', id: job.id });
      closeModal();
      showToast('Error logged');
      render();
    } catch (err) {
      console.error('could not log the error', err);
      showToast('Could not save that -- check the connection and try again', 4000);
    }
  });
}

/* ================= actions ================= */

export async function toggleErrorStatus(errorId){
  const e = state.jobErrors.find(x => x.id === errorId);
  if(!e) return;
  const next = e.status === 'Corrected' ? 'Open' : 'Corrected';
  try {
    const row = await setJobErrorStatus(errorId, next);
    // Fields are merged into the copy we hold rather than replaced: the
    // PATCH response has no joined job number or reporter name, and
    // blanking those would lose the row's identity in the list.
    e.status = next;
    e.correctedAt = row ? row.corrected_at : null;
    logActivity(next === 'Corrected' ? 'Error marked corrected' : 'Error reopened',
      { jobNumber: e.jobNumber, category: errorCategoryLabel(e.department, e.category) },
      { type: 'job', id: e.jobId });
    render();
  } catch (err) {
    console.error('could not change the error status', err);
    showToast('Could not update that -- check the connection', 4000);
  }
}

export async function removeError(errorId){
  const e = state.jobErrors.find(x => x.id === errorId);
  if(!e) return;
  try {
    await deleteJobError(errorId);
    state.jobErrors = state.jobErrors.filter(x => x.id !== errorId);
    logActivity('Error deleted', { jobNumber: e.jobNumber, description: e.description },
      { type: 'job', id: e.jobId });
    render();
  } catch (err) {
    console.error('could not delete the error', err);
    showToast('Could not delete that -- check the connection', 4000);
  }
}

/* ================= the central log (Errors tab) ================= */

/** Errors matching the tab's two filters. */
export function filteredErrors(){
  const dept = state.errorDeptFilter;
  const status = state.errorStatusFilter;
  return state.jobErrors.filter(e =>
    (dept === 'all' || e.department === dept) &&
    (status === 'all' || (status === 'open' ? e.status !== 'Corrected' : e.status === 'Corrected')));
}

function statTilesHtml(t){
  return `
  <div class="stat-grid stat-grid-4">
    <div class="stat-tile"><div class="n">${t.total}</div><div class="l">Errors</div></div>
    <div class="stat-tile"><div class="n">${t.open}</div><div class="l">Still Open</div></div>
    <div class="stat-tile"><div class="n">${t.jobsAffected}</div><div class="l">Jobs Hit</div></div>
    <div class="stat-tile">
      <div class="n">${t.reworkHours}</div>
      <div class="l">Rework Hrs</div>
      ${t.timedCount < t.total
        // Said out loud, because a total that only covers the timed ones
        // reads as the cost of all of them otherwise.
        ? `<div class="stat-note">${t.timedCount} of ${t.total} timed</div>` : ''}
    </div>
  </div>`;
}

/**
 * A labelled bar, sized against the biggest row so the shape of the data
 * reads at a glance without pulling in a chart library.
 *
 * Label, bar and count share one line rather than stacking. Stacked, each
 * row cost two lines of height to use a sliver of the width, with a wide
 * empty gap between the label and its number -- the bar can live in that
 * gap instead, which halves the height and puts the horizontal space to
 * work. On a phone the label column narrows and the bar takes what is
 * left, so it never squeezes to nothing.
 */
function barRowHtml(label, count, max, color, sub){
  const pct = max > 0 ? Math.max(3, Math.round((count / max) * 100)) : 0;
  return `
    <div class="err-bar-label">
      ${escapeHtml(label)}${sub ? `<span class="err-bar-sub">${escapeHtml(sub)}</span>` : ''}
    </div>
    <div class="err-bar-track"><div class="err-bar-fill" style="width:${pct}%;background:${color};"></div></div>
    <b class="err-bar-n">${count}</b>`;
}

/** The rows of one chart, in a grid so every bar starts at the same x --
 *  bars you cannot line up are bars you cannot compare. */
function barsHtml(rows){
  return `<div class="err-bars">${rows.join('')}</div>`;
}

/**
 * The department filter chips carry their own counts, which is what
 * "by department" used to be a whole chart for. Same information, no
 * extra height, and it doubles as the control -- the count tells you
 * where to look and tapping it takes you there.
 */
function deptChipsHtml(){
  const all = state.jobErrors;
  const chips = [{ id:'all', label:'All', n: all.length, color:null }].concat(
    ERROR_DEPARTMENTS.map(d => ({
      id: d.id, label: d.label, color: d.color,
      n: all.filter(e => e.department === d.id).length
    })).filter(c => c.n > 0));
  return chips.map(c => `
    <button class="chip ${state.errorDeptFilter===c.id?'active':''}" data-action="filter-errors-dept" data-filter="${c.id}">
      ${c.color ? `<span class="chip-dot" style="background:${c.color};"></span>` : ''}${escapeHtml(c.label)}
      <span class="chip-n">${c.n}</span>
    </button>`).join('');
}

/**
 * The analysis, behind one tap.
 *
 * These three questions are why the log is worth keeping, but they are
 * not what someone opening the tab is usually here for -- and four
 * stacked charts pushed the errors themselves off the bottom of a phone
 * screen. Closed by default, and not offered at all until there are
 * enough entries for the shape to mean anything.
 */
function breakdownHtml(list){
  if(list.length < 3) return '';
  if(!state.errorBreakdownOpen){
    return `<div class="fab-row"><button class="btn btn-outline btn-block btn-sm" data-action="toggle-error-breakdown">
      Show the breakdown &#9662;
    </button></div>`;
  }
  const cats = byCategory(list, 6);
  const stages = byStageCaught(list);
  const worstJobs = byJob(list, 5);
  const maxCat = cats.length ? cats[0].count : 0;
  const maxStage = stages.reduce((m, s) => Math.max(m, s.count), 0);

  return `
  <div class="err-breakdown">
    <div class="section-title">What We Get Wrong Most</div>
    ${barsHtml(cats.map(c => barRowHtml(c.label, c.count, maxCat, c.color, c.departmentLabel)))}

    <div class="section-title">Where They Get Caught</div>
    <div class="bp-hint" style="margin-bottom:8px;">
      The same mistake costs minutes at layout and a teardown at final assembly. Errors bunched at the
      late stages mean the checks are happening too late, which is a different problem from making more.
    </div>
    ${barsHtml(stages.map(s => barRowHtml(s.label, s.count, maxStage, 'var(--accent)')))}

    ${worstJobs.length > 1 ? `
      <div class="section-title">Jobs With The Most</div>
      ${barsHtml(worstJobs.map(j => barRowHtml(j.jobNumber, j.count, worstJobs[0].count, 'var(--text-faint)',
          j.open ? `${j.open} open` : 'all corrected')))}` : ''}
  </div>
  <div class="fab-row"><button class="btn btn-outline btn-block btn-sm" data-action="toggle-error-breakdown">
    Hide the breakdown &#9652;
  </button></div>`;
}

export function renderErrors(){
  const list = filteredErrors();
  const totals = errorTotals(list);
  const statusChips = [{ id:'all', label:'All' }, { id:'open', label:'Open' }, { id:'corrected', label:'Corrected' }];

  document.getElementById('content').innerHTML = `
    <div class="sticky-bar">
      <div class="chip-row">${deptChipsHtml()}</div>
      <div class="chip-row">
        ${statusChips.map(c => `<button class="chip ${state.errorStatusFilter===c.id?'active':''}" data-action="filter-errors-status" data-filter="${c.id}">${escapeHtml(c.label)}</button>`).join('')}
      </div>
    </div>

    ${state.jobErrors.length === 0 ? `
      <div class="empty-state"><div class="big">&#9873;</div>
        No errors logged yet.<br>
        <span style="font-size:12px;">Log them from a job's page. The point is the pattern across jobs, so this
        stays quiet until there are a few weeks of entries in it.</span>
      </div>` : `
      ${statTilesHtml(totals)}
      ${breakdownHtml(list)}

      <div class="section-title">${state.errorDeptFilter === 'all' && state.errorStatusFilter === 'all' ? 'Every Error' : 'Matching Errors'} <span class="count-badge">${list.length}</span></div>
      ${list.length ? list.map(e => errorCardHtml(e, true)).join('')
        : `<div class="empty-state"><div class="big">&#9989;</div>No errors match this view.</div>`}
    `}

    ${canLogErrors() ? `<div class="fab-row"><button class="btn btn-primary btn-block" data-action="log-error">+ Log an Error</button></div>` : ''}
  `;
}
