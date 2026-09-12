/**
 * Admin dashboard -- one screen for running the app: who is on the team
 * and what they may do, what changed and who changed it, the shop access
 * code, and the diagnostic panels.
 *
 * Rendered into #content like a tab rather than as a modal sheet: the
 * transaction history needs the whole screen, and a bottom sheet on a
 * phone would show about four rows of it.
 */
import { requestRender } from '../app/bus.js';
import { currentUser } from '../auth/authService.js';
import { ASSIGNABLE_ROLES, isAdmin, roleBlurb, roleLabel, roleTagClass } from '../auth/permissions.js';
import * as adminRepo from '../db/adminRepo.js';
import { logActivity } from '../db/repository.js';
import { computeMetrics } from '../jobs/selectors.js';
import { state } from '../state/store.js';
import { confirmAction } from '../ui/components/confirm.js';
import { showToast } from '../ui/components/toast.js';
import { fmtWhen } from '../utils/date.js';
import { escapeHtml } from '../utils/dom.js';

const PAGE = 100;

const view = {
  section: 'overview',
  team: null,
  teamError: null,
  audit: [],
  auditError: null,
  auditDone: false,
  codes: null,
  codesError: null,
  loading: false,
  filters: { actor: '', action: '', entityType: '', from: '', to: '', text: '' }
};

/* ---------------- helpers ---------------- */

function isoStart(d){ return d ? new Date(`${d}T00:00:00`).toISOString() : ''; }
function isoEnd(d){ return d ? new Date(`${d}T23:59:59.999`).toISOString() : ''; }

function fmtExact(iso){
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' }) +
         ' ' + d.toLocaleTimeString(undefined, { hour:'numeric', minute:'2-digit', second:'2-digit' });
}

/** activity_log.detail is jsonb: render it as readable pairs, not raw JSON. */
function detailLines(detail){
  if(detail == null || detail === '') return [];
  if(typeof detail === 'string') return [detail];
  if(typeof detail !== 'object') return [String(detail)];
  const keys = Object.keys(detail);
  if(keys.length === 1 && keys[0] === 'text') return [String(detail.text)];
  return keys.map(k => {
    const v = detail[k];
    return `${k}: ${v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v)}`;
  });
}

function matchesText(row, q){
  if(!q) return true;
  const hay = [row.actor_name, row.action, row.entity_type, ...detailLines(row.detail)]
    .join(' ').toLowerCase();
  return hay.includes(q);
}

function visibleAudit(){
  const q = view.filters.text.trim().toLowerCase();
  return view.audit.filter(r => matchesText(r, q));
}

/* ---------------- loading ---------------- */

async function loadTeam(force){
  if(view.team && !force) return;
  try {
    view.team = await adminRepo.listTeam();
    view.teamError = null;
  } catch (e) {
    view.teamError = e.message;
  }
}

async function loadAudit({ append = false } = {}){
  const f = view.filters;
  try {
    const rows = await adminRepo.listAudit({
      actor: f.actor,
      action: f.action,
      entityType: f.entityType,
      since: isoStart(f.from),
      until: isoEnd(f.to),
      limit: PAGE,
      offset: append ? view.audit.length : 0
    });
    view.audit = append ? [...view.audit, ...rows] : rows;
    view.auditDone = rows.length < PAGE;
    view.auditError = null;
  } catch (e) {
    view.auditError = e.message;
  }
}

async function loadCodes(force){
  if(view.codes && !force) return;
  try {
    view.codes = await adminRepo.listSignupCodes();
    view.codesError = null;
  } catch (e) {
    view.codes = [];
    view.codesError = e.message;
  }
}

/* ---------------- sections ---------------- */

