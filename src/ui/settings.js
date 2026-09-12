/** Settings: name, AI provider, keys. */

import { getAiProvider, getApiKey, getOpenRouterKey, getOpenRouterModel, setApiKey, setOpenRouterKey, setOpenRouterModel, hasPersonalApiKey, hasPersonalOpenRouterKey } from '../ai/keys.js';
import { getUserName, setUserName } from '../auth/identity.js';
import { AUTH_ENABLED, currentUser, signOut } from '../auth/authService.js';
import { getCachedProfile } from '../auth/profileService.js';
import { isAdmin, roleLabel } from '../auth/permissions.js';
import { supabaseReady } from '../db/config.js';
import { closeModal, openModal } from './components/modal.js';
import { showToast } from './components/toast.js';
import { describeGeminiKeyShape } from '../ai/diagnose.js';
import { escapeHtml } from '../utils/dom.js';


/* ================= SETTINGS ================= */
function accountSectionHtml(){
  const user = currentUser();
  const profile = getCachedProfile();
  return `
    <div class="section-title" style="margin-top:0;">Account</div>
    <div class="bp-hint" style="margin-bottom:10px;">
      Signed in as <b>${escapeHtml(profile ? profile.full_name : (user ? user.email : 'Unknown'))}</b>
      ${profile ? ` &middot; ${escapeHtml(roleLabel(profile.role))}` : ''}.
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

    <!-- The app's own error messages are a paraphrase of the provider's,
         and a paraphrase is a guess. This asks the provider directly and
         prints what it says, so a bad key, the wrong KIND of key, a model
         that does not exist and a blocked connection stop looking alike. -->
    <div class="fab-row" style="margin-bottom:6px;">
      <button type="button" class="btn btn-outline btn-block" data-action="test-ai-provider">
        &#128269; Test Connection
      </button>
    </div>
    <div id="aiTestResult"></div>

    <div id="geminiSection" ${provider!=='gemini'?'class="hidden"':''}>
      <div class="section-title" style="margin-top:0;">Google Gemini API Key</div>
      <div class="bp-hint" style="margin-bottom:10px;">
        Get one at <b>aistudio.google.com</b> (Get API Key, no credit card needed). The key is stored only in this
        browser and sent directly to Google with each request. The free tier has a request-per-minute cap, so if
        you hit a rate-limit error during a busy stretch, just wait a minute and try again -- or switch to
        OpenRouter above as a backup.
      </div>
      ${hasPersonalApiKey()
        ? `<div class="bp-file-chip">Key saved: ${escapeHtml(masked)}</div>`
        : `<div class="bp-file-chip">No key set on this device yet.</div>`}
      <form id="apiKeyForm">
        <div class="field">
          <label>API Key</label>
          <input type="text" name="apiKey" placeholder="AIzaSy..." autocomplete="off" spellcheck="false" value="">
        </div>
        <div class="fab-row">
          <button type="submit" class="btn btn-primary btn-block">Save Key</button>
        </div>
      </form>
      ${hasPersonalApiKey() ? `<div class="fab-row"><button type="button" class="btn btn-outline btn-block" data-action="clear-api-key">Remove Key</button></div>` : ''}
    </div>

    <div id="openrouterSection" ${provider!=='openrouter'?'class="hidden"':''}>
      <div class="section-title" style="margin-top:0;">OpenRouter API Key</div>
      <div class="bp-hint" style="margin-bottom:10px;">
        Get a key at <b>openrouter.ai/keys</b> (some usage is free; most models are pay-as-you-go, usually cents
        per scan). The key is stored only in this browser and sent directly to OpenRouter with each request.
      </div>
      ${hasPersonalOpenRouterKey()
        ? `<div class="bp-file-chip">Key saved: ${escapeHtml(orMasked)}</div>`
        : `<div class="bp-file-chip">No key set on this device yet.</div>`}
      <form id="openrouterKeyForm">
        <div class="field">
          <label>API Key</label>
          <input type="text" name="openrouterKey" placeholder="sk-or-v1-..." autocomplete="off" spellcheck="false" value="">
        </div>
        <div class="field">
          <label>Model</label>
          <select name="openrouterModel" id="orModelSelect">
            <option value="openrouter/free" ${orModel==='openrouter/free'?'selected':''}>Auto (Free) -- picks a free model that can read images, recommended</option>
            <option value="thinkingmachines/inkling-small:free" ${orModel==='thinkingmachines/inkling-small:free'?'selected':''}>Inkling Small (Free, vision)</option>
            <option value="thinkingmachines/inkling:free" ${orModel==='thinkingmachines/inkling:free'?'selected':''}>Inkling (Free, vision, larger)</option>
            <option value="__other__" ${!['openrouter/free','thinkingmachines/inkling-small:free','thinkingmachines/inkling:free'].includes(orModel)?'selected':''}>Other (type a model ID)</option>
          </select>
          <input type="text" name="openrouterModelOther" id="orModelOther" placeholder="e.g. google/gemini-2.0-flash-001"
            value="${!['openrouter/free','thinkingmachines/inkling-small:free','thinkingmachines/inkling:free'].includes(orModel)?escapeHtml(orModel):''}"
            style="margin-top:8px;${!['openrouter/free','thinkingmachines/inkling-small:free','thinkingmachines/inkling:free'].includes(orModel)?'':'display:none;'}">
          <div class="bp-hint">
            These are starting points, not a verified list -- a model ID that no longer exists makes every scan
            fail before it starts, so use <b>Load models from OpenRouter</b> to replace them with what your key
            can actually use today. Free vision models come and go. A paid model works too, but spends your
            OpenRouter balance per scan.
          </div>
          <div class="fab-row">
            <button type="button" class="btn btn-outline btn-sm" data-action="load-openrouter-models">
              Load models from OpenRouter
            </button>
          </div>
        </div>
        <div class="fab-row">
          <button type="submit" class="btn btn-primary btn-block">Save</button>
        </div>
      </form>
      ${hasPersonalOpenRouterKey() ? `<div class="fab-row"><button type="button" class="btn btn-outline btn-block" data-action="clear-openrouter-key">Remove Key</button></div>` : ''}
    </div>

    ${AUTH_ENABLED && isAdmin() ? `
    <div class="section-title">Admin</div>
    <div class="bp-hint" style="margin-bottom:10px;">
      The team and what each person can do, the shop access code, a full history of what changed and who
      changed it, and the diagnostic panels.
    </div>
    <div class="fab-row">
      <button type="button" class="btn btn-primary btn-block" data-action="open-admin">Open Admin Dashboard</button>
    </div>` : ''}

    <div class="section-title">System Health</div>
    <div class="fab-row">
      <button type="button" class="btn btn-outline btn-block" data-action="open-health">Open Health Dashboard</button>
    </div>
  </div>`;
}

