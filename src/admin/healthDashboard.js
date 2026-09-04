/**
 * Health dashboard -- an operator-facing snapshot of whether the
 * running app is actually healthy, not just "not crashed". Reads from
 * modules that already track this (telemetry, connectionMonitor,
 * errorHandler, authService) rather than duplicating any of their
 * bookkeeping.
 */
import { escapeHtml } from '../utils/dom.js';
import { openModal } from '../ui/components/modal.js';
import { getRepoStats } from '../db/repository.js';
import { getConnectionSummary, getConnectionHistory } from '../monitoring/connectionMonitor.js';
import { getErrorLog } from '../monitoring/errorHandler.js';
import { AUTH_ENABLED, isSignedIn, currentUser } from '../auth/authService.js';
import { currentRole } from '../auth/permissions.js';
import { getMode, describeMode } from '../db/cutover.js';
import { db, supabaseReady } from '../db/supabaseClient.js';

function badge(ok, warnLabel){
  return ok
    ? `<span class="cf cf-high">HEALTHY</span>`
    : `<span class="cf cf-conflict">${escapeHtml(warnLabel || 'ISSUE')}</span>`;
}
function ago(ms){
  if(ms == null) return 'never';
  const s = Math.round(ms/1000);
  if(s < 60) return `${s}s ago`;
  const m = Math.round(s/60);
  if(m < 60) return `${m}m ago`;
  return `${Math.round(m/60)}h ago`;
}

/**
 * "Active users" is an approximation, not real presence -- distinct
 * actors who wrote an activity_log entry in the last N minutes. Phase 7
 * did not implement Supabase Presence; this is the honest substitute
 * available without adding that. Labeled as such in the UI, not implied
 * to be exact.
 */
async function estimateActiveUsers(windowMinutes = 15){
  if(!supabaseReady()) return { count:0, names:[], approximate:true };
  try {
    const since = new Date(Date.now() - windowMinutes*60000).toISOString();
    const rows = await db.select('activity_log', `select=actor_name&at=gte.${since}&order=at.desc&limit=200`);
    const names = [...new Set(rows.map(r=>r.actor_name).filter(Boolean))];
    return { count: names.length, names, approximate:true };
  } catch (e) {
    return { count:0, names:[], approximate:true, error:e.message };
  }
}

async function countRecent(matchFn, windowMinutes = 60){
  if(!supabaseReady()) return 0;
  try {
    const since = new Date(Date.now() - windowMinutes*60000).toISOString();
    const rows = await db.select('activity_log', `select=action,detail,at&at=gte.${since}&order=at.desc&limit=500`);
    return rows.filter(matchFn).length;
  } catch { return 0; }
}

let cached = null;

async function gather(){
  const stats = getRepoStats();
  const conn = getConnectionSummary();
  const activeUsers = await estimateActiveUsers();
  const blueprintFailures = await countRecent(r => r.action === 'Blueprint scan failed');
  const aiFailures = await countRecent(r => r.detail && r.detail.action_source === 'ai' && r.detail.ok === false);
  const errors = getErrorLog();
  cached = {
    at: Date.now(),
    stats, conn, activeUsers, blueprintFailures, aiFailures,
    errorCount: errors.length,
    recentErrors: errors.slice(0, 8)
  };
  return cached;
}

