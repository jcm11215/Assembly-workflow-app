/** Settings: name, AI provider, keys. */

import { getAiProvider, getApiKey, getOpenRouterKey, getOpenRouterModel, setApiKey, setOpenRouterKey, setOpenRouterModel } from '../ai/keys.js';
import { getUserName, setUserName } from '../auth/identity.js';
import { AUTH_ENABLED, currentUser, signOut } from '../auth/authService.js';
import { getCachedProfile } from '../auth/profileService.js';
import { supabaseReady } from '../db/config.js';
import { closeModal, openModal } from './components/modal.js';
import { showToast } from './components/toast.js';
import { escapeHtml } from '../utils/dom.js';


/* ================= SETTINGS ================= */
function accountSectionHtml(){
  const user = currentUser();
  const profile = getCachedProfile();
  return `
    <div class="section-title" style="margin-top:0;">Account</div>
    <div class="bp-hint" style="margin-bottom:10px;">
      Signed in as <b>${escapeHtml(profile ? profile.full_name : (user ? user.email : 'Unknown'))}</b>
      ${profile ? ` &middot; role: ${escapeHtml(profile.role)}` : ''}.
    </div>
    <div class="fab-row"><button type="button" class="btn btn-outline btn-block" data-action="account-sign-out">Sign Out</button></div>
  `;
}

export function settingsModalHtml(){
  const key = getApiKey();
  const masked = key ? (key.slice(0,7) + '...' + key.slice(-4)) : '';
  const orKey = getOpenRouterKey();
  const orMasked = orKey ? (orKey.slice(0,8) + '...' + orKey.slice(-4)) : '';
  const orModel = getOpenRouterModel();
  const provider = getAiProvider();
  const uname = getUserName();
  return `
  <div class="modal-sheet">
    <div class="modal-title">Settings <button class="modal-close" data-close-overlay>&times;</button></div>

    ${AUTH_ENABLED ? accountSectionHtml() : `
    <div class="section-title" style="margin-top:0;">Your Name</div>
    <div class="bp-hint" style="margin-bottom:10px;">
      Shown on notes, blockers, and stage moves so it's clear who did what. Not a login -- no password, nothing
      verified.
    </div>
    ${uname ? `<div class="bp-file-chip">Currently: ${escapeHtml(uname)}</div>` : ''}
    <form id="nameFormSettings">
      <div class="field"><label>Your Name</label><input name="username" placeholder="e.g. D. Reyes" autocomplete="off" value="${escapeHtml(uname)}"></div>
      <div class="fab-row"><button type="submit" class="btn btn-primary btn-block">Save Name</button></div>
    </form>`}

    <div class="section-title">Shared Data</div>
    <div class="bp-hint" style="margin-bottom:10px;">
      Jobs, blockers, and notes are stored centrally and shared live across every device automatically -- there's
      nothing to connect or configure here. ${supabaseReady() ? 'Connected.' : 'Not connected -- if data is not loading, this app needs its server-side connection checked (contact whoever set this up).'}
    </div>

    <div class="section-title">AI Provider</div>
    <div class="bp-hint" style="margin-bottom:10px;">
      Powers the AI Assistant and Blueprint extraction. Google Gemini is free and the default; OpenRouter is a
      backup you can switch to if Gemini's free-tier limit gets hit, or to try a different model for reading
      blueprints. Only the selected provider is actually used -- the other key can sit unused.
    </div>
    <div class="chip-row" id="providerChips" style="margin-bottom:14px;">
      <button class="chip ${provider==='gemini'?'active':''}" data-action="set-ai-provider" data-provider="gemini">Google Gemini</button>
      <button class="chip ${provider==='openrouter'?'active':''}" data-action="set-ai-provider" data-provider="openrouter">OpenRouter</button>
    </div>

    <div id="geminiSection" ${provider!=='gemini'?'class="hidden"':''}>
      <div class="section-title" style="margin-top:0;">Google Gemini API Key</div>
      <div class="bp-hint" style="margin-bottom:10px;">
        Get one at <b>aistudio.google.com</b> (Get API Key, no credit card needed). The key is stored only in this
        browser and sent directly to Google with each request. The free tier has a request-per-minute cap, so if
        you hit a rate-limit error during a busy stretch, just wait a minute and try again -- or switch to
        OpenRouter above as a backup.
      </div>
      ${key ? `<div class="bp-file-chip">Current key: ${escapeHtml(masked)}</div>` : ''}
      <form id="apiKeyForm">
        <div class="field">
          <label>API Key</label>
          <input type="text" name="apiKey" placeholder="AIzaSy..." autocomplete="off" spellcheck="false" value="">
        </div>
        <div class="fab-row">
          <button type="submit" class="btn btn-primary btn-block">Save Key</button>
        </div>
      </form>
      ${key ? `<div class="fab-row"><button type="button" class="btn btn-outline btn-block" data-action="clear-api-key">Remove Saved Key</button></div>` : ''}
    </div>

    <div id="openrouterSection" ${provider!=='openrouter'?'class="hidden"':''}>
      <div class="section-title" style="margin-top:0;">OpenRouter API Key</div>
      <div class="bp-hint" style="margin-bottom:10px;">
        Get a key at <b>openrouter.ai/keys</b> (some usage is free; most models are pay-as-you-go, usually cents
        per scan). The key is stored only in this browser and sent directly to OpenRouter with each request.
      </div>
      ${orKey ? `<div class="bp-file-chip">Current key: ${escapeHtml(orMasked)}</div>` : ''}
      <form id="openrouterKeyForm">
        <div class="field">
          <label>API Key</label>
          <input type="text" name="openrouterKey" placeholder="sk-or-v1-..." autocomplete="off" spellcheck="false" value="">
        </div>
        <div class="field">
          <label>Model</label>
          <input type="text" name="openrouterModel" placeholder="google/gemini-2.0-flash-001" value="${escapeHtml(orModel)}">
          <div class="bp-hint">Must support image input for Blueprint extraction to work. Good options: <b>google/gemini-2.0-flash-001</b>, <b>anthropic/claude-3.5-sonnet</b>, <b>openai/gpt-4o</b>. See openrouter.ai/models for more.</div>
        </div>
        <div class="fab-row">
          <button type="submit" class="btn btn-primary btn-block">Save</button>
        </div>
      </form>
      ${orKey ? `<div class="fab-row"><button type="button" class="btn btn-outline btn-block" data-action="clear-openrouter-key">Remove Saved Key</button></div>` : ''}
    </div>

    <div class="section-title">Data Migration</div>
    <div class="bp-hint" style="margin-bottom:10px;">
      Parity verification and cutover controls for the relational database migration.
      Read-only checks -- running them changes nothing.
    </div>
    <div class="fab-row">
      <button type="button" class="btn btn-outline btn-block" data-action="open-migration">Open Migration Diagnostics</button>
    </div>

    <div class="section-title">System Health</div>
    <div class="fab-row">
      <button type="button" class="btn btn-outline btn-block" data-action="open-health">Open Health Dashboard</button>
    </div>
  </div>`;
}

