/**
 * Knowledge (admin): what the assistant knows beyond the job data --
 * documents it searches when answering, and the corrections staff have
 * made to its answers.
 */
import { html, useEffect, useRef, useState } from '../vendor/index.js';
import { api } from '../lib/api.js';
import { fmtWhen, fmtBytes, plural } from '../lib/format.js';
import { ensurePdfJs, textLayerFromItems } from '../scan/pdf.js';
import { Tabs, Chips, Select, AsyncButton, Empty, PageHeader } from '../ui/kit.js';
import { Icon } from '../ui/icons.js';
import { confirmAction, toast, toastError } from '../ui/overlays.js';

const SECTIONS = [
  { id: 'documents', label: 'Documents' },
  { id: 'corrections', label: 'Corrections' },
  { id: 'names', label: 'Part names' }
];

const LOCATION_LABEL = { drive_end: 'Drive end', tail_end: 'Tail end', screw: 'Augers', hanger: 'Hanger bearings', trough: 'Trough', other: 'Other', unknown: 'Other' };

const ACCEPT = '.pdf,.docx,.txt,.md,.csv,.tsv,.json,.log,.yaml,.yml,.html,.htm';

export function Knowledge(){
  const [section, setSection] = useState('documents');
  const [data, setData] = useState(null);
  const [names, setNames] = useState(null);
  const load = () => api.get('/api/knowledge').then(setData).catch(toastError);
  const loadNames = () => api.get('/api/parts/learned').then(r => setNames(r.names)).catch(toastError);
  useEffect(() => { load(); loadNames(); }, []);

  return html`
    <${PageHeader} title="Knowledge" sub="Documents the assistant searches, and corrections staff have made to its answers" />
    ${data && data.staleVectors > 0 && html`
      <div class="inset">
        <p>${plural(data.staleVectors, 'passage')} were indexed with a different embedding model than the one set now
          (${data.embedModel}), so they aren't searched.</p>
        <${AsyncButton} class="btn btn-sm" busyLabel="Re-indexing…" onClick=${async () => {
          const r = await api.post('/api/knowledge/reindex');
          toast(`Re-indexed ${plural(r.done, 'document')}${r.failed ? `; ${r.failed} failed` : ''}.`, { kind: r.failed ? 'error' : 'ok' });
          load();
        }}>Re-index everything<//>
      </div>`}
    <${Tabs} label="Section" value=${section} onChange=${setSection}
      options=${SECTIONS.map(s => ({ ...s, count: s.id === 'names' ? (names ? names.length : null) : data ? data[s.id].length : null }))} />
    ${section === 'names' ? html`<${PartNames} names=${names} reload=${loadNames} />`
      : !data ? html`<p class="hint">Loading…</p>`
      : section === 'documents' ? html`<${Documents} data=${data} reload=${load} />`
      : html`<${Corrections} data=${data} reload=${load} />`}`;
}

/* ---------------- documents ---------------- */

/** Every page's selectable text, for a PDF. A scanned PDF has none. */
async function pdfPages(file){
  const pdfjsLib = await ensurePdfJs();
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for(let i = 1; i <= pdf.numPages; i++){
    const page = await pdf.getPage(i);
    pages.push(textLayerFromItems((await page.getTextContent()).items, 200000));
  }
  return pages;
}

async function addFile(file, collection){
  const q = new URLSearchParams({ name: file.name, collection });
  const { document: doc, needsText } = await api.post(`/api/knowledge/documents?${q}`, file, { contentType: 'application/octet-stream' });
  if(!needsText) return doc;
  return (await api.put(`/api/knowledge/documents/${doc.id}/text`, { pages: await pdfPages(file) })).document;
}

