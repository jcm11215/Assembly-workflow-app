/**
 * Settings: your account, and -- for admins -- the shop's AI. Setting up
 * the AI is one button: it downloads whatever models are missing and
 * puts each to work as it lands. The details are under Advanced.
 */
import { html, useEffect, useRef, useState } from '../vendor/index.js';
import { useStore, setState } from '../lib/store.js';
import { api } from '../lib/api.js';
import { signOut, changePassword } from '../lib/actions.js';
import { useCan } from '../lib/permissions.js';
import { roleLabel, ROLE_INFO } from '../../shared/roles.js';
import { Field, Select, AsyncButton, PageHeader, Segmented, initials, submitting } from '../ui/kit.js';
import { THEMES, themePref, setThemePref } from '../lib/theme.js';
import { Icon } from '../ui/icons.js';
import { toast, toastError } from '../ui/overlays.js';

export function Settings(){
  const me = useStore(s => s.me);
  const isAdmin = useCan('settings.manage');
  return html`
    <${PageHeader} title="Settings" sub=${isAdmin ? 'Your account and the shop’s AI' : 'Your account'} />
    <div class="settings-grid">
      <${Account} me=${me} />
      <${Appearance} />
      <section class="card">
        <div class="card-head"><h2>AI</h2></div>
        <div class="card-pad">${isAdmin ? html`<${AiSetup} />` : html`<${AiStatus} />`}</div>
      </section>
    </div>`;
}

/* ---------------- account ---------------- */

function Account({ me }){
  const [changing, setChanging] = useState(false);
  const out = async () => {
    try { await signOut(); } catch (e) { console.error(e); }
    location.hash = '';
    location.reload();
  };
  return html`
    <section class="card">
      <div class="card-head"><h2>Your account</h2></div>
      <div class="card-pad">
        <div class="account">
          <span class="avatar avatar-lg" aria-hidden="true">${initials(me.fullName)}</span>
          <div style=${{ minWidth: 0 }}>
            <div class="account-name">${me.fullName}</div>
            <div class="hint">${me.login} · ${roleLabel(me.role)}</div>
          </div>
        </div>
        ${ROLE_INFO[me.role] && html`<p class="hint">${ROLE_INFO[me.role].blurb}</p>`}
        <div class="row-actions">
          <button class="btn" aria-expanded=${changing} onClick=${() => setChanging(!changing)}>Change password</button>
          <button class="btn" onClick=${out}><${Icon} name="logout" />Sign out</button>
        </div>
        ${changing && html`<${PasswordForm} onDone=${() => setChanging(false)} />`}
      </div>
    </section>`;
}

/** Per device: a shared shop tablet and a phone can differ. */
function Appearance(){
  const [pref, setPref] = useState(themePref());
  return html`
    <section class="card">
      <div class="card-head"><h2>Appearance</h2></div>
      <div class="card-pad">
        <${Segmented} label="Theme" value=${pref} options=${THEMES} onChange=${p => { setThemePref(p); setPref(p); }} />
        <p class="hint" style=${{ marginBottom: 0 }}>For this device only.</p>
      </div>
    </section>`;
}

function PasswordForm({ onDone }){
  const submit = submitting(async f => {
    if(f.next !== f.confirm) throw new Error('The two new passwords do not match.');
    await changePassword(f.current, f.next);
    toast('Password changed. Your other devices have been signed out.', { kind: 'ok', ms: 5000 });
    onDone();
  });
  return html`
    <form onSubmit=${submit} class="inset">
      <${Field} label="Current password"><input name="current" type="password" required autocomplete="current-password" /><//>
      <${Field} label="New password" hint="At least 8 characters."><input name="next" type="password" required minlength="8" autocomplete="new-password" /><//>
      <${Field} label="Confirm new password"><input name="confirm" type="password" required autocomplete="new-password" /><//>
      <div class="row-actions">
        <button type="submit" class="btn btn-primary">Save new password</button>
        <button type="button" class="btn btn-ghost" onClick=${onDone}>Cancel</button>
      </div>
    </form>`;
}

/* ---------------- AI ---------------- */

/** What everyone else sees: whether the AI is ready. */
function AiStatus(){
  const ai = useStore(s => s.ai);
  return html`
    <${StatusCard} tone=${ai.ready ? 'good' : 'bad'} title=${ai.ready ? 'The AI is ready' : 'The AI isn’t set up yet'}>
      ${ai.ready ? 'The assistant and drawing scans run on the shop’s own server. Nothing leaves the shop.'
                 : 'An admin can set it up here, in one click.'}
    <//>`;
}

const TONE_ICON = { good: 'checkCircle', bad: 'alert', busy: 'clock' };

function StatusCard({ tone = 'bad', title, children, action }){
  return html`
    <div class=${`status-card ${tone}`}>
      <${Icon} name=${TONE_ICON[tone]} />
      <div class="status-card-text">
        <div class="status-card-title">${title}</div>
        <div class="hint" style=${{ margin: '2px 0 0' }}>${children}</div>
      </div>
      ${action}
    </div>`;
}

