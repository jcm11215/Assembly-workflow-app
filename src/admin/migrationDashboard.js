/**
 * Migration diagnostics dashboard.
 *
 * An operator-facing view of whether the relational layer is ready to
 * serve reads: parity per entity, mismatch detail, telemetry, and the
 * cutover controls. Rendered into the existing modal so it inherits the
 * app's styling and needs no new chrome.
 */
import { escapeHtml } from '../utils/dom.js';
import { openModal, closeModal } from '../ui/components/modal.js';
import { showToast } from '../ui/components/toast.js';
import { runFullParityCheck } from '../db/parity.js';
import { simulateCutover, applyCutover, revertCutover } from '../db/dryRun.js';
import { getMode, setMode, describeMode, MODE, isDryRun, setDryRun } from '../db/cutover.js';
import { getStats, resetStats } from '../db/telemetry.js';

let lastReport = null;
let lastSim = null;
let busy = false;

/* ---------------- rendering ---------------- */

function badge(ok, label){
  return `<span class="cf ${ok ? 'cf-high' : 'cf-conflict'}">${escapeHtml(label || (ok ? 'PASS' : 'FAIL'))}</span>`;
}

function entityRow(name, r){
  if(!r) return '';
  if(r.error){
    return `<div class="eng-row"><div class="eng-label">${escapeHtml(name)}</div>
      <div class="eng-val">error</div>
      <div class="eng-meta">${badge(false, 'ERROR')}<span class="eng-src">${escapeHtml(r.error)}</span></div></div>`;
  }
  const issues = (r.missing?.length || 0) + (r.extra?.length || 0) +
                 (r.conflicts?.length || 0) + (r.duplicates?.length || 0);
  return `
  <div class="eng-row">
    <div class="eng-label">${escapeHtml(name)}</div>
    <div class="eng-val">${r.legacyCount ?? '--'} &rarr; ${r.relationalCount ?? '--'}</div>
    <div class="eng-meta">
      ${badge(r.ok)}
      <span class="eng-src">${r.matched ?? 0} verified${issues ? ` &middot; ${issues} issue${issues > 1 ? 's' : ''}` : ''}</span>
    </div>
  </div>`;
}

function mismatchSection(name, r){
  if(!r || r.ok || r.error) return '';
  const block = (title, items, fmt) => {
    if(!items || !items.length) return '';
    const shown = items.slice(0, 10).map(fmt).join('');
    const more = items.length > 10 ? `<div class="val-line">…and ${items.length - 10} more</div>` : '';
    return `<div class="bom-group-head">${escapeHtml(title)} <span class="checklist-badge">${items.length}</span></div>${shown}${more}`;
  };
  const body =
    block('Missing from relational', r.missing, m =>
      `<div class="val-line vc-error">${escapeHtml(m.key)}</div>`) +
    block('Only in relational', r.extra, m =>
      `<div class="val-line vc-warn">${escapeHtml(m.key)}</div>`) +
    block('Duplicates', r.duplicates, d =>
      `<div class="val-line vc-error">${escapeHtml(d.side)}: ${escapeHtml(String(d.key))} &times;${d.count}</div>`) +
    block('Conflicting values', r.conflicts, c => {
      if(c.kind === 'items_differ'){
        return `<div class="val-line vc-warn">${escapeHtml(c.jobNumber)}: ` +
               `${c.onlyLegacy.length} legacy-only, ${c.onlyRelational.length} relational-only items</div>`;
      }
      if(c.kind === 'job_missing'){
        return `<div class="val-line vc-error">${escapeHtml(c.jobNumber)}: job absent (${c.legacyTicks} ticks lost)</div>`;
      }
      const d = (c.diffs || []).map(x =>
        `${escapeHtml(x.field)}: "${escapeHtml(String(x.legacy))}" vs "${escapeHtml(String(x.relational))}"`).join(', ');
      return `<div class="val-line vc-warn">${escapeHtml(c.key)} &mdash; ${d}</div>`;
    });
  return body ? `<div class="section-title">${escapeHtml(name)} mismatches</div>${body}` : '';
}

