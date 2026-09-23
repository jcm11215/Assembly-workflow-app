/**
 * Settings: your account, and -- for admins -- which AI reads drawings
 * and answers the assistant. AI keys are kept on the server, so they are
 * set once here rather than on every tablet.
 */
import { html, useEffect, useRef, useState } from '../vendor/index.js';
import { useStore, setState } from '../lib/store.js';
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
        : html`<p class="hint">Drawings and the assistant use the shop's local AI${ai.ready ? '.' : ', which an admin has not set up yet.'}</p>`}
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

function AiSettings(){
  const [s, setS] = useState(null);
  const [test, setTest] = useState(null);

  useEffect(() => { api.get('/api/settings/ai').then(setS).catch(toastError); }, []);
  if(!s) return html`<p class="hint">Loading…</p>`;

  const save = submitting(async f => {
    setS(await api.put('/api/settings/ai', {
      url: f.url, chatModel: f.chatModel, visionModel: f.visionModel, embedModel: f.embedModel,
      contextTokens: f.contextTokens, visionContextTokens: f.visionContextTokens, temperature: f.temperature
    }));
    setTest(null);
    toast('AI settings saved.', { kind: 'ok' });
  });

  return html`
    <p class="hint">The shop's own AI, run by Ollama on the server. It reads drawings and answers the assistant for everyone;
      nothing leaves the shop's hardware.</p>
    <form onSubmit=${save}>
      <${LocalAi} cfg=${s} />
      <div class="row-actions">
        <button type="submit" class="btn btn-primary">Save</button>
        <${AsyncButton} class="btn" busyLabel="Testing…" onClick=${async () => setTest(await api.post('/api/ai/test'))}>Test the saved settings<//>
      </div>
      ${test && html`<p class=${test.ok ? 'ok-text' : 'error-text'}>
        ${test.ok ? `Working: the local AI answered in ${(test.ms / 1000).toFixed(1)} s.` : `Not working: ${test.error}`}</p>`}
    </form>`;
}

/* ---------------- local AI ---------------- */

/** Models people use for each job, offered for download. */
const SUGGESTED = [
  { model: 'minicpm-v', why: 'reads drawings (vision), ~5 GB' },
  { model: 'qwen2.5vl:7b', why: 'reads drawings (vision), ~6 GB' },
  { model: 'qwen2.5:7b', why: 'answers questions, ~5 GB; qwen2.5:14b with 12 GB+ of GPU memory' },
  { model: 'nomic-embed-text', why: 'searches the knowledge base -- needed for it, ~270 MB' }
];

/**
 * Ollama runs the models; the app talks to it directly. Model pickers list
 * what Ollama has installed, and a model it doesn't have can be downloaded
 * from here.
 */
