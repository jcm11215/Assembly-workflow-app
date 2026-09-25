/**
 * Scanning a drawing: pick or photograph it, choose PDF pages, and hand
 * it to the server to read.
 *
 * This device only prepares the pages -- renders them and reads their
 * text, a few seconds with the screen kept on. The server does the
 * reading (server/scans.mjs), so it carries on whatever this device does
 * next, and its progress shows at the top of the app (ScanBanner.js).
 *
 *   NewJobFromDrawing  reads the title block too; once it's read, the
 *                      new-job form opens filled in from it.
 *   RescanJob          reads an existing job's drawing -- the one saved
 *                      with it, unless another is picked -- and saves it
 *                      as the job's newest scan.
 */
import { html, useEffect, useState } from '../vendor/index.js';
import { useStore } from '../lib/store.js';
import { startScan } from '../lib/actions.js';
import { fetchBlob } from '../lib/api.js';
import { Field } from '../ui/kit.js';
import { Icon } from '../ui/icons.js';
import { Sheet, toast } from '../ui/overlays.js';
import { MAX_PDF_PAGES, parsePageSelection, pdfPageCount } from './pdf.js';
import { contentFor } from './pipeline.js';

export function NewJobFromDrawing({ close }){
  return html`<${ScanForm} title="New job from a drawing" close=${close} includeJobFields=${true}
    intro="Photograph a paper drawing or pick a saved image or PDF. The AI reads the title block for the job number, customer and description, and pulls out the parts -- you check everything before it's saved."
    button="Read the drawing" />`;
}

export function RescanJob({ jobId, close }){
  const job = useStore(s => s.jobs.find(j => j.id === jobId));
  if(!job) return null;
  const bp = job.blueprint;
  return html`<${ScanForm} title=${`Scan the drawing · ${job.jobNumber}`} close=${close} jobId=${job.id}
    intro=${bp
      ? 'The new scan becomes what everyone sees on this job. Earlier scans and their files are kept.'
      : 'Photograph a paper drawing or pick a saved image or PDF. The AI pulls out the parts and where they sit.'}
    button="Scan"
    saved=${bp && bp.hasFile ? { url: `/api/blueprints/${bp.id}/file`, name: bp.fileName || `${job.jobNumber} drawing`, type: bp.mimeType } : null} />`;
}

/** Keeps the screen on while the pages are prepared: a phone that locks
 *  halfway pauses the work until it's unlocked. */
export async function keepAwake(){
  try {
    const lock = await navigator.wakeLock.request('screen');
    return () => lock.release().catch(() => {});
  } catch { return () => {}; }
}

function ScanForm({ title, intro, button, includeJobFields = false, close, jobId = null, saved = null }){
  const ai = useStore(s => s.ai);
  const [file, setFile] = useState(null);
  // A job's drawing is already on the server: scanning it again needs no
  // hunting for the file. Picking another one replaces it.
  const [savedFile, setSavedFile] = useState(null);
  useEffect(() => {
    if(!saved) return;
    let live = true;
    fetchBlob(saved.url)
      .then(blob => {
        if(!live) return;
        const f = new File([blob], saved.name, { type: saved.type || blob.type });
        setSavedFile(f);
        setFile(current => current || f);
      })
      .catch(() => {});   // not to hand: pick the file as usual
    return () => { live = false; };
  }, []);
  const [pageCount, setPageCount] = useState(null);
  const [pages, setPages] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState(null);

  const isPdf = file && file.type === 'application/pdf';
  useEffect(() => {
    setPageCount(null);
    if(!isPdf) return;
    let live = true;
    pdfPageCount(file).then(n => live && setPageCount(n)).catch(() => live && setPageCount(0));
    return () => { live = false; };
  }, [file]);

  const selection = isPdf && pageCount ? parsePageSelection(pages, pageCount, MAX_PDF_PAGES) : { pages: null };
  const pagesHint = !isPdf ? null
    : pageCount === null ? 'Counting pages…'
    : pageCount === 0 ? 'Could not count the pages -- every page will be scanned.'
    : selection.error ? selection.error
    : pages.trim() ? `Scanning ${selection.pages.length} of ${pageCount} pages.`
    : pageCount > MAX_PDF_PAGES ? `${pageCount} pages -- the first ${MAX_PDF_PAGES} will be scanned. Enter pages like 1-3, 7 to choose.`
    : `${pageCount} page${pageCount === 1 ? '' : 's'} -- all will be scanned. Enter pages like 1-3, 7 to scan fewer.`;

  const read = async () => {
    setBusy(true);
    setError(null);
    const letSleep = await keepAwake();
    try {
      const { blocks, thumbnail } = await contentFor(file, selection.pages, { withText: true, onStatus: setStatus });
      setStatus('Sending it to the server…');
      await startScan({ jobId, includeJobFields, file, thumbnail, blocks });
      close();
      toast('The server is reading the drawing. You can leave this screen or lock the phone: it carries on, and shows at the top of the app.',
        { ms: 7000, kind: 'ok' });
    } catch (e) {
      console.error(e);
      setError((e && e.message) || String(e));
    } finally {
      letSleep();
      setBusy(false);
      setStatus('');
    }
  };

  return html`
    <${Sheet} title=${title} close=${busy ? () => {} : close} locked=${busy}>
      <p class="hint">${intro}</p>
      ${!ai.ready && html`<div class="note-bar">The AI isn't set up yet, so reading drawings won't work. An admin can set it up in Settings, in one click.</div>`}
      <label class=${`file-pick${file ? ' chosen' : ''}${busy ? ' disabled' : ''}`}>
        <input type="file" class="visually-hidden" accept="image/*,application/pdf" disabled=${busy}
               onChange=${e => { setFile(e.currentTarget.files[0] || null); setPages(''); setError(null); }} />
        <${Icon} name=${file ? 'drawing' : 'upload'} size=${26} />
        <b>${file ? file.name : 'Take a photo or choose a file'}</b>
        <span class="hint">${file && file === savedFile ? 'The drawing saved with this job. Tap to pick a different one.'
          : file ? 'Tap to pick a different one' : 'A photo of the drawing, an image, or a PDF'}</span>
      </label>
      ${isPdf && html`
        <${Field} label="Pages to scan" hint=${pagesHint}>
          <input value=${pages} placeholder="All pages" autocomplete="off" disabled=${busy}
                 onInput=${e => setPages(e.currentTarget.value)} />
        <//>`}
      ${error && html`<p class="error-text">${error}</p>`}
      <button class="btn btn-primary btn-block" disabled=${!file || busy || !!selection.error} onClick=${read}>
        ${busy ? (status || 'Preparing the pages…') : button}
      </button>
      <p class="hint">${busy
        ? 'Keep this screen open for a moment while the pages are prepared.'
        : 'The server does the reading: once it has started, you can leave this screen.'}</p>
    <//>`;
}
