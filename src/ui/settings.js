/** Settings: name, AI provider, keys. */

import { getAiProvider, getApiKey, getGeminiModel, getOpenRouterKey, getOpenRouterModel, setApiKey, setGeminiModel, setOpenRouterKey, setOpenRouterModel, hasPersonalApiKey, hasPersonalOpenRouterKey,
         getLocalAiUrl, getLocalAiKey, getLocalAiFallback, setLocalAiFallback, localAiUrlProblem, normalizeLocalAiUrl } from '../ai/keys.js';
import { getShopSetting, setShopSetting, SHOP_KEYS } from '../db/shopSettings.js';
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

/**
 * The shop's own server, as each person sees it: a status line and the
 * one per-device choice left (the OpenRouter backup). Nothing to type --
 * the address is a shop setting and the credential is their sign-in.
 */
function localAiSectionHtml(provider){
  const url = getLocalAiUrl();
  const fromShop = !!getShopSetting(SHOP_KEYS.LOCAL_SERVER_URL);
  const legacy = !!(localStorage.getItem('awt_localAiUrl') || getLocalAiKey());
  const fallback = getLocalAiFallback();
  const hasOr = hasPersonalOpenRouterKey();
  return `
    <div id="localAiSection" ${provider!=='local'?'class="hidden"':''}>
      <div class="section-title" style="margin-top:0;">Local AI</div>
      <div class="bp-hint" style="margin-bottom:10px;">
        The AI running on the shop desktop. No usage limits and nothing leaves your own machine -- but the desktop
        has to be on. Nothing to set up on this device: it uses the shop's server address and your own sign-in.
      </div>
      ${url
        ? `<div class="bp-file-chip">Ready: ${escapeHtml(url)}${fromShop ? '' : ' (saved on this device)'}</div>`
        : `<div class="bp-file-chip">Not set up for the shop yet -- ${isAdmin() ? 'set the address under Shop Server below.' : 'ask an admin to set the server address.'}</div>`}
      <label class="bp-hint" style="display:flex;gap:10px;align-items:flex-start;margin:12px 0 4px;cursor:pointer;">
        <input type="checkbox" id="localAiFallback" ${fallback ? 'checked' : ''} style="margin-top:2px;">
        <span><b>Use OpenRouter when the local AI is off.</b> Scans keep working when the desktop is down, and say
        when they did this. ${hasOr ? 'An OpenRouter key is saved on this device.'
          : 'Needs an OpenRouter key -- none is saved on this device, so this does nothing yet.'}</span>
      </label>
      ${legacy ? `<div class="fab-row"><button type="button" class="btn btn-outline btn-block" data-action="clear-local-ai">Remove Old Per-Device Local AI Settings</button></div>` : ''}
    </div>`;
}

/**
 * Admin only: the shop's server, set once for every device. Replaces
 * typing an address and access key into each phone -- the address lives
 * in shop_settings, and each person's own sign-in is the credential.
 * Also where new blueprint files go, shop-wide, so every device agrees.
 */