function telemetrySection(){
  const s = getStats();
  const r = s.relational;
  const pct = n => `${(n * 100).toFixed(2)}%`;
  return `
  <div class="section-title">Repository Telemetry</div>
  <div class="eng-table">
    <div class="eng-group">RELATIONAL</div>
    <div class="eng-row"><div class="eng-label">Reads</div><div class="eng-val">${r.reads}</div>
      <div class="eng-meta"><span class="eng-src">avg ${r.avgReadMs}ms</span></div></div>
    <div class="eng-row"><div class="eng-label">Writes</div><div class="eng-val">${r.writes}</div>
      <div class="eng-meta"><span class="eng-src">avg ${r.avgWriteMs}ms</span></div></div>
    <div class="eng-row"><div class="eng-label">Stale conflicts</div><div class="eng-val">${r.staleConflicts}</div>
      <div class="eng-meta">${badge(r.staleConflicts === 0)}<span class="eng-src">${pct(s.health.conflictRate)} of writes</span></div></div>
    <div class="eng-row"><div class="eng-label">Failures</div><div class="eng-val">${r.failures}</div>
      <div class="eng-meta">${badge(r.failures === 0)}<span class="eng-src">${pct(s.health.failureRate)} of ops</span></div></div>
    <div class="eng-row"><div class="eng-label">Retries</div><div class="eng-val">${r.retries}</div><div class="eng-meta"></div></div>
  </div>
  ${s.errors.length ? `<div class="section-title">Recent errors</div>` +
    s.errors.slice(0, 8).map(e =>
      `<div class="val-line ${e.kind === 'stale' ? 'vc-warn' : 'vc-error'}">
         [${escapeHtml(e.kind)}] ${escapeHtml(e.table)} &mdash; ${escapeHtml(e.detail)}</div>`).join('') : ''}`;
}

function modeSection(){
  const mode = getMode();
  const d = describeMode(mode);
  const chip = (m, label) =>
    `<button class="chip ${mode === m ? 'active' : ''}" data-action="mig-set-mode" data-mode="${m}">${label}</button>`;
  return `
  <div class="section-title" style="margin-top:0;">Cutover Mode</div>
  <div class="val-box ${d.risk === 'low' ? 'val-ok' : d.risk === 'medium' ? 'val-warn' : 'val-conflict'}">
    <div class="val-head">${escapeHtml(d.label)}</div>
    <div class="val-line">${escapeHtml(d.detail)}</div>
  </div>
  <div class="chip-row" style="margin-bottom:12px;">
    ${chip(MODE.LEGACY_READS, 'Legacy Reads')}
    ${chip(MODE.RELATIONAL_READS, 'Relational Reads')}
    ${chip(MODE.RELATIONAL_ONLY, 'Relational Only')}
  </div>
  <div class="chip-row" style="margin-bottom:12px;">
    <button class="chip ${isDryRun() ? 'active' : ''}" data-action="mig-toggle-dryrun">Dry-run compare</button>
  </div>`;
}

function simSection(){
  if(!lastSim) return '';
  const s = lastSim;
  return `
  <div class="section-title">Dry-Run Result</div>
  <div class="val-box ${s.identical ? 'val-ok' : 'val-warn'}">
    <div class="val-head">${s.identical ? 'Identical' : 'Differences found'}</div>
    <div class="val-line">${escapeHtml(s.recommendation)}</div>
    <div class="val-line">jobs ${s.counts.jobs.legacy}&rarr;${s.counts.jobs.relational} &middot;
      blockers ${s.counts.blockers.legacy}&rarr;${s.counts.blockers.relational} &middot;
      notes ${s.counts.notes.legacy}&rarr;${s.counts.notes.relational}</div>
  </div>
  ${s.visibleDifferences.jobsOnlyInLegacy.length ? `<div class="bom-group-head">Only in legacy</div>` +
    s.visibleDifferences.jobsOnlyInLegacy.map(x => `<div class="val-line vc-error">${escapeHtml(x)}</div>`).join('') : ''}
  ${s.visibleDifferences.jobsOnlyInRelational.length ? `<div class="bom-group-head">Only in relational</div>` +
    s.visibleDifferences.jobsOnlyInRelational.map(x => `<div class="val-line vc-warn">${escapeHtml(x)}</div>`).join('') : ''}`;
}