export function openSettingsModal(){
  openModal(settingsModalHtml(), settingsModalHtml);   // refresher so refreshOpenModal() works here too
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
      // Saved either way -- it is their key and a format check is a
      // heuristic, not an authority. But say so now rather than letting
      // them find out from a failed scan, because the wrong KIND of
      // Google credential produces an error that reads like a bug in
      // this app instead of like a key that needs replacing.
      const shape = describeGeminiKeyShape(key);
      closeModal();
      showToast(shape.ok ? 'API key saved to this browser' : `Saved, but: ${shape.why}`,
        shape.ok ? 3000 : 10000);
    });
  }
  const orForm = document.getElementById('openrouterKeyForm');
  const orModelSelect = document.getElementById('orModelSelect');
  const orModelOther = document.getElementById('orModelOther');
  if(orModelSelect && orModelOther){
    orModelSelect.addEventListener('change', ()=>{
      orModelOther.style.display = orModelSelect.value === '__other__' ? '' : 'none';
      if(orModelSelect.value === '__other__') orModelOther.focus();
    });
  }
  if(orForm){
    orForm.addEventListener('submit', e=>{
      e.preventDefault();
      const fd = new FormData(e.target);
      const key = (fd.get('openrouterKey')||'').trim();
      const selected = (fd.get('openrouterModel')||'').trim();
      const model = selected === '__other__' ? (fd.get('openrouterModelOther')||'').trim() : selected;
      if(!key){ showToast('Enter a key first'); return; }
      setOpenRouterKey(key);
      if(model) setOpenRouterModel(model);
      closeModal();
      showToast('OpenRouter key saved to this browser');
    });
  }
}