function shopServerSectionHtml(){
  if(!(AUTH_ENABLED && isAdmin())) return '';
  const url = getShopSetting(SHOP_KEYS.LOCAL_SERVER_URL) || '';
  const def = getShopSetting(SHOP_KEYS.DEFAULT_AI_PROVIDER) || 'openrouter';
  const storage = getShopSetting(SHOP_KEYS.BLUEPRINT_STORAGE) || 'supabase';
  return `
    <div class="section-title">Shop Server</div>
    <div class="bp-hint" style="margin-bottom:10px;">
      Set once here, used by every signed-in device -- nobody else types anything. The address is the desktop's
      <b>https</b> Tailscale one, ending in <b>.ts.net</b>. People reach it with their own tracker sign-in, so
      deactivating an account on the Team screen cuts off its access to the server too.
    </div>
    <form id="shopServerForm">
      <div class="field">
        <label>Server Address</label>
        <input type="url" name="serverUrl" placeholder="https://justin-desktop.your-tailnet.ts.net" autocomplete="off"
          spellcheck="false" inputmode="url" value="${escapeHtml(url)}">
      </div>
      <div class="field">
        <label>AI For Everyone</label>
        <select name="defaultProvider">
          <option value="local" ${def==='local'?'selected':''}>Local AI (the shop's server)</option>
          <option value="openrouter" ${def==='openrouter'?'selected':''}>OpenRouter</option>
          <option value="gemini" ${def==='gemini'?'selected':''}>Google Gemini</option>
        </select>
        <div class="bp-hint">What every device uses unless someone picks otherwise above. OpenRouter and Gemini still
          need a key on each device; Local AI needs nothing.</div>
      </div>
      <label class="bp-hint" style="display:flex;gap:10px;align-items:flex-start;margin:4px 0 10px;cursor:pointer;">
        <input type="checkbox" name="blueprintLocal" ${storage==='local' ? 'checked' : ''} style="margin-top:2px;">
        <span><b>Keep new blueprint files on the shop's server.</b> Saved to a folder on the desktop, one per job,
          instead of cloud storage. Drawings already in the cloud stay there and still open.</span>
      </label>
      <div class="fab-row">
        <button type="submit" class="btn btn-primary btn-block">Save For The Whole Shop</button>
      </div>
    </form>`;
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
      Powers the AI Assistant and Blueprint extraction. Google Gemini and OpenRouter are cloud services;
      Local AI is the shop's own server, so drawings stay on a machine you own. Only the selected provider is
      actually used -- the other keys can sit unused.
    </div>
    <div class="chip-row" id="providerChips" style="margin-bottom:14px;">
      <button class="chip ${provider==='gemini'?'active':''}" data-action="set-ai-provider" data-provider="gemini">Google Gemini</button>
      <button class="chip ${provider==='openrouter'?'active':''}" data-action="set-ai-provider" data-provider="openrouter">OpenRouter</button>
      <button class="chip ${provider==='local'?'active':''}" data-action="set-ai-provider" data-provider="local">Local AI</button>
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
      <div class="field">
        <label>Model</label>
        <select id="gmModelSelect" data-action="set-gemini-model">
          <option value="${escapeHtml(getGeminiModel())}" selected>${escapeHtml(getGeminiModel())}</option>
        </select>
        <div class="bp-hint">
          A model can be perfectly valid and still refuse to work -- "currently experiencing high demand" is
          about the hour, not your key. Scans retry and then move to another model on their own; if one keeps
          being busy, load the list and pick a different one.
        </div>
        <div class="fab-row">
          <button type="button" class="btn btn-outline btn-sm" data-action="load-gemini-models">
            Load models from Google
          </button>
        </div>
      </div>
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

    ${localAiSectionHtml(provider)}
    ${shopServerSectionHtml()}

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
  const shopForm = document.getElementById('shopServerForm');
  if(shopForm){
    shopForm.addEventListener('submit', async e=>{
      e.preventDefault();
      const fd = new FormData(e.target);
      const url = normalizeLocalAiUrl(fd.get('serverUrl'));
      const problem = url ? localAiUrlProblem(url) : null;
      if(problem){ showToast(problem, 8000); return; }
      const btn = shopForm.querySelector('button[type="submit"]');
      if(btn){ btn.disabled = true; btn.textContent = 'Saving...'; }
      try {
        await setShopSetting(SHOP_KEYS.LOCAL_SERVER_URL, url);
        await setShopSetting(SHOP_KEYS.DEFAULT_AI_PROVIDER, fd.get('defaultProvider') || 'openrouter');
        await setShopSetting(SHOP_KEYS.BLUEPRINT_STORAGE, fd.get('blueprintLocal') ? 'local' : 'supabase');
        closeModal();
        showToast('Saved for the whole shop. Other devices pick it up the next time they open the app.', 6000);
      } catch (err) {
        console.error('shop settings save failed', err);
        if(btn){ btn.disabled = false; btn.textContent = 'Save For The Whole Shop'; }
        showToast(err.isPermission ? 'Only an admin can change shop settings.' : (err.message || 'Could not save'), 6000);
      }
    });
  }
  const fallbackBox = document.getElementById('localAiFallback');
  if(fallbackBox){
    // Saves on click: a checkbox that needs a separate Save is one people
    // think they set.
    fallbackBox.addEventListener('change', ()=>{
      setLocalAiFallback(fallbackBox.checked);
      showToast(fallbackBox.checked ? 'OpenRouter will cover for the local AI when it\'s off'
                                    : 'Scans will fail while the local AI is off');
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
    ? `<div class="bp-hint" style="margin-top:8px;">${r.provider === 'Local AI' ? 'Models installed on the local AI' : 'Models this key can use for drawings'}:<br>
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

/**
 * Fills the Gemini model list with what this key can actually see.
 *
 * Hardcoding one model is what left a scan stuck when that model got
 * busy: "gemini-3.6-flash is experiencing high demand" has no fix in the
 * app if the app only knows one model. Google will say which ones this
 * key can use, so it asks rather than guesses -- the same reason the
 * OpenRouter list is loaded rather than written down.
 */
export async function loadGeminiModels(){
  const select = document.getElementById('gmModelSelect');
  if(!select) return;
  const key = getApiKey();
  if(!key){ showToast('Add a Gemini key first, then load the list'); return; }
  select.disabled = true;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
    const data = await res.json();
    if(!res.ok){
      const msg = (data && data.error && data.error.message) || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    const usable = (data.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => String(m.name || '').replace(/^models\//, ''))
      // Drop the ones that cannot read a drawing however good they are.
      .filter(id => !/-tts$|embedding|aqa|imagen|veo/i.test(id))
      .sort();
    if(!usable.length) throw new Error('this key has no models that can read a drawing');

    const current = getGeminiModel();
    select.innerHTML = usable.map(id =>
      `<option value="${escapeHtml(id)}"${id === current ? ' selected' : ''}>${escapeHtml(id)}</option>`).join('');
    showToast(usable.includes(current)
      ? `${usable.length} models available. "${current}" is still one of them.`
      : `"${current}" is not on this key's list -- pick one above.`, 5000);
  } catch (e) {
    showToast(`Could not load Google's model list: ${String(e && e.message || e)}`, 6000);
  } finally {
    select.disabled = false;
  }
}