function overviewHtml(){
  const m = computeMetrics();
  const team = view.team || [];
  const active = team.filter(p => p.active);
  const byRole = r => active.filter(p => p.role === r).length;
  const jobs = state.jobs || [];
  const done = jobs.filter(j => j.assemblyStatus === 'complete').length;

  return `
    <div class="stat-grid">
      <div class="stat-tile"><div class="n">${active.length}</div><div class="l">Active People</div></div>
      <div class="stat-tile"><div class="n">${byRole('assembler_a')}</div><div class="l">Assembler A</div></div>
      <div class="stat-tile"><div class="n">${byRole('assembler_b')}</div><div class="l">Assembler B</div></div>
      <div class="stat-tile"><div class="n">${byRole('admin')}</div><div class="l">Admins</div></div>
    </div>
    <div class="stat-grid">
      <div class="stat-tile"><div class="n">${jobs.length}</div><div class="l">Jobs Total</div></div>
      <div class="stat-tile"><div class="n">${jobs.length - done}</div><div class="l">Open Jobs</div></div>
      <div class="stat-tile"><div class="n" style="color:var(--red);">${m.overdue}</div><div class="l">Overdue</div></div>
      <div class="stat-tile"><div class="n" style="color:var(--red);">${m.blockedCount}</div><div class="l">Blocked</div></div>
    </div>

    <div class="section-title">Diagnostics</div>
    <div class="fab-row"><button class="btn btn-outline btn-block" data-action="open-health">System Health</button></div>
    <div class="fab-row"><button class="btn btn-outline btn-block" data-action="open-migration">Migration Diagnostics</button></div>
    <div class="fab-row"><button class="btn btn-outline btn-block" data-action="manual-sync">Re-sync Shop Data</button></div>
  `;
}

function teamRowHtml(p, meId){
  const isMe = p.id === meId;
  const options = ASSIGNABLE_ROLES.map(r =>
    `<option value="${r}" ${p.role === r ? 'selected' : ''}>${escapeHtml(roleLabel(r))}</option>`).join('');
  // A legacy 'lead' row would otherwise silently show as Admin in the picker.
  const legacy = !ASSIGNABLE_ROLES.includes(p.role)
    ? `<option value="${escapeHtml(p.role)}" selected>${escapeHtml(roleLabel(p.role))}</option>` : '';
  return `
    <div class="team-row ${p.active ? '' : 'inactive'}">
      <div class="team-top">
        <div>
          <div class="team-name">${escapeHtml(p.full_name)}${isMe ? ' <span class="chip-tiny">You</span>' : ''}</div>
          <div class="team-meta">Joined ${p.created_at ? fmtExact(p.created_at) : 'unknown'}${p.active ? '' : ' &middot; switched off'}</div>
        </div>
        <span class="role-tag ${roleTagClass(p.role)}">${escapeHtml(roleLabel(p.role))}</span>
      </div>
      <div class="team-controls">
        <select data-action="admin-set-role" data-id="${p.id}" ${isMe ? 'disabled' : ''}
                aria-label="Role for ${escapeHtml(p.full_name)}">${legacy}${options}</select>
        <button class="btn btn-outline btn-sm" data-action="admin-toggle-active" data-id="${p.id}" ${isMe ? 'disabled' : ''}>
          ${p.active ? 'Switch Off' : 'Switch On'}
        </button>
      </div>
      ${isMe ? `<div class="bp-hint">You can't change your own role or switch yourself off &mdash; that's what stops the shop being locked out of its own admin account.</div>` : ''}
    </div>`;
}

function teamHtml(){
  if(view.teamError){
    return `<div class="val-box val-bad"><div class="val-head">Could not load the team</div>
      <div class="val-line">${escapeHtml(view.teamError)}</div></div>`;
  }
  const team = view.team;
  if(!team) return `<div class="empty-state"><div class="big">&#8987;</div>Loading team...</div>`;
  const meId = (currentUser() || {}).id;
  return `
    ${team.map(p => teamRowHtml(p, meId)).join('') || `<div class="empty-state">No accounts yet.</div>`}
    <div class="section-title">What Each Role Can Do</div>
    ${ASSIGNABLE_ROLES.map(r => `
      <div class="tip-card">
        <div class="tip-name"><span class="role-tag ${roleTagClass(r)}">${escapeHtml(roleLabel(r))}</span></div>
        <div class="tip-line" style="grid-template-columns:1fr;">${escapeHtml(roleBlurb(r))}</div>
      </div>`).join('')}
    <div class="bp-hint">
      Everyone who creates an account starts as ${escapeHtml(roleLabel('assembler_b'))} until you change it here.
      Role changes take effect the next time that person's app loads.
    </div>
  `;
}