export function migrationDashboardHtml(){
  const rep = lastReport;
  const verdict = rep
    ? `<div class="val-box ${rep.verdict === 'PASS' ? 'val-ok' : 'val-bad'}">
         <div class="val-head">Parity ${rep.verdict}${rep.totalIssues ? ` &mdash; ${rep.totalIssues} issue${rep.totalIssues > 1 ? 's' : ''}` : ''}</div>
         <div class="val-line">${rep.legacyPresent ? 'Legacy store present.' : 'Legacy store not found (already archived).'}
           Ran in ${rep.durationMs}ms.</div>
         ${rep.safeToCutover
            ? '<div class="val-line vc-ok">Relational layer matches legacy. Cutover is safe.</div>'
            : '<div class="val-line vc-error">Do not cut over until these are resolved.</div>'}
       </div>`
    : `<div class="bp-hint" style="margin-bottom:10px;">No parity check run yet.</div>`;

  return `
  <div class="modal-sheet">
    <div class="modal-title">Migration Diagnostics <button class="modal-close" data-close-overlay>&times;</button></div>
    ${modeSection()}
    <div class="fab-row">
      <button class="btn btn-primary btn-sm" data-action="mig-run-parity" ${busy ? 'disabled' : ''}>
        ${busy ? 'Checking…' : 'Run Parity Check'}</button>
      <button class="btn btn-outline btn-sm" data-action="mig-dry-run" ${busy ? 'disabled' : ''}>Dry Run</button>
    </div>
    ${verdict}
    ${rep ? `
      <div class="section-title">Verified</div>
      <div class="eng-table">
        <div class="eng-group">LEGACY &rarr; RELATIONAL</div>
        ${entityRow('Jobs', rep.results.jobs)}
        ${entityRow('Blockers', rep.results.blockers)}
        ${entityRow('Notes', rep.results.notes)}
        ${entityRow('Checklist items', rep.results.checklists)}
        ${entityRow('Blueprints', rep.results.blueprints)}
        <div class="eng-row"><div class="eng-label">Orphaned references</div>
          <div class="eng-val">${rep.orphanCount}</div>
          <div class="eng-meta">${badge(rep.orphanCount === 0)}</div></div>
      </div>
      ${Object.entries(rep.results).map(([k, r]) => mismatchSection(k, r)).join('')}
    ` : ''}
    ${simSection()}
    ${telemetrySection()}
    <div class="fab-row">
      <button class="btn btn-outline btn-block" data-action="mig-reset-telemetry">Reset Telemetry</button>
    </div>
    <div class="fab-row">
      <button class="btn btn-outline btn-block" data-action="mig-revert">Revert to Legacy Reads</button>
    </div>
  </div>`;
}

/* ---------------- controller ---------------- */

export function openMigrationDashboard(){
  openModal(migrationDashboardHtml(), migrationDashboardHtml);
}

function refresh(){
  const root = document.getElementById('modalRoot');
  if(root && root.innerHTML.trim()){
    root.innerHTML = `<div class="modal-overlay" data-close-overlay>${migrationDashboardHtml()}</div>`;
  }
}

/** Wired from the global event router. */
export async function handleMigrationAction(action, btn){
  switch(action){
    case 'mig-run-parity':
      busy = true; refresh();
      try {
        lastReport = await runFullParityCheck();
        showToast(`Parity ${lastReport.verdict}${lastReport.totalIssues ? ` — ${lastReport.totalIssues} issue(s)` : ''}`,
                  lastReport.verdict === 'PASS' ? 3000 : 6000);
      } catch (e) {
        showToast(`Parity check failed: ${e.message}`, 6000);
      } finally { busy = false; refresh(); }
      return true;

    case 'mig-dry-run':
      busy = true; refresh();
      try {
        lastSim = await simulateCutover();
        showToast(lastSim.identical ? 'Dry run: identical' : 'Dry run: differences found',
                  lastSim.identical ? 3000 : 6000);
      } catch (e) {
        showToast(`Dry run failed: ${e.message}`, 6000);
      } finally { busy = false; refresh(); }
      return true;

    case 'mig-set-mode': {
      const target = btn.getAttribute('data-mode');
      // Guard the irreversible step behind evidence.
      if(target === MODE.RELATIONAL_ONLY && !(lastReport && lastReport.safeToCutover)){
        showToast('Run a passing parity check before going relational-only.', 6000);
        return true;
      }
      // setMode() throws on an unrecognized value -- catch it rather
      // than letting it escape the delegated click handler, which would
      // abort processing for every other action in the same event.
      try {
        setMode(target);
        showToast(describeMode(target).label);
        refresh();
      } catch (e) {
        console.error('invalid cutover mode', target, e);
        showToast(`Unknown cutover mode: ${target}`, 5000);
      }
      return true;
    }

    case 'mig-toggle-dryrun':
      setDryRun(!isDryRun());
      refresh();
      return true;

    case 'mig-reset-telemetry':
      resetStats(); showToast('Telemetry reset'); refresh();
      return true;

    case 'mig-revert':
      revertCutover();
      showToast('Reverted to legacy reads');
      refresh();
      return true;
  }
  return false;
}

export function getLastReport(){ return lastReport; }