const pct = d => (d && d.total ? Math.round((d.completed / d.total) * 100) : null);
const same = (a, b) => !!a && !!b && (a.includes(':') ? a : `${a}:latest`) === (b.includes(':') ? b : `${b}:latest`);

/**
 * The admin's view: a status line, the three jobs the AI does and the
 * model doing each, and one button that downloads whatever is missing.
 */
function AiSetup(){
  const [st, setSt] = useState(null);
  const [test, setTest] = useState(null);
  const live = useStore(s => s.aiDownloads);
  const load = () => api.get('/api/ai/local').then(r => { setSt(r); setState({ aiDownloads: r.downloads }); }).catch(toastError);
  useEffect(() => { load(); }, []);

  // Each time a download finishes, show what is installed now.
  const currentModel = live && live.current ? live.current.model : null;
  const prev = useRef(currentModel);
  useEffect(() => {
    if(prev.current && prev.current !== currentModel) load();
    prev.current = currentModel;
  }, [currentModel]);
  if(!st) return html`<p class="hint">Checking the AI…</p>`;

  const dl = live || st.downloads;
  const busy = !!(dl && (dl.current || dl.queue.length));
  const missing = st.jobs.filter(j => !j.installed);
  const gb = missing.reduce((n, j) => n + (j.model && !same(j.model, j.recommended) ? 0 : j.sizeGb), 0);

  /** Switches a job to its recommended model; it keeps using the old
   *  one until the new one has downloaded. */
  const useRecommended = async job => {
    const r = await api.post('/api/ai/local/use', { key: job.key, model: job.recommended });
    setState({ aiDownloads: r.downloads });
    toast(r.switched ? `Now using ${job.recommended}.`
      : `Downloading ${job.recommended}. The current model keeps working until it's ready.`, { kind: 'ok', ms: 5000 });
    if(r.switched) load();
  };

  const setup = async () => {
    const r = await api.post('/api/ai/local/setup');
    setState({ aiDownloads: r.downloads });
    setTest(null);
  };

  let status;
  if(!st.up){
    status = html`
      <${StatusCard} title="The AI engine isn’t running"
        action=${html`<${AsyncButton} class="btn" busyLabel="Checking…" onClick=${load}>Check again<//>`}>
        The AI runs in Ollama on this server. Install it there with
        <code>curl -fsSL https://ollama.com/install.sh | sh</code> and check again.
      <//>`;
  } else if(busy){
    status = html`
      <${StatusCard} tone="busy" title="Setting up the AI…">
        Downloading models to this server. It can take a while; it keeps going if you leave this page.
      <//>`;
  } else if(st.ready){
    status = html`
      <${StatusCard} tone="good" title="The AI is ready"
        action=${html`<${AsyncButton} class="btn" busyLabel="Testing…" onClick=${async () => setTest(await api.post('/api/ai/test'))}>Test it<//>`}>
        Everything runs on this server. Nothing leaves the shop.
      <//>`;
  } else {
    status = html`
      <${StatusCard} title=${`The AI needs ${missing.length === 1 ? 'one more model' : `${missing.length} more models`}`}
        action=${html`<${AsyncButton} class="btn btn-primary" busyLabel="Starting…" onClick=${setup}><${Icon} name="sparkle" />Set up the AI<//>`}>
        They’re free and download to this server${gb ? ` (about ${Math.round(gb * 10) / 10} GB)` : ''}. Nothing leaves the shop.
      <//>`;
  }

  return html`
    ${status}
    ${dl && dl.error && !busy && html`<p class="error-text">Couldn’t download ${dl.error.model}: ${dl.error.message}</p>`}
    ${test && html`<p class=${test.ok ? 'ok-text' : 'error-text'}>
      ${test.ok ? `Working: it answered in ${(test.ms / 1000).toFixed(1)} seconds.` : `Not working: ${test.error}`}</p>`}

    ${st.up && html`
      <div class="ai-jobs">
        ${st.jobs.map(j => html`<${JobRow} key=${j.key} job=${j} downloads=${dl} onUse=${useRecommended} />`)}
      </div>`}

    <details class="advanced">
      <summary>Advanced</summary>
      <${Advanced} st=${st} reload=${load} />
    </details>`;
}

