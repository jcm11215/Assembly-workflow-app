/**
 * Admin: the team (add logins, roles, switch people off, reset
 * passwords), shop access codes for self sign-up, the full audit log, and
 * the server's health.
 */
import { html, useEffect, useState } from '../vendor/index.js';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { loadActivity } from '../lib/actions.js';
import { fmtWhen, fmtBytes, plural } from '../lib/format.js';
import { ROLES, ROLE_INFO, roleLabel } from '../../shared/roles.js';
import { Tabs, Field, Select, AsyncButton, PageHeader, submitting } from '../ui/kit.js';
import { Icon } from '../ui/icons.js';
import { openModal, Sheet, confirmAction, toast, toastError } from '../ui/overlays.js';

const SECTIONS = [
  { id: 'team', label: 'People' },
  { id: 'codes', label: 'Access codes' },
  { id: 'audit', label: 'Audit log' },
  { id: 'health', label: 'Health' }
];

export function Admin(){
  const [section, setSection] = useState('team');
  return html`
    <${PageHeader} title="Team" sub="Logins, roles, access codes and the server's health" />
    <${Tabs} label="Section" options=${SECTIONS} value=${section} onChange=${setSection} />
    ${section === 'team' && html`<${Team} />`}
    ${section === 'codes' && html`<${Codes} />`}
    ${section === 'audit' && html`<${Audit} />`}
    ${section === 'health' && html`<${Health} />`}`;
}

/* ---------------- team ---------------- */

function Team(){
  const [users, setUsers] = useState(null);
  const me = useStore(s => s.me);
  const team = useStore(s => s.team);   // live: re-read when anyone's role or status changes
  const load = () => api.get('/api/admin/users').then(r => setUsers(r.users)).catch(toastError);
  useEffect(() => { load(); }, [team]);
  if(!users) return html`<p class="hint">Loading…</p>`;

  const change = (u, fields, done) => api.patch(`/api/admin/users/${u.id}`, fields).then(() => { load(); toast(done, { kind: 'ok' }); });
  const setActive = async u => {
    if(u.active && !(await confirmAction({ title: `Switch off ${u.fullName}?`,
        message: 'They are signed out everywhere at once and cannot sign in again until switched back on. Their history stays.',
        confirmLabel: 'Switch off', danger: true }))) return;
    await change(u, { active: !u.active }, u.active ? `${u.fullName} switched off.` : `${u.fullName} switched on.`);
  };

  const active = users.filter(u => u.active);
  return html`
    <div class="stat-grid">
      ${ROLES.map(r => html`<div class="stat" key=${r}><b>${active.filter(u => u.role === r).length}</b><span>${roleLabel(r)}</span></div>`)}
      <div class="stat"><b>${users.length - active.length}</b><span>Switched off</span></div>
    </div>
    <div class="section-head">
      <h2 class="section-title">People <span class="count">${users.length}</span></h2>
      <button class="btn btn-primary" onClick=${() => openModal(AddPerson, { onDone: load })}><${Icon} name="plus" />Add a person</button>
    </div>
    <div class="list">
      ${users.map(u => html`
        <div key=${u.id} class=${`person${u.active ? '' : ' inactive'}`}>
          <div class="person-main">
            <b>${u.fullName}</b>${u.id === me.id && html` <span class="tag">You</span>`}
            <div class="hint">${u.login} · joined ${fmtWhen(u.createdAt)}${u.hasPassword ? '' : ' · no password yet'}</div>
          </div>
          <select aria-label=${`Role for ${u.fullName}`} onChange=${e => change(u, { role: e.currentTarget.value }, `${u.fullName} is now ${roleLabel(e.currentTarget.value)}.`).catch(err => { toastError(err); load(); })}>
            ${ROLES.map(r => html`<option key=${r} value=${r} selected=${u.role === r}>${roleLabel(r)}</option>`)}
          </select>
          <div class="card-actions">
            <button class="btn btn-sm" onClick=${() => openModal(SetPassword, { user: u, onDone: load })}>Set password</button>
            <${AsyncButton} class="btn btn-sm" onClick=${() => setActive(u)}>${u.active ? 'Switch off' : 'Switch on'}<//>
          </div>
        </div>`)}
    </div>
    <details class="hint"><summary>What each role can do</summary>
      ${ROLES.map(r => html`<p key=${r}><b>${roleLabel(r)}</b>: ${ROLE_INFO[r].blurb}</p>`)}
    </details>`;
}