function historyHtml(){
  const people = (view.team || []).slice().sort((a,b) => a.full_name.localeCompare(b.full_name));
  const actions = [...new Set(view.audit.map(r => r.action).filter(Boolean))].sort();
  const entities = [...new Set(view.audit.map(r => r.entity_type).filter(Boolean))].sort();
  const f = view.filters;
  const rows = visibleAudit();

  return `
    <div class="filter-grid">
      <select id="adminActor" aria-label="Filter by person">
        <option value="">Everyone</option>
        ${people.map(p => `<option value="${p.id}" ${f.actor === p.id ? 'selected' : ''}>${escapeHtml(p.full_name)}</option>`).join('')}
      </select>
      <select id="adminAction" aria-label="Filter by action">
        <option value="">Every action</option>
        ${actions.map(a => `<option value="${escapeHtml(a)}" ${f.action === a ? 'selected' : ''}>${escapeHtml(a)}</option>`).join('')}
      </select>
      <select id="adminEntity" aria-label="Filter by record type">
        <option value="">Every record type</option>
        ${entities.map(e => `<option value="${escapeHtml(e)}" ${f.entityType === e ? 'selected' : ''}>${escapeHtml(e)}</option>`).join('')}
      </select>
      <input type="date" id="adminFrom" value="${escapeHtml(f.from)}" aria-label="From date">
      <input type="date" id="adminTo" value="${escapeHtml(f.to)}" aria-label="To date">
      <input type="search" id="adminText" class="full" placeholder="Search job #, name, or detail..." value="${escapeHtml(f.text)}">
    </div>
    <div class="fab-row" style="margin-bottom:10px;">
      <button class="btn btn-outline btn-sm" data-action="admin-clear-filters">Clear</button>
      <button class="btn btn-outline btn-sm" data-action="admin-export-csv">Export CSV</button>
      <button class="btn btn-outline btn-sm" data-action="admin-refresh">Refresh</button>
    </div>

    ${view.auditError ? `<div class="val-box val-bad"><div class="val-head">Could not load history</div>
      <div class="val-line">${escapeHtml(view.auditError)}</div></div>` : ''}

    <div class="section-title">Transaction History <span class="count-badge">${rows.length}</span></div>
    ${rows.length ? rows.map(r => {
      const lines = detailLines(r.detail);
      return `
      <div class="act-row">
        <div class="act-head">
          <span class="act-who">${escapeHtml(r.actor_name || 'Unknown')}</span>
          <span class="act-when" title="${escapeHtml(fmtExact(r.at))}">${escapeHtml(fmtWhen(r.at))}</span>
        </div>
        <div class="act-action">${escapeHtml(r.action || '')}
          ${r.entity_type ? `<span class="chip-tiny">${escapeHtml(r.entity_type)}</span>` : ''}</div>
        ${lines.length ? `<div class="audit-detail">${lines.map(escapeHtml).join('\n')}</div>` : ''}
        <div class="act-when" style="margin-top:6px;">${escapeHtml(fmtExact(r.at))}</div>
      </div>`;
    }).join('') : `<div class="empty-state"><div class="big">&#128203;</div>Nothing recorded for these filters.</div>`}

    ${view.auditDone
      ? `<div class="bp-hint">That's everything for these filters.</div>`
      : `<div class="fab-row"><button class="btn btn-outline btn-block" data-action="admin-load-more">Load Older Entries</button></div>`}

    <div class="bp-hint">
      Every entry is stamped by the database with who was signed in and the server's own clock. The log is
      append-only: nobody can edit or delete an entry, including you. Corrections appear as new entries.
    </div>
  `;
}

function accessHtml(){
  if(view.codesError){
    return `
      <div class="val-box val-warn">
        <div class="val-head">Access codes are not readable from the app</div>
        <div class="val-line">${escapeHtml(view.codesError)}</div>
        <div class="val-line">The signup_codes table has no admin policy yet, so only the database dashboard can
          change the code. Ask Claude to apply the admin policy, then reopen this screen.</div>
      </div>`;
  }
  const codes = view.codes;
  if(!codes) return `<div class="empty-state"><div class="big">&#8987;</div>Loading codes...</div>`;
  return `
    <div class="bp-hint" style="margin-bottom:10px;">
      New employees type one of these codes when creating their account. Hand it out verbally; rotate it if it
      leaks. Switching a code off stops new signups with it &mdash; accounts already created keep working.
    </div>
    ${codes.map(c => `
      <div class="team-row ${c.active ? '' : 'inactive'}">
        <div class="team-top">
          <div>
            <div class="team-name">${escapeHtml(c.code)}</div>
            <div class="team-meta">${escapeHtml(c.label || 'No label')} &middot; added ${c.created_at ? fmtExact(c.created_at) : 'unknown'}</div>
          </div>
          <span class="role-tag ${c.active ? 'role-a' : 'role-b'}">${c.active ? 'Active' : 'Off'}</span>
        </div>
        <div class="team-controls">
          <button class="btn btn-outline btn-sm" data-action="admin-toggle-code" data-code="${escapeHtml(c.code)}">
            ${c.active ? 'Switch Off' : 'Switch On'}</button>
        </div>
      </div>`).join('') || `<div class="empty-state">No codes yet.</div>`}
    <div class="fab-row"><button class="btn btn-primary btn-block" data-action="admin-rotate-code">Generate A New Code</button></div>
  `;
}