function LocalAi({ cfg }){
  const [status, setStatus] = useState(null);
  const pull = useStore(s => s.aiPull);
  const pullRef = useRef(null);
  const load = () => api.get('/api/ai/local').then(setStatus).catch(toastError);
  useEffect(() => { load(); }, []);
  // A download finishing changes what can be picked.
  useEffect(() => {
    if(!pull || !pull.done) return;
    if(pull.error) toast(`Download of ${pull.model} failed: ${pull.error}`, { kind: 'error', ms: 8000 });
    else toast(`${pull.model} is ready.`, { kind: 'ok' });
    setState({ aiPull: null });
    load();
  }, [pull]);

  const startPull = async name => {
    name = String(name || '').trim();
    if(!name) return;
    const r = await api.post('/api/ai/local/pull', { model: name });
    setState({ aiPull: r.pulling });
    if(pullRef.current) pullRef.current.value = '';
  };

  const models = status ? status.models : [];
  const options = (current, filter) => {
    const list = models.filter(filter).map(m => ({ value: m.id, label: `${m.id}${m.params ? ` · ${m.params}` : ''}${m.sizeGb ? ` · ${m.sizeGb} GB` : ''}` }));
    if(current && !list.some(o => o.value === current)) list.unshift({ value: current, label: `${current} (not installed)` });
    return [{ value: '', label: '-- none --' }, ...list];
  };
  const chatLike = m => !m.embedding;
  const pct = pull && pull.total ? Math.round((pull.completed / pull.total) * 100) : null;

  return html`
    <${Field} label="Ollama address" hint="Where Ollama runs, as this server reaches it. Same machine: http://127.0.0.1:11434">
      <input name="url" defaultValue=${cfg.url} spellcheck="false" placeholder="http://127.0.0.1:11434" />
    <//>
    <p class=${status ? (status.up ? 'ok-text' : 'error-text') : 'hint'}>
      ${!status ? 'Checking Ollama…' : status.up
        ? `Ollama ${status.version || ''} is running with ${models.length} model${models.length === 1 ? '' : 's'} installed${status.loaded.length ? ` (${status.loaded.join(', ')} loaded)` : ''}.`
        : `${status.error} Install it from https://ollama.com, or save the right address.`}
      ${' '}<button type="button" class="link-btn" onClick=${load}>Check again</button>
    </p>

    <${Field} label="Chat model" hint="Answers the assistant.">
      <${Select} name="chatModel" value=${cfg.chatModel} options=${options(cfg.chatModel, chatLike)} />
    <//>
    <${Field} label="Vision model" hint="Reads drawings when scanning. minicpm-v works well.">
      <${Select} name="visionModel" value=${cfg.visionModel} options=${options(cfg.visionModel, chatLike)} />
    <//>
    <${Field} label="Embedding model" hint="Searches the knowledge base. Changing it means re-indexing (Knowledge screen).">
      <${Select} name="embedModel" value=${cfg.embedModel} options=${options(cfg.embedModel, () => true).slice(1)} />
    <//>

    <details class="inset">
      <summary>Download a model</summary>
      ${pull ? html`
        <p>${pull.model}: ${pull.status}${pct != null ? ` -- ${pct}%` : ''}</p>
        ${pct != null && html`<div class="gauge"><div class="gauge-track"><div class="gauge-fill" style=${{ width: `${pct}%` }}></div></div></div>`}`
      : html`
        <div class="list">
          ${SUGGESTED.map(m => html`
            <div key=${m.model} class="model-row">
              <span><b>${m.model}</b> -- ${m.why}</span>
              ${models.some(x => x.id === m.model || x.id === `${m.model}:latest`)
                ? html`<span class="ok-text">Installed</span>`
                : html`<${AsyncButton} class="btn btn-sm" busyLabel="…" disabled=${!status || !status.up} onClick=${() => startPull(m.model)}>Download<//>`}
            </div>`)}
        </div>
        <${Field} label="Or any model by name" hint="From ollama.com/library, e.g. llama3.2-vision or qwen2.5:14b">
          <input ref=${pullRef} spellcheck="false" placeholder="model name" />
        <//>
        <${AsyncButton} class="btn btn-sm" busyLabel="Starting…" disabled=${!status || !status.up}
          onClick=${() => startPull(pullRef.current && pullRef.current.value)}>Download<//>`}
    </details>

    <details class="inset">
      <summary>Advanced</summary>
      <${Field} label="Context size for questions (tokens)"><input name="contextTokens" type="number" min="2048" max="131072" step="1024" defaultValue=${cfg.contextTokens} /><//>
      <${Field} label="Context size for drawings (tokens)" hint="Bigger fits more pages per request, and needs more memory. Scans split pages that don't fit.">
        <input name="visionContextTokens" type="number" min="2048" max="131072" step="1024" defaultValue=${cfg.visionContextTokens} /><//>
      <${Field} label="Temperature" hint="Lower is more literal. 0.3 suits reading drawings."><input name="temperature" type="number" min="0" max="2" step="0.1" defaultValue=${cfg.temperature} /><//>
    </details>`;
}