/** One job the AI does, the model doing it, and where that model is. */
function JobRow({ job, downloads, onUse }){
  const target = job.model || job.recommended;
  const busyWith = name => (downloads && downloads.current && same(downloads.current.model, name) ? downloads.current : null);
  const queued = name => !!(downloads && downloads.queue.some(q => same(q, name)));
  // The recommended model is on its way to replace the current one.
  const upgrading = job.model && !same(job.model, job.recommended) && (busyWith(job.recommended) || queued(job.recommended));
  const current = busyWith(target) || (upgrading ? busyWith(job.recommended) : null);
  const waiting = !current && (queued(target) || (upgrading && queued(job.recommended)));
  const p = pct(current);
  // Drawings used to default to minicpm-v; qwen2.5vl reads them better.
  // Offered, never forced -- and not to anyone who picked something else.
  const offer = job.key === 'visionModel' && /minicpm-v/i.test(job.model || '') && job.installed && !upgrading;
  return html`
    <div class="ai-job">
      <div class="ai-job-main">
        <div class="ai-job-label">${job.label}</div>
        <div class="hint">${job.model || 'No model yet'}${upgrading ? html` → ${job.recommended}` : ''}</div>
        ${offer && html`<${AsyncButton} class="link-btn" busyLabel="Starting…" onClick=${() => onUse(job)}>
          Use ${job.recommended} instead${job.sizeGb ? ` (${job.sizeGb} GB download)` : ''}<//>`}
        ${current && html`
          <div class="gauge"><div class="gauge-track"><div class="gauge-fill" style=${{ width: `${p || 0}%` }}></div></div></div>`}
      </div>
      <div class="ai-job-state">
        ${current ? html`<span class="hint">${current.status}${p != null ? ` · ${p}%` : ''}</span>`
          : waiting ? html`<span class="hint">Waiting to download</span>`
          : job.installed ? html`<span class="ok-text ai-ready"><${Icon} name="check" size=${16} />Ready</span>`
          : html`<span class="hint">Not installed</span>`}
      </div>
    </div>`;
}

/**
 * Where Ollama is, which model does each job, downloading any model by
 * name, and the model options. Most shops never need this.
 */
function Advanced({ st, reload }){
  const cfg = st.settings;
  const models = st.models;

  const save = submitting(async f => {
    await api.put('/api/settings/ai', {
      url: f.url, chatModel: f.chatModel, visionModel: f.visionModel, embedModel: f.embedModel,
      contextTokens: f.contextTokens, visionContextTokens: f.visionContextTokens, temperature: f.temperature
    });
    toast('AI settings saved.', { kind: 'ok' });
    reload();
  });

  const download = submitting(async (f, form) => {
    const r = await api.post('/api/ai/local/pull', { model: f.model.trim() });
    setState({ aiDownloads: r.downloads });
    form.reset();
  });

  const options = (current, fits) => {
    const list = models.filter(fits).map(m => ({ value: m.id, label: `${m.id}${m.params ? ` · ${m.params}` : ''}${m.sizeGb ? ` · ${m.sizeGb} GB` : ''}` }));
    const at = list.find(o => same(o.value, current));
    if(current && !at) list.unshift({ value: current, label: `${current} (not installed)` });
    return { value: at ? at.value : current, options: [{ value: '', label: 'None' }, ...list] };
  };
  const chat = options(cfg.chatModel, m => !m.embedding);
  const vision = options(cfg.visionModel, m => !m.embedding);
  const embed = options(cfg.embedModel, () => true);

  return html`
    <form onSubmit=${save} class="advanced-body">
      <${Field} label="Ollama address" hint="Where Ollama runs, as this server reaches it. On the same machine: http://127.0.0.1:11434">
        <input name="url" defaultValue=${cfg.url} spellcheck="false" placeholder="http://127.0.0.1:11434" />
      <//>
      ${st.up && html`<p class="hint">Ollama ${st.version || ''} · ${models.length} model${models.length === 1 ? '' : 's'} installed${st.loaded.length ? ` · ${st.loaded.join(', ')} loaded` : ''}</p>`}

      <div class="field-grid">
        <${Field} label="Answers questions"><${Select} name="chatModel" value=${chat.value} options=${chat.options} /><//>
        <${Field} label="Reads drawings"><${Select} name="visionModel" value=${vision.value} options=${vision.options} /><//>
        <${Field} label="Searches documents" hint="Changing it means re-indexing on the Knowledge screen.">
          <${Select} name="embedModel" value=${embed.value} options=${embed.options.slice(1)} /><//>
      </div>

      <div class="field-grid">
        <${Field} label="Context for questions" hint="Tokens."><input name="contextTokens" type="number" min="2048" max="131072" step="1024" defaultValue=${cfg.contextTokens} /><//>
        <${Field} label="Context for drawings" hint="Tokens. More fits more pages, and needs more memory.">
          <input name="visionContextTokens" type="number" min="2048" max="131072" step="1024" defaultValue=${cfg.visionContextTokens} /><//>
        <${Field} label="Temperature" hint="Lower is more literal."><input name="temperature" type="number" min="0" max="2" step="0.1" defaultValue=${cfg.temperature} /><//>
      </div>
      <div class="row-actions"><button type="submit" class="btn btn-primary">Save</button></div>
    </form>

    <form onSubmit=${download} class="advanced-body">
      <${Field} label="Download another model" hint="Any name from ollama.com/library, e.g. qwen2.5:14b or llama3.2-vision.">
        <div class="inline-input">
          <input name="model" required spellcheck="false" autocomplete="off" placeholder="Model name" />
          <button type="submit" class="btn" disabled=${!st.up}>Download</button>
        </div>
      <//>
    </form>`;
}
