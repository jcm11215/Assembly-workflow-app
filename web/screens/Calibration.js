/**
 * Scan testing (admins): calibrating the scanner against drawings whose
 * parts lists someone checked and marked correct.
 *
 * Each checked drawing is an answer key. Re-testing reads it again on the
 * server (a test scan, which changes nothing on the job) and scores the
 * result against the key: what it missed, what it kept that isn't a
 * part, what it typed or placed wrongly. Re-testing everything after an
 * update or a model change shows at once whether scans got better or
 * worse. Also here: what the scanner has learned, and recent scans with
 * what each left out and why.
 */
import { html, useEffect, useState } from '../vendor/index.js';
import { api, fetchBlob } from '../lib/api.js';
import { useStore, setState } from '../lib/store.js';
import { startScan } from '../lib/actions.js';
import { jobLink } from '../lib/router.js';
import { fmtWhen, plural } from '../lib/format.js';
import { PageHeader, Section, Empty } from '../ui/kit.js';
import { Icon } from '../ui/icons.js';
import { confirmAction, toast, toastError } from '../ui/overlays.js';

const END = { drive_end: 'drive end', tail_end: 'tail end', hanger: 'hangers', screw: 'along the run', trough: 'trough', other: 'other', unknown: 'not placed' };
const ends = s => String(s || '').split(',').map(e => END[e] || e).join(' + ');
const tone = score => (score >= 90 ? 'good' : score >= 70 ? 'fair' : 'poor');

/** Reads a checked drawing again, on the server, for a score. This
 *  device prepares its pages first, like any scan. */
async function testKey(key, onStatus){
  const [{ contentFor }, { keepAwake }] = await Promise.all([import('../scan/pipeline.js'), import('../scan/ScanDialog.js')]);
  const letSleep = await keepAwake();
  try {
    onStatus('Fetching the drawing…');
    const blob = await fetchBlob(`/api/blueprints/${key.blueprintId}/file`);
    const file = new File([blob], key.fileName || 'drawing', { type: key.mimeType || blob.type });
    const { blocks } = await contentFor(file, null, { withText: true, onStatus });
    onStatus('Sending it to the server…');
    await startScan({ testKeyId: key.id, file, blocks });
  } finally { letSleep(); }
}