function AddPerson({ onDone, close }){
  const submit = submitting(async f => {
    await api.post('/api/admin/users', { fullName: f.fullName, login: f.login, password: f.password, role: f.role });
    toast(`${f.fullName} can now sign in as ${f.login.trim().toLowerCase()}.`, { kind: 'ok', ms: 6000 });
    onDone();
    close();
  });
  return html`
    <${Sheet} title="Add a person" close=${close}>
      <form onSubmit=${submit}>
        <${Field} label="Name"><input name="fullName" required /><//>
        <${Field} label="Username" hint="Letters, numbers, dots, dashes -- or a work email.">
          <input name="login" required autocapitalize="off" spellcheck="false" autocomplete="off" />
        <//>
        <${Field} label="Starting password" hint="At least 8 characters. Tell them to change it in Settings.">
          <input name="password" required minlength="8" autocomplete="new-password" />
        <//>
        <${Field} label="Role"><${Select} name="role" value="trainee" options=${ROLES.map(r => ({ value: r, label: roleLabel(r) }))} /><//>
        <button type="submit" class="btn btn-primary btn-block">Create login</button>
      </form>
    <//>`;
}

function SetPassword({ user, onDone, close }){
  const submit = submitting(async f => {
    await api.put(`/api/admin/users/${user.id}/password`, { password: f.password });
    toast(`New password set for ${user.fullName}. They've been signed out elsewhere.`, { kind: 'ok', ms: 5000 });
    onDone();
    close();
  });
  return html`
    <${Sheet} title=${`Set a password for ${user.fullName}`} close=${close} small>
      <form onSubmit=${submit}>
        <${Field} label="New password" hint="At least 8 characters."><input name="password" required minlength="8" autocomplete="new-password" /><//>
        <button type="submit" class="btn btn-primary btn-block">Set password</button>
      </form>
    <//>`;
}

/* ---------------- access codes ---------------- */

function Codes(){
  const [codes, setCodes] = useState(null);
  const load = () => api.get('/api/admin/codes').then(r => setCodes(r.codes)).catch(toastError);
  useEffect(() => { load(); }, []);
  if(!codes) return html`<p class="hint">Loading…</p>`;
  const make = async () => {
    const { code } = await api.post('/api/admin/codes', { label: `Created ${new Date().toLocaleDateString()}` });
    toast(`New code: ${code}`, { kind: 'ok', ms: 8000 });
    load();
  };
  return html`
    <p class="hint">Someone with a live code can create their own account from the sign-in screen. They start as ${roleLabel('trainee')}.
      Switch a code off once it has been handed out too widely.</p>
    <div class="row-actions" style=${{ marginBottom: '14px' }}><${AsyncButton} class="btn btn-primary" onClick=${make}><${Icon} name="plus" />New access code<//></div>
    <div class="list">
      ${codes.length ? codes.map(c => html`
        <div key=${c.code} class=${`person${c.active ? '' : ' inactive'}`}>
          <div class="person-main"><code class="code">${c.code}</code><div class="hint">${c.label} · ${c.active ? 'live' : 'off'}</div></div>
          <${AsyncButton} class="btn btn-sm" onClick=${() => api.patch(`/api/admin/codes/${encodeURIComponent(c.code)}`, { active: !c.active }).then(load)}>
            ${c.active ? 'Switch off' : 'Switch on'}<//>
        </div>`) : html`<p class="hint">No codes yet.</p>`}
    </div>`;
}

/* ---------------- audit ---------------- */

