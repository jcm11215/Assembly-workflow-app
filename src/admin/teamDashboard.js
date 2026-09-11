/**
 * Team management -- the admin-only screen for changing what people can
 * do, and for switching off an account when someone leaves.
 *
 * This is the ONLY way roles change. block_self_promote (rls.sql)
 * rejects any role change whose caller is not already a signed-in
 * admin, which includes the SQL editor, so there is no back door to
 * fall back on and this screen has to work.
 *
 * Deactivating is deliberately not deleting: profiles are referenced by
 * every job, note and blocker the person ever touched, and the audit
 * trail has to keep resolving those names.
 */
import { escapeHtml } from '../utils/dom.js';
import { openModal, refreshOpenModal } from '../ui/components/modal.js';
import { showToast } from '../ui/components/toast.js';
import { listProfiles, updateProfile, getCachedProfile } from '../auth/profileService.js';
import { isAdmin } from '../auth/permissions.js';

const ROLES = ['assembler', 'lead', 'admin'];

const ROLE_BLURB = {
  assembler: 'Updates jobs assigned to them, works checklists, raises blockers.',
  lead: 'All of the above, plus creating and assigning jobs, resolving blockers, approving blueprints.',
  admin: 'Everything, plus managing this screen and deleting records.'
};

let roster = [];
let loadError = null;

function rowHtml(p){
  const self = getCachedProfile();
  const isSelf = self && self.id === p.id;
  const chips = ROLES.map(r => `
    <button class="chip ${p.role === r ? 'active' : ''}"
            data-action="team-set-role" data-id="${p.id}" data-role="${r}"
            ${p.role === r || isSelf ? 'disabled' : ''}>${r}</button>`).join('');

  return `
    <div class="eng-row">
      <div class="eng-label">
        ${escapeHtml(p.full_name)}
        ${isSelf ? ' <span class="cf cf-med">YOU</span>' : ''}
        ${p.active ? '' : ' <span class="cf cf-conflict">INACTIVE</span>'}
      </div>
      <div class="eng-val">
        <div class="chip-row">${chips}</div>
        <div class="eng-meta">
          ${isSelf
            ? 'You cannot change your own role -- ask another admin.'
            : escapeHtml(ROLE_BLURB[p.role] || '')}
        </div>
        <div class="fab-row" style="margin-top:6px;">
          <button class="btn btn-outline" data-action="team-toggle-active"
                  data-id="${p.id}" data-active="${p.active ? '1' : '0'}"
                  ${isSelf ? 'disabled' : ''}>
            ${p.active ? 'Deactivate' : 'Reactivate'}
          </button>
        </div>
      </div>
    </div>`;
}

export function teamDashboardHtml(){
  if(!isAdmin()){
    return `
    <div class="modal-sheet">
      <div class="modal-title">Team <button class="modal-close" data-close-overlay>&times;</button></div>
      <div class="bp-hint">Only an admin can manage the team.</div>
    </div>`;
  }

  const body = loadError
    ? `<div class="bp-hint">Could not load the team: ${escapeHtml(loadError)}</div>`
    : roster.length
      ? roster.map(rowHtml).join('')
      : `<div class="bp-hint">Loading the team...</div>`;

  return `
  <div class="modal-sheet">
    <div class="modal-title">Team <button class="modal-close" data-close-overlay>&times;</button></div>
    <div class="bp-hint" style="margin-bottom:10px;">
      Everyone who has created an account. New accounts start as <b>assembler</b>; tap a role to change it.
      Deactivating keeps the person's history intact but takes away what they can do.
    </div>
    ${body}
    <div class="fab-row" style="margin-top:10px;">
      <button class="btn btn-outline btn-block" data-action="team-refresh">Refresh</button>
    </div>
  </div>`;
}

async function loadRoster(){
  try {
    roster = await listProfiles();
    loadError = null;
  } catch (e) {
    console.error('team roster load failed', e);
    loadError = e.message || 'unknown error';
  }
}

export async function openTeamDashboard(){
  roster = []; loadError = null;
  openModal(teamDashboardHtml(), teamDashboardHtml);
  await loadRoster();
  refreshOpenModal();
}

export async function refreshTeamDashboard(){
  await loadRoster();
  refreshOpenModal();
}

async function applyPatch(id, patch, describe){
  const person = roster.find(p => p.id === id);
  try {
    const updated = await updateProfile(id, patch);
    // The server's row is the truth -- a trigger may have refused part
    // of this even though the request itself succeeded.
    if(updated) roster = roster.map(p => (p.id === id ? updated : p));
    refreshOpenModal();
    showToast(describe(person));
  } catch (e) {
    console.error('team update failed', e);
    showToast(e.isPermission
      ? 'You do not have permission to make that change.'
      : (e.message || 'Could not save that change'), 5000);
  }
}

/** Wired from the global event router; handles the team- namespace. */
export function handleTeamAction(action, btn){
  if(action === 'team-refresh'){ refreshTeamDashboard(); return; }

  const id = btn.getAttribute('data-id');
  if(!id) return;

  if(action === 'team-set-role'){
    const role = btn.getAttribute('data-role');
    if(!ROLES.includes(role)) return;
    applyPatch(id, { role }, p => `${p ? p.full_name : 'That person'} is now ${role}`);
    return;
  }

  if(action === 'team-toggle-active'){
    const active = btn.getAttribute('data-active') !== '1';
    applyPatch(id, { active }, p =>
      `${p ? p.full_name : 'That account'} ${active ? 'reactivated' : 'deactivated'}`);
  }
}
