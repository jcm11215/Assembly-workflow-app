/**
 * Settings: your account, and -- for admins -- which AI reads drawings
 * and answers the assistant. AI keys are kept on the server, so they are
 * set once here rather than on every tablet.
 */
import { html, useEffect, useState } from '../vendor/index.js';
import { useStore } from '../lib/store.js';
import { api } from '../lib/api.js';
import { signOut, changePassword } from '../lib/actions.js';
import { useCan } from '../lib/permissions.js';
import { roleLabel, ROLE_INFO } from '../../shared/roles.js';
import { Field, Select, AsyncButton, submitting } from '../ui/kit.js';
import { Sheet, toast, toastError } from '../ui/overlays.js';

export function Settings({ close }){
  const me = useStore(s => s.me);
  const ai = useStore(s => s.ai);
  const isAdmin = useCan('settings.manage');
  const [changing, setChanging] = useState(false);

  const out = async () => {
    try { await signOut(); } catch (e) { console.error(e); }
    location.hash = '';
    location.reload();
  };

  return html`
    <${Sheet} title="Settings" close=${close}>
      <h3 class="section-title">Your account</h3>
      <p>Signed in as <b>${me.fullName}</b> (${me.login}) · ${roleLabel(me.role)}</p>
      <p class="hint">${ROLE_INFO[me.role] && ROLE_INFO[me.role].blurb}</p>
      <div class="row-actions">
        <button class="btn" onClick=${() => setChanging(!changing)}>Change password</button>
        <button class="btn" onClick=${out}>Sign out</button>
      </div>
      ${changing && html`<${PasswordForm} onDone=${() => setChanging(false)} />`}

      <h3 class="section-title">AI</h3>
      ${isAdmin
        ? html`<${AiSettings} />`
        : html`<p class="hint">Drawings and the assistant use <b>${ai.label}</b>${ai.ready ? '.' : ', which an admin has not set up yet.'}
            An admin changes this here.</p>`}
    <//>`;
}

function PasswordForm({ onDone }){
  const submit = submitting(async f => {
    if(f.next !== f.confirm) throw new Error('The two new passwords do not match.');
    await changePassword(f.current, f.next);
    toast('Password changed. Other devices have been signed out.', { kind: 'ok', ms: 5000 });
    onDone();
  });
  return html`
    <form onSubmit=${submit} class="inset">
      <${Field} label="Current password"><input name="current" type="password" required autocomplete="current-password" /><//>
      <${Field} label="New password" hint="At least 8 characters."><input name="next" type="password" required minlength="8" autocomplete="new-password" /><//>
      <${Field} label="Confirm new password"><input name="confirm" type="password" required autocomplete="new-password" /><//>
      <button type="submit" class="btn btn-primary">Save new password</button>
    </form>`;
}

const PROVIDERS = [
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'local', label: 'Local AI (the shop\'s own AI server)' }
];

function AiSettings(){
  const [s, setS] = useState(null);
  const [provider, setProvider] = useState('gemini');
  const [models, setModels] = useState({});
  const [test, setTest] = useState(null);

  useEffect(() => {
    api.get('/api/settings/ai').then(v => { setS(v); setProvider(v.provider); }).catch(toastError);
  }, []);
  if(!s) return html`<p class="hint">Loading…</p>`;

  const save = submitting(async f => {
    const edit = { provider: f.provider };
    if(f.provider === 'gemini') edit.gemini = { model: f.model, ...(f.key ? { key: f.key } : {}) };
    if(f.provider === 'openrouter') edit.openrouter = { model: f.model, ...(f.key ? { key: f.key } : {}) };
    if(f.provider === 'local'){
      edit.local = { url: f.url, fallback: f.fallback === 'on', ...(f.key ? { key: f.key } : {}) };
    }
    if(f.orKey) edit.openrouter = { ...(edit.openrouter || {}), key: f.orKey };
    setS(await api.put('/api/settings/ai', edit));
    setTest(null);
    toast('AI settings saved.', { kind: 'ok' });
  });

  const loadModels = async p => {
    try { setModels({ ...models, [p]: (await api.get(`/api/ai/models?provider=${p}`)).models }); }
    catch (e) { toastError(e); }
  };

  const cfg = s[provider];
  const modelList = models[provider];
  return html`
    <p class="hint">Reads drawings and answers the assistant for everyone. Keys are stored on the server and never shown again.</p>
    <form onSubmit=${save} key=${provider}>
      <${Field} label="Provider">
        <${Select} name="provider" value=${provider} options=${PROVIDERS} onChange=${e => setProvider(e.currentTarget.value)} />
      <//>

      ${provider !== 'local' && html`
        <${Field} label=${provider === 'gemini' ? 'Gemini API key' : 'OpenRouter API key'}
                  hint=${cfg.keySet ? `A key is saved (${cfg.keyHint}). Leave blank to keep it.` : 'No key saved yet.'}>
          <input name="key" type="password" autocomplete="off" spellcheck="false" placeholder=${cfg.keySet ? 'Keep the saved key' : 'Paste the key'} />
        <//>
        <${Field} label="Model" hint=${provider === 'gemini' ? 'If this model is busy, another Gemini model answers and the scan says so.' : 'It must be able to read images.'}>
          ${modelList
            ? html`<${Select} name="model" value=${cfg.model}
                              options=${[...(modelList.some(m => m.id === cfg.model) ? [] : [{ value: cfg.model, label: `${cfg.model} (saved; not in the list)` }]),
                                         ...modelList.map(m => ({ value: m.id, label: `${m.name}${m.free ? ' -- free' : ''}` }))]} />`
            : html`<input name="model" defaultValue=${cfg.model} spellcheck="false" />`}
        <//>
        <button type="button" class="btn btn-sm" onClick=${() => loadModels(provider)}>Load the model list</button>`}

      ${provider === 'local' && html`
        <${Field} label="Address" hint="Its address as this server reaches it, e.g. https://desktop.your-tailnet.ts.net or http://localhost:8000">
          <input name="url" type="url" defaultValue=${cfg.url} spellcheck="false" placeholder="https://…" />
        <//>
        <${Field} label="Access key" hint=${cfg.keySet ? `A key is saved (${cfg.keyHint}). Leave blank to keep it.` : 'From the local AI\'s System tab, under Tracker connection.'}>
          <input name="key" type="password" autocomplete="off" spellcheck="false" />
        <//>
        <label class="check"><input type="checkbox" name="fallback" defaultChecked=${cfg.fallback} />
          Use OpenRouter when the local AI is off. ${s.openrouter.keySet ? 'An OpenRouter key is saved.' : 'Needs an OpenRouter key:'}</label>
        ${!s.openrouter.keySet && html`<${Field} label="OpenRouter key (for the fallback)"><input name="orKey" type="password" autocomplete="off" /><//>`}`}

      <div class="row-actions">
        <button type="submit" class="btn btn-primary">Save</button>
        <${AsyncButton} class="btn" busyLabel="Testing…" onClick=${async () => setTest(await api.post('/api/ai/test'))}>Test the saved settings<//>
      </div>
      ${test && html`<p class=${test.ok ? 'ok-text' : 'error-text'}>
        ${test.ok ? `Working: ${test.provider} answered in ${(test.ms / 1000).toFixed(1)} s.` : `Not working: ${test.error}`}
        ${test.substitution && ` (${test.substitution.used} answered instead of ${test.substitution.asked})`}</p>`}
    </form>`;
}