function Audit(){
  const team = useStore(s => s.team);
  const [actions, setActions] = useState([]);
  const [filters, setFilters] = useState({ actor: '', action: '', q: '', since: '', until: '' });
  const [rows, setRows] = useState(null);
  const [more, setMore] = useState(false);

  useEffect(() => { api.get('/api/activity/actions').then(r => setActions(r.actions)).catch(() => {}); }, []);

  const query = before => loadActivity({
    limit: 100, before, actor: filters.actor, action: filters.action, q: filters.q,
    since: filters.since ? new Date(`${filters.since}T00:00:00`).toISOString() : '',
    until: filters.until ? new Date(`${filters.until}T23:59:59.999`).toISOString() : ''
  });
  const run = async () => {
    try { const r = await query(); setRows(r.entries); setMore(r.more); } catch (e) { toastError(e); }
  };
  useEffect(() => { run(); }, [filters]);

  const set = k => e => setFilters({ ...filters, [k]: e.currentTarget.value });
  return html`
    <div class="filters">
      <select onChange=${set('actor')} aria-label="Person">
        <option value="">Everyone</option>
        ${team.map(u => html`<option key=${u.id} value=${u.id}>${u.fullName}</option>`)}
      </select>
      <select onChange=${set('action')} aria-label="Action">
        <option value="">Every action</option>
        ${actions.map(a => html`<option key=${a} value=${a}>${a}</option>`)}
      </select>
      <input type="date" onChange=${set('since')} aria-label="From" />
      <input type="date" onChange=${set('until')} aria-label="To" />
      <input type="search" placeholder="Search the text…" onChange=${set('q')} aria-label="Search" />
    </div>
    ${!rows ? html`<p class="hint">Loading…</p>` : html`
      <div class="activity">
        ${rows.length ? rows.map(a => html`
          <div key=${a.id} class="activity-row">
            <div class="activity-when">${fmtWhen(a.at)}</div>
            <div>
              <b>${a.actorName}</b> <span class="activity-action">${a.action.toLowerCase()}</span>
              ${a.detail.text && html`<div class="activity-detail">${a.detail.text}</div>`}
              ${Object.keys(a.detail).some(k => k !== 'text') && html`
                <details class="activity-raw"><summary>Recorded detail</summary><pre>${JSON.stringify(a.detail, null, 2)}</pre></details>`}
            </div>
          </div>`) : html`<p class="hint">Nothing matches.</p>`}
      </div>
      ${more && html`<${AsyncButton} class="btn btn-block" onClick=${async () => {
        const r = await query(rows[rows.length - 1].id); setRows([...rows, ...r.entries]); setMore(r.more);
      }}>Load older<//>`}`}`;
}

/* ---------------- health ---------------- */

function Health(){
  const [h, setH] = useState(null);
  const load = () => api.get('/api/admin/health').then(setH).catch(toastError);
  useEffect(() => { load(); }, []);
  if(!h) return html`<p class="hint">Loading…</p>`;
  const disk = h.storage.disk;
  const lowDisk = disk && disk.freeBytes < 2 * 1024 ** 3;
  const lastBackup = h.backups[0];
  const staleBackup = !lastBackup || Date.now() - new Date(lastBackup.at) > 36 * 3600000;
  return html`
    <div class="health">
      <div class="health-row"><span>Server running since</span><b>${fmtWhen(h.startedAt)}</b></div>
      <div class="health-row"><span>Node.js</span><b>${h.node}</b></div>
      <div class="health-row"><span>Open apps (live connections)</span><b>${h.liveConnections}</b></div>
      <div class="health-row"><span>Active in the last 15 min</span><b>${h.activeRecently.join(', ') || 'nobody'}</b></div>
      <div class="health-row"><span>Jobs</span><b>${h.counts.openJobs} open of ${h.counts.jobs}</b></div>
      <div class="health-row"><span>People</span><b>${plural(h.counts.users, 'active account')}</b></div>
      <div class="health-row"><span>Database</span><b>${fmtBytes(h.storage.databaseBytes)}</b></div>
      <div class="health-row"><span>Drawing files</span><b>${fmtBytes(h.storage.filesBytes)} (${plural(h.counts.blueprints, 'scan')})</b></div>
      ${disk && html`<div class=${`health-row${lowDisk ? ' warn' : ''}`}><span>Disk free</span><b>${fmtBytes(disk.freeBytes)} of ${fmtBytes(disk.totalBytes)}</b></div>`}
      <div class=${`health-row${staleBackup ? ' warn' : ''}`}><span>Last backup</span>
        <b>${lastBackup ? `${fmtWhen(lastBackup.at)} (${fmtBytes(lastBackup.bytes)})` : 'none yet'}</b></div>
    </div>
    ${staleBackup && html`<p class="error-text">No backup in the last day and a half. Check the server's log.</p>`}
    <button class="btn" onClick=${load}>Refresh</button>`;
}