/* ---------------- shell ---------------- */

function sectionChip(id, label){
  return `<button class="chip ${view.section === id ? 'active' : ''}" data-action="admin-section" data-section="${id}">${label}</button>`;
}

export function renderAdmin(){
  const el = document.getElementById('content');
  if(!el) return;
  if(!isAdmin()){
    el.innerHTML = `<div class="empty-state"><div class="big">&#128274;</div>Admins only.</div>`;
    return;
  }
  el.innerHTML = `
    <div class="admin-head">
      <button class="btn btn-outline btn-sm" data-action="admin-back">&#8592; Back</button>
      <div class="admin-title">Admin</div>
    </div>
    <div class="sticky-bar">
      <div class="chip-row">
        ${sectionChip('overview', 'Overview')}
        ${sectionChip('team', 'Team')}
        ${sectionChip('history', 'History')}
        ${sectionChip('access', 'Access Code')}
      </div>
    </div>
    <div id="adminBody">
      ${view.section === 'overview' ? overviewHtml()
        : view.section === 'team' ? teamHtml()
        : view.section === 'history' ? historyHtml()
        : accessHtml()}
    </div>
  `;
  bindInputs();
}

/**
 * Selects and text inputs are bound per-render rather than through the
 * global router: they live only on this screen, and the nodes (with their
 * listeners) are thrown away on the next paint.
 */