/**
 * Runs the provider diagnostic and prints it into the Settings sheet.
 *
 * Every line shows the provider's own sentence alongside the
 * interpretation, so if the interpretation is wrong the raw evidence is
 * still there to read -- which is the whole point. Steps depend on the
 * ones before them, so the first failure is the thing to fix and the
 * rest are not run or not meaningful.
 */
export async function testAiProvider(){
  const out = document.getElementById('aiTestResult');
  if(!out) return;
  out.innerHTML = `<div class="bp-hint">Testing the connection...</div>`;

  let r;
  try {
    const { diagnoseActiveProvider } = await import('../ai/diagnose.js');
    r = await diagnoseActiveProvider();
  } catch (e) {
    out.innerHTML = `<div class="bp-file-chip">Could not run the test: ${escapeHtml(String(e && e.message || e))}</div>`;
    return;
  }

  const rows = r.steps.map(s => `
    <div class="ai-test-row ${s.ok ? 'ok' : 'bad'}">
      <div class="ai-test-head">${s.ok ? '&#10003;' : '&#10007;'} ${escapeHtml(s.name)}</div>
      <div class="ai-test-detail">${escapeHtml(s.detail)}</div>
      ${s.raw ? `<div class="ai-test-raw">${escapeHtml(s.raw)}</div>` : ''}
    </div>`).join('');

  const models = (!r.ok && r.models && r.models.length)
    ? `<div class="bp-hint" style="margin-top:8px;">Models this key can use for drawings:<br>
         <span class="ai-test-raw">${escapeHtml(r.models.slice(0, 10).join('\n'))}</span></div>`
    : '';

  out.innerHTML = `
    <div class="ai-test">
      <div class="ai-test-title">${escapeHtml(r.provider)} &mdash; ${r.ok ? 'working' : 'not working'}</div>
      ${rows}
      ${r.ok ? '' : `<div class="bp-hint" style="margin-top:8px;">
        Fix the first &#10007; above -- each step needs the ones before it.</div>`}
      ${models}
    </div>`;
}

/**
 * Replaces the model dropdown with what OpenRouter actually offers right
 * now, filtered to models that can read an image.
 *
 * The hardcoded options were three guesses that claimed to be verified.
 * A model ID that no longer exists fails every scan before it starts,
 * and the error ("no endpoints found") gives no hint that the ID is the
 * problem -- so the list has to come from the provider, not from a
 * comment written months ago.
 */
export async function loadOpenRouterModels(){
  const select = document.getElementById('orModelSelect');
  if(!select) return;
  const previous = select.value;
  select.disabled = true;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/models');
    if(!res.ok) throw new Error(`OpenRouter returned HTTP ${res.status}`);
    const { data } = await res.json();
    const vision = (data || [])
      .filter(m => ((m.architecture && m.architecture.input_modalities) || []).includes('image'))
      .map(m => ({
        id: m.id,
        name: m.name || m.id,
        free: /:free$/.test(m.id) || !!(m.pricing && Number(m.pricing.prompt) === 0)
      }))
      // Free first -- that is what most people want here -- then by name.
      .sort((a, b) => (b.free - a.free) || a.name.localeCompare(b.name));

    if(!vision.length) throw new Error('OpenRouter listed no models that can read images');

    const current = getOpenRouterModel();
    select.innerHTML = vision.map(m =>
      `<option value="${escapeHtml(m.id)}"${m.id === current ? ' selected' : ''}>${escapeHtml(m.name)}${m.free ? ' -- free' : ''}</option>`
    ).join('') + `<option value="__other__">Other (type a model ID)</option>`;

    // Say plainly when the saved model is not on the live list, because
    // that is the whole reason for this button.
    const stillThere = vision.some(m => m.id === current);
    showToast(stillThere
      ? `${vision.length} models that can read drawings (${vision.filter(m => m.free).length} free). Your saved model is still available.`
      : `Your saved model "${current}" is NOT in OpenRouter's list any more -- that is why scans fail. Pick one above and Save.`,
      stillThere ? 4000 : 9000);
    if(!stillThere) select.selectedIndex = 0;
  } catch (e) {
    select.value = previous;
    showToast(`Could not load the model list: ${String(e && e.message || e)}`, 6000);
  } finally {
    select.disabled = false;
  }
}