function panelHtml(d){
  const mode = describeMode(getMode());
  const signedIn = isSignedIn();
  const user = currentUser();

  return `
  <div class="modal-sheet">
    <div class="modal-title">System Health <button class="modal-close" data-close-overlay>&times;</button></div>

    <div class="eng-table">
      <div class="eng-group">ACTIVE USERS <span style="font-weight:400;text-transform:none;">(approx., last 15 min)</span></div>
      <div class="eng-row"><div class="eng-label">Distinct actors</div><div class="eng-val">${d.activeUsers.count}</div>
        <div class="eng-meta"><span class="eng-src">${d.activeUsers.names.map(escapeHtml).join(', ')||'none seen'}</span></div></div>

      <div class="eng-group">REALTIME</div>
      <div class="eng-row"><div class="eng-label">Connection</div><div class="eng-val">${d.conn.connected?'Connected':'Disconnected'}</div>
        <div class="eng-meta">${badge(d.conn.connected, 'DOWN')}${d.conn.currentlyDown?`<span class="eng-src">down for ${ago(-d.conn.downSinceMs)}</span>`:''}</div></div>
      <div class="eng-row"><div class="eng-label">Disconnects logged</div><div class="eng-val">${d.conn.disconnectCount}</div>
        <div class="eng-meta">${d.conn.avgDowntimeMs!=null?`<span class="eng-src">avg downtime ${Math.round(d.conn.avgDowntimeMs/1000)}s</span>`:''}</div></div>

      <div class="eng-group">AUTH</div>
      <div class="eng-row"><div class="eng-label">Mode</div><div class="eng-val">${AUTH_ENABLED?'Authenticated':'Legacy identity'}</div>
        <div class="eng-meta">${AUTH_ENABLED?badge(true):`<span class="cf cf-med">TRANSITIONAL</span>`}</div></div>
      ${AUTH_ENABLED ? `<div class="eng-row"><div class="eng-label">Session</div><div class="eng-val">${signedIn?'Signed in':'Signed out'}</div>
        <div class="eng-meta"><span class="eng-src">${signedIn?escapeHtml(user.email||''):''}${signedIn?` · ${escapeHtml(currentRole()||'')}`:''}</span></div></div>` : ''}

      <div class="eng-group">SYNC</div>
      <div class="eng-row"><div class="eng-label">Cutover mode</div><div class="eng-val">${escapeHtml(mode.label)}</div>
        <div class="eng-meta"><span class="cf ${mode.risk==='low'?'cf-high':mode.risk==='medium'?'cf-med':'cf-low'}">${mode.risk.toUpperCase()}</span></div></div>
      <div class="eng-row"><div class="eng-label">Last read</div><div class="eng-val">${ago(d.stats.relational.lastReadAt?Date.now()-d.stats.relational.lastReadAt:null)}</div><div class="eng-meta"></div></div>
      <div class="eng-row"><div class="eng-label">Last write</div><div class="eng-val">${ago(d.stats.relational.lastWriteAt?Date.now()-d.stats.relational.lastWriteAt:null)}</div><div class="eng-meta"></div></div>

      <div class="eng-group">CONFLICTS &amp; FAILURES</div>
      <div class="eng-row"><div class="eng-label">Stale write conflicts</div><div class="eng-val">${d.stats.relational.staleConflicts}</div>
        <div class="eng-meta">${badge(d.stats.relational.staleConflicts===0)}</div></div>
      <div class="eng-row"><div class="eng-label">Repository failures</div><div class="eng-val">${d.stats.relational.failures}</div>
        <div class="eng-meta">${badge(d.stats.relational.failures===0)}</div></div>
      <div class="eng-row"><div class="eng-label">Blueprint scan failures</div><div class="eng-val">${d.blueprintFailures}</div>
        <div class="eng-meta">${badge(d.blueprintFailures===0)}<span class="eng-src">last hour</span></div></div>
      <div class="eng-row"><div class="eng-label">AI action failures</div><div class="eng-val">${d.aiFailures}</div>
        <div class="eng-meta">${badge(d.aiFailures===0)}<span class="eng-src">last hour</span></div></div>
      <div class="eng-row"><div class="eng-label">Client errors (this session)</div><div class="eng-val">${d.errorCount}</div>
        <div class="eng-meta">${badge(d.errorCount===0)}</div></div>
    </div>

    ${d.recentErrors.length ? `
    <div class="section-title">Recent Client Errors</div>
    ${d.recentErrors.map(e=>`<div class="val-line vc-error">[${escapeHtml(e.kind)}] ${escapeHtml(e.message)}</div>`).join('')}
    ` : ''}

    <div class="bp-hint" style="margin-top:8px;">Snapshot taken ${ago(Date.now()-d.at)}. Figures for failures/AI actions cover the last hour from the activity log; repository stats cover this browser session only.</div>
    <div class="fab-row"><button class="btn btn-outline btn-block" data-action="health-refresh">Refresh</button></div>
  </div>`;
}

export async function openHealthDashboard(){
  const d = await gather();
  openModal(panelHtml(d));
}

export async function refreshHealthDashboard(){
  const d = await gather();
  const root = document.getElementById('modalRoot');
  if(root && root.innerHTML.trim()){
    root.innerHTML = `<div class="modal-overlay" data-close-overlay>${panelHtml(d)}</div>`;
  }
}