export function openSettingsModal(){
  openModal(settingsModalHtml());
  const nameForm = document.getElementById('nameFormSettings');
  if(nameForm){
    nameForm.addEventListener('submit', e=>{
      e.preventDefault();
      const fd = new FormData(e.target);
      const name = (fd.get('username')||'').trim();
      setUserName(name);
      closeModal();
      showToast(name ? `Name saved: ${name}` : 'Name cleared');
    });
  }
  const form = document.getElementById('apiKeyForm');
  if(form){
    form.addEventListener('submit', e=>{
      e.preventDefault();
      const fd = new FormData(e.target);
      const key = (fd.get('apiKey')||'').trim();
      if(!key){ showToast('Enter a key first'); return; }
      setApiKey(key);
      closeModal();
      showToast('API key saved to this browser');
    });
  }
  const orForm = document.getElementById('openrouterKeyForm');
  if(orForm){
    orForm.addEventListener('submit', e=>{
      e.preventDefault();
      const fd = new FormData(e.target);
      const key = (fd.get('openrouterKey')||'').trim();
      const model = (fd.get('openrouterModel')||'').trim();
      if(!key){ showToast('Enter a key first'); return; }
      setOpenRouterKey(key);
      if(model) setOpenRouterModel(model);
      closeModal();
      showToast('OpenRouter key saved to this browser');
    });
  }
}