function bindInputs(){
  const onFilter = (id, key, reload) => {
    const node = document.getElementById(id);
    if(!node) return;
    node.addEventListener('change', () => {
      view.filters[key] = node.value;
      if(reload) refresh(); else renderAdmin();
    });
  };
  onFilter('adminActor', 'actor', true);
  onFilter('adminAction', 'action', true);
  onFilter('adminEntity', 'entityType', true);
  onFilter('adminFrom', 'from', true);
  onFilter('adminTo', 'to', true);

  const text = document.getElementById('adminText');
  if(text){
    text.addEventListener('input', () => {
      view.filters.text = text.value;
      const body = document.getElementById('adminBody');
      if(body) body.innerHTML = historyHtml();
      bindInputs();
      const again = document.getElementById('adminText');
      if(again){ again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
    });
  }

  document.querySelectorAll('[data-action="admin-set-role"]').forEach(sel => {
    sel.addEventListener('change', () => changeRole(sel.getAttribute('data-id'), sel.value));
  });
}

async function refresh(){
  if(view.section === 'team') await loadTeam(true);
  if(view.section === 'history'){ await loadTeam(); await loadAudit(); }
  if(view.section === 'access') await loadCodes(true);
  if(view.section === 'overview') await loadTeam();
  renderAdmin();
}

/** Entry point: called by the render router when state.tab === 'admin'. */
export async function openAdmin(){
  renderAdmin();
  await refresh();
}

/* ---------------- actions ---------------- */

async function changeRole(id, role){
  const person = (view.team || []).find(p => p.id === id);
  if(!person || person.role === role) return;
  const previous = person.role;
  try {
    await adminRepo.setRole(id, role);
    person.role = role;
    logActivity('Role changed',
      { person: person.full_name, from: roleLabel(previous), to: roleLabel(role) },
      { type: 'profile', id });
    showToast(`${person.full_name} is now ${roleLabel(role)}`);
    renderAdmin();
  } catch (e) {
    showToast(`Could not change the role: ${e.message}`, 5000);
    renderAdmin();
  }
}

function toggleActive(id){
  const person = (view.team || []).find(p => p.id === id);
  if(!person) return;
  const turningOff = person.active;
  const apply = async () => {
    try {
      await adminRepo.setActive(id, !turningOff);
      person.active = !turningOff;
      logActivity(turningOff ? 'Account switched off' : 'Account switched on',
        { person: person.full_name }, { type: 'profile', id });
      showToast(`${person.full_name} ${turningOff ? 'switched off' : 'switched back on'}`);
      renderAdmin();
    } catch (e) {
      showToast(`Could not update the account: ${e.message}`, 5000);
    }
  };
  if(!turningOff){ apply(); return; }
  confirmAction({
    title: 'Switch Off Account',
    message: `${person.full_name} will be signed out of everything and won't be able to sign back in. Their past work and history stay recorded. You can switch them back on any time.`,
    confirmLabel: 'Switch Off',
    onConfirm: apply
  });
}

/** Unambiguous alphabet: no O/0, I/1, so a code read out loud can't be mistyped. */
function generateCode(){
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = [...bytes].map(b => alphabet[b % alphabet.length]);
  return `SHOP-${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

function rotateCode(){
  const code = generateCode();
  confirmAction({
    title: 'New Access Code',
    message: `The new code will be ${code}. Existing codes stay active until you switch them off, so nobody is locked out mid-signup. Write this one down before closing.`,
    confirmLabel: 'Create Code',
    async onConfirm(){
      try {
        await adminRepo.addSignupCode(code, `Created ${new Date().toLocaleDateString()}`);
        logActivity('Access code created', { code }, { type: 'signup_code' });
        await loadCodes(true);
        renderAdmin();
        showToast(`New code: ${code}`, 8000);
      } catch (e) {
        showToast(`Could not create the code: ${e.message}`, 5000);
      }
    }
  });
}

async function toggleCode(code){
  const row = (view.codes || []).find(c => c.code === code);
  if(!row) return;
  try {
    await adminRepo.setCodeActive(code, !row.active);
    row.active = !row.active;
    logActivity(row.active ? 'Access code switched on' : 'Access code switched off',
      { code }, { type: 'signup_code' });
    renderAdmin();
  } catch (e) {
    showToast(`Could not update the code: ${e.message}`, 5000);
  }
}

function exportCsv(){
  const rows = visibleAudit();
  if(!rows.length){ showToast('Nothing to export for these filters'); return; }
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [
    ['when', 'who', 'action', 'record type', 'record id', 'detail'].join(','),
    ...rows.map(r => [
      new Date(r.at).toISOString(),
      r.actor_name || '',
      r.action || '',
      r.entity_type || '',
      r.entity_id || '',
      detailLines(r.detail).join(' | ')
    ].map(esc).join(','))
  ];
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `activity-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`Exported ${rows.length} entries`);
}

/** Wired from the global event router; every action here is namespaced admin-. */
export function handleAdminAction(action, btn){
  switch(action){
    case 'admin-back':
      state.tab = 'dashboard';
      requestRender();
      break;
    case 'admin-section':
      view.section = btn.getAttribute('data-section');
      renderAdmin();
      refresh();
      break;
    case 'admin-refresh':
      refresh();
      break;
    case 'admin-clear-filters':
      view.filters = { actor: '', action: '', entityType: '', from: '', to: '', text: '' };
      refresh();
      break;
    case 'admin-load-more':
      loadAudit({ append: true }).then(renderAdmin);
      break;
    case 'admin-export-csv':
      exportCsv();
      break;
    case 'admin-toggle-active':
      toggleActive(btn.getAttribute('data-id'));
      break;
    case 'admin-rotate-code':
      rotateCode();
      break;
    case 'admin-toggle-code':
      toggleCode(btn.getAttribute('data-code'));
      break;
  }
}