export function Calibration(){
  const data = useStore(s => s.calibration);
  const [preparing, setPreparing] = useState(null);   // { name, i, n, status }
  const load = () => api.get('/api/calibration').then(d => setState({ calibration: d })).catch(toastError);
  useEffect(() => { load(); }, []);

  const run = async list => {
    const ready = list.filter(k => k.hasFile && !k.running);
    for(let i = 0; i < ready.length; i++){
      const k = ready[i];
      setPreparing({ name: k.jobNumber, i: i + 1, n: ready.length, status: '' });
      try {
        await testKey(k, status => setPreparing(p => ({ ...p, status })));
      } catch (e) { toastError(e, `${k.jobNumber}: `); }
    }
    setPreparing(null);
    if(ready.length) toast(`${plural(ready.length, 'drawing')} handed to the server to test. Scores appear here as each finishes; you can leave this screen.`, { kind: 'ok', ms: 7000 });
    else toast('Nothing to test: every checked drawing is already being tested, or has no file.');
  };

  if(!data) return html`<${PageHeader} title="Scan testing" /><p class="hint">Loading…</p>`;
  const keys = data.keys;
  const scored = keys.filter(k => k.last && k.last.score != null);
  const avg = scored.length ? Math.round(scored.reduce((a, k) => a + k.last.score, 0) / scored.length) : null;
  const firsts = keys.filter(k => k.firstScore);
  const avgFirst = firsts.length ? Math.round(firsts.reduce((a, k) => a + k.firstScore.score, 0) / firsts.length) : null;

  return html`
    <${PageHeader} title="Scan testing"
      sub="Check the scanner against drawings whose parts lists you've marked correct, and see what it has learned"
      actions=${keys.length > 0 && html`
        <button class="btn btn-primary" disabled=${!!preparing} onClick=${() => run(keys)}>
          <${Icon} name="refresh" />${preparing ? 'Preparing…' : 'Re-test all'}
        </button>`} />

    ${preparing && html`
      <div class="note-bar">Preparing ${preparing.name} (${preparing.i} of ${preparing.n})${preparing.status ? `: ${preparing.status}` : '…'}
        Keep this screen open until they're all handed over.</div>`}

    <div class="stat-grid">
      <div class="stat"><b>${keys.length}</b><span>Checked drawings</span></div>
      <div class="stat"><b class=${avg != null ? `score-${tone(avg)}` : ''}>${avg != null ? `${avg}%` : '--'}</b><span>Latest test score</span>
        <small>${scored.length ? `average of ${plural(scored.length, 'drawing')}` : 'not tested yet'}</small></div>
      <div class="stat"><b>${avgFirst != null ? `${avgFirst}%` : '--'}</b><span>Before checking</span>
        <small>how the first scans did</small></div>
      <div class="stat"><b>${data.learned}</b><span>Corrections learned</span>
        <small><a href="#/knowledge?section=names">See them</a></small></div>
    </div>

    <details class="card cal-how" open=${!keys.length}>
      <summary>How calibration works</summary>
      <ol>
        <li><b>Scan a drawing</b> on a job, then open <b>Drawing & parts → Edit parts</b> and make the list right: fix types and ends,
          remove what isn't a part, add what was missed using the drawing's own wording.</li>
        <li>Press <b>Mark list correct</b>. The scanner learns every difference between what it found and your list, and the
          drawing becomes a test here.</li>
        <li><b>Re-test</b> any time -- after an update, a model change or a batch of corrections -- to see whether scans got
          better or worse. A test reads the drawing again on the server and changes nothing on the job.</li>
      </ol>
      <p class="hint">Scores count each part once: its type, the ends it goes at and its total count must all match for full
        marks; a part found with something wrong counts half, and parts it shouldn't have kept count against it.
        Reading drawings with ${data.visionModel || 'no model yet'} · scanner version ${data.scanner}.</p>
    </details>

    <${Section} title="Checked drawings" count=${keys.length}>
      ${keys.length
        ? html`<div class="card">${keys.map(k => html`<${KeyRow} key=${k.id} k=${k} busy=${!!preparing} onTest=${() => run([k])} reload=${load} />`)}</div>`
        : html`<div class="card"><${Empty} icon="scan">No checked drawings yet. Mark a job's parts list correct to add one.<//></div>`}
    <//>

    <${Section} title="Recent scans" count=${data.recent.length}>
      ${data.recent.length
        ? html`<div class="card">${data.recent.map(s => html`<${RecentRow} key=${s.id} s=${s} />`)}</div>`
        : html`<div class="card"><${Empty} icon="scan">No scans yet.<//></div>`}
    <//>`;
}