function Documents({ data, reload }){
  const fileRef = useRef(null);
  const [collection, setCollection] = useState('procedures');
  const [busy, setBusy] = useState(null);
  const [filter, setFilter] = useState('all');
  const [over, setOver] = useState(false);
  const collections = data.collections.map(c => ({ value: c.id, label: c.label }));
  const labelOf = id => (data.collections.find(c => c.id === id) || {}).label || id;

  const upload = async files => {
    const list = [...files];
    for(let i = 0; i < list.length; i++){
      setBusy(`Adding ${list[i].name} (${i + 1} of ${list.length})… reading and indexing can take a minute.`);
      try {
        const doc = await addFile(list[i], collection);
        if(doc.status !== 'indexed') toast(`${doc.title}: ${doc.detail}`, { kind: 'error', ms: 7000 });
      } catch (e) { toastError(e, `${list[i].name}: `); }
    }
    setBusy(null);
    if(fileRef.current) fileRef.current.value = '';
    reload();
  };

  const remove = async d => {
    if(!(await confirmAction({ title: `Remove “${d.title}”?`, message: 'The assistant stops using it. The file is deleted from the server.',
        confirmLabel: 'Remove', danger: true }))) return;
    await api.del(`/api/knowledge/documents/${d.id}`).catch(toastError);
    reload();
  };

  const reindex = async d => {
    const r = await api.post(`/api/knowledge/documents/${d.id}/reindex`);
    if(r.needsText) toast('This PDF has no stored text yet. Remove it and add the file again.', { kind: 'error', ms: 6000 });
    reload();
  };

  const shown = data.documents.filter(d => filter === 'all' || d.collection === filter);
  return html`
    <div class=${`dropzone${over ? ' over' : ''}`} style=${{ marginBottom: '18px' }}
         onDragOver=${e => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)}
         onDrop=${e => { e.preventDefault(); setOver(false); if(!busy) upload(e.dataTransfer.files); }}>
      <${Icon} name="upload" size=${26} />
      <div><b>Drop files here</b> or</div>
      <input ref=${fileRef} type="file" multiple accept=${ACCEPT} hidden onChange=${e => upload(e.currentTarget.files)} />
      <div class="row-actions" style=${{ marginTop: 0, justifyContent: 'center', alignItems: 'center' }}>
        <${Select} name="collection" value=${collection} options=${collections} onChange=${e => setCollection(e.currentTarget.value)}
                   aria-label="Add to" style=${{ width: 'auto' }} />
        <button class="btn btn-primary" disabled=${!!busy} onClick=${() => fileRef.current.click()}>Choose files</button>
      </div>
      <div class="hint">${busy || 'PDF, Word, text, Markdown, CSV or HTML. PDFs need selectable text; a scanned page has none.'}</div>
    </div>

    <div class="toolbar"><${Chips} label="Collection" value=${filter} onChange=${setFilter}
      options=${[{ id: 'all', label: 'All', count: data.documents.length },
                 ...data.collections.map(c => ({ id: c.id, label: c.label, count: data.documents.filter(d => d.collection === c.id).length }))]} /></div>

    ${!shown.length ? html`<div class="card"><${Empty} icon="book">No documents here yet.<//></div>` : html`
      <div class="card">
        ${shown.map(d => html`
          <div key=${d.id} class="doc-row">
            <div class="doc-main">
              <div class="doc-title">${d.hasFile ? html`<a href=${`/api/knowledge/documents/${d.id}/file`} target="_blank" rel="noopener">${d.title}</a>` : d.title}</div>
              <div class="doc-meta">
                ${labelOf(d.collection)} · ${d.status === 'indexed' ? plural(d.chunkCount, 'passage')
                  : html`<span class=${`status-${d.status}`}>${d.status === 'pending' ? 'Not indexed yet' : d.detail}</span>`}
                ${d.size ? ` · ${fmtBytes(d.size)}` : ''} · ${fmtWhen(d.createdAt)}${d.createdByName ? ` · ${d.createdByName}` : ''}
              </div>
            </div>
            <${Select} aria-label="Collection" value=${d.collection} options=${collections}
              onChange=${e => api.patch(`/api/knowledge/documents/${d.id}`, { collection: e.currentTarget.value }).then(reload, toastError)} />
            ${d.status !== 'indexed' && html`<${AsyncButton} class="btn btn-sm" busyLabel="…" onClick=${() => reindex(d)}>Retry<//>`}
            <button class="icon-btn danger" onClick=${() => remove(d)} aria-label=${`Remove ${d.title}`} title="Remove"><${Icon} name="trash" size=${18} /></button>
          </div>`)}
      </div>`}`;
}

/* ---------------- part names ---------------- */

/** What drawing scans have learned from people fixing scanned parts. */
function PartNames({ names, reload }){
  if(!names) return html`<p class="hint">Loading…</p>`;
  const forget = async n => {
    if(!(await confirmAction({ title: `Forget “${n.drawn}”?`, message: 'Later scans read this part afresh.', confirmLabel: 'Forget', danger: true }))) return;
    await api.del(`/api/parts/learned/${encodeURIComponent(n.key)}`).catch(toastError);
    reload();
  };
  if(!names.length){
    return html`<div class="card"><${Empty} icon="scan">Nothing learned yet. When someone fixes a scanned part's type or where it goes
      or removes one that isn't a part (Edit parts, on a job), the next scan reads that part the same way.<//></div>`;
  }
  return html`
    <p class="hint">Fixes people made to scanned parts. Every scan applies these to a part with the same description.</p>
    <div class="card">
      ${names.map(n => html`
        <div key=${n.key} class="doc-row">
          <div class="doc-main">
            <div class="doc-title">${n.drawn}</div>
            <div class="doc-meta">
              ${[n.item === 'Not a part' ? 'Left out of scans' : n.item && `Type: ${n.item}`, n.location && `Goes: ${LOCATION_LABEL[n.location] || n.location}`].filter(Boolean).join(' · ')}
              · used ${plural(n.usedCount, 'time')} · ${n.updatedByName || 'Someone'}, ${fmtWhen(n.updatedAt)}
            </div>
          </div>
          <button class="icon-btn danger" onClick=${() => forget(n)} aria-label=${`Forget ${n.drawn}`} title="Forget"><${Icon} name="trash" size=${18} /></button>
        </div>`)}
    </div>`;
}