function KeyRow({ k, busy, onTest, reload }){
  const [open, setOpen] = useState(false);
  const last = k.last;
  const remove = async () => {
    const ok = await confirmAction({ title: `Stop testing ${k.jobNumber}?`, message: 'Its checked list and scores are removed. What the scanner learned from it is kept.', confirmLabel: 'Remove', danger: true });
    if(!ok) return;
    await api.del(`/api/calibration/keys/${k.id}`).catch(toastError);
    reload();
  };
  const trend = k.history.filter(h => h.score != null).slice(-12);
  return html`
    <div class="cal-row">
      <div class="cal-main">
        <div class="cal-title"><a href=${jobLink(k.jobId)}>${k.jobNumber}</a>${k.customer && html` <span class="hint">· ${k.customer}</span>`}</div>
        <div class="hint">${k.fileName || 'drawing'} · ${plural(k.parts, 'part')} · checked${k.createdByName ? ` by ${k.createdByName}` : ''} ${fmtWhen(k.updatedAt)}
          ${k.firstScore && html` · first scan ${k.firstScore.score}%`}</div>
        ${k.running && html`<div class="cal-running"><span class="hint">${k.running.status === 'queued' ? 'Waiting its turn…' : k.running.progress || 'Reading…'}</span>
          <span class="scan-bar-progress"><span></span></span></div>`}
        ${!k.hasFile && html`<div class="hint">Its drawing file isn't saved, so it can't be re-tested. Re-scan the job and mark it correct again.</div>`}
      </div>
      ${trend.length > 1 && html`<div class="cal-trend" title=${`Last ${trend.length} tests: ${trend.map(h => `${h.score}%`).join(', ')}`} aria-hidden="true">
        ${trend.map((h, i) => html`<span key=${i} class=${`score-bg-${tone(h.score)}`} style=${{ height: `${Math.max(8, h.score)}%` }}></span>`)}
      </div>`}
      <div class="cal-score">
        ${last && last.score != null ? html`<b class=${`score-${tone(last.score)}`}>${last.score}%</b><span class="hint">${fmtWhen(last.at)}</span>`
          : last && last.error ? html`<b class="score-poor">Failed</b><span class="hint">${fmtWhen(last.at)}</span>`
          : html`<span class="hint">Not tested</span>`}
      </div>
      <div class="cal-actions">
        <button class="btn btn-sm" disabled=${busy || !!k.running || !k.hasFile} onClick=${onTest}>Re-test</button>
        ${last && html`<button class="btn btn-sm btn-ghost" aria-expanded=${open} onClick=${() => setOpen(!open)}>${open ? 'Hide' : 'Details'}</button>`}
        <button class="icon-btn danger" aria-label=${`Remove ${k.jobNumber}`} title="Remove" onClick=${remove}><${Icon} name="trash" size=${18} /></button>
      </div>
      ${open && last && html`<${Details} r=${last} first=${k.firstScore} />`}
    </div>`;
}

/** What the last test got wrong, part by part. */
function Details({ r, first }){
  if(r.error) return html`<div class="cal-details"><p class="error-text">${r.error}</p></div>`;
  const rows = [
    ['Missed', r.missed.map(n => html`${n}`)],
    ['Kept, but not a part', r.extra.map(n => html`${n}`)],
    ['Wrong type', r.wrongType.map(x => html`${x.name}: read as <b>${x.got}</b>, is <b>${x.want}</b>`)],
    ['Wrong end', r.wrongEnd.map(x => html`${x.name}: put at <b>${ends(x.got)}</b>, goes at <b>${ends(x.want)}</b>`)],
    ['Wrong count', r.wrongQty.map(x => html`${x.name}: <b>${x.got}</b>, should be <b>${x.want}</b>`)]
  ].filter(([, list]) => list.length);
  return html`
    <div class="cal-details">
      <p>${r.right} of ${r.expected} parts exactly right; it found ${plural(r.found, 'part')}.
        ${first && ` Before the list was checked, the scan scored ${first.score}%.`}</p>
      ${rows.length ? rows.map(([label, list]) => html`
        <div key=${label} class="cal-miss"><b>${label}</b><ul>${list.map((x, i) => html`<li key=${i}>${x}</li>`)}</ul></div>`)
        : html`<p class="hint">Nothing wrong.</p>`}
      ${r.summary && html`<p class="hint">${r.summary}</p>`}
      ${rows.length > 0 && html`<p class="hint">To fix what it keeps getting wrong, correct the job's parts list and mark it correct again,
        or tell whoever looks after the app which wording trips it up.</p>`}
    </div>`;
}

const STATUS = { queued: 'Waiting', running: 'Reading', done: 'Read', saved: 'Saved', failed: 'Failed', cancelled: 'Stopped' };

function RecentRow({ s }){
  return html`
    <div class="doc-row">
      <div class="doc-main">
        <div class="doc-title">${s.jobNumber || 'New job'} <span class="hint">· ${s.fileName || 'drawing'}</span></div>
        <div class="doc-meta">${s.byName || 'Someone'} · ${fmtWhen(s.createdAt)}${s.partsFound != null ? ` · ${plural(s.partsFound, 'part')}` : ''}</div>
        ${(s.error || s.summary) && html`<div class=${s.error ? 'error-text' : 'hint'}>${s.error || s.summary}</div>`}
      </div>
      <span class=${`pill scan-pill-${s.status}`}>${STATUS[s.status] || s.status}</span>
    </div>`;
}