/* ---------------- corrections ---------------- */

function Corrections({ data, reload }){
  const set = (c, fields) => api.patch(`/api/knowledge/corrections/${c.id}`, fields).then(reload, toastError);
  const remove = async c => {
    if(!(await confirmAction({ title: 'Delete this correction?', message: 'Switching it off keeps it for the record instead.',
        confirmLabel: 'Delete', danger: true }))) return;
    await api.del(`/api/knowledge/corrections/${c.id}`).catch(toastError);
    reload();
  };
  if(!data.corrections.length){
    return html`<div class="card"><${Empty} icon="checkCircle">No corrections yet. Under any answer in the Assistant, “Correct this” teaches it the right one.<//></div>`;
  }
  return html`
    <div class="card">
      ${data.corrections.map(c => html`
        <div key=${c.id} class=${`correction${c.active ? '' : ' off'}`}>
          <div class="correction-q">${c.question}</div>
          <div class="msg-text">${c.correction}</div>
          <div class="doc-meta">
            ${c.createdByName || 'Imported'} · ${fmtWhen(c.createdAt)} · used ${plural(c.usedCount, 'time')}
            ${!c.indexed && ' · not searchable until the knowledge base is re-indexed'}
          </div>
          <div class="row-actions">
            <button class="btn btn-sm" onClick=${() => set(c, { active: !c.active })}>${c.active ? 'Switch off' : 'Switch on'}</button>
            <button class="btn btn-sm" onClick=${() => remove(c)}>Delete</button>
          </div>
        </div>`)}
    </div>`;
}
