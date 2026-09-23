/**
 * Scanning a drawing: pick or photograph it, choose PDF pages, and let the
 * AI read it.
 *
 *   NewJobFromDrawing  reads the title block too, then opens the new-job
 *                      form filled in; the scan is saved with the job.
 *   RescanJob          reads an existing job's drawing and saves it as the
 *                      job's newest scan.
 */
import { html, useEffect, useState } from '../vendor/index.js';
import { useStore } from '../lib/store.js';
import { saveScan, logActivity } from '../lib/actions.js';
import { explainAiError } from '../lib/ai.js';
import { api } from '../lib/api.js';
import { Field } from '../ui/kit.js';
import { Icon } from '../ui/icons.js';
import { openModal, Sheet, toast } from '../ui/overlays.js';
import { JobForm } from '../jobs/JobForm.js';
import { MAX_PDF_PAGES, parsePageSelection, pdfPageCount } from './pdf.js';
import { contentFor, readDrawing, scanSummary, diagnosticsWorthLogging } from './pipeline.js';

export function NewJobFromDrawing({ close }){
  return html`<${ScanForm} title="New job from a drawing" close=${close} includeJobFields=${true}
    intro="Photograph a paper drawing or pick a saved image or PDF. The AI reads the title block for the job number, customer and description, and pulls out the parts -- you check everything before it's saved."
    button="Read the drawing"
    onRead=${({ file, result, thumbnail }) => {
      close();
      const tb = result.titleBlock;
      openModal(JobForm, {
        prefill: { jobNumber: tb.jobNumber, customer: tb.customer, description: tb.description },
        scan: { components: result.components, file, thumbnail }
      });
      toast(scanSummary(result.components, result.diagnostics), { ms: 6000 });
    }} />`;
}

export function RescanJob({ jobId, close }){
  const job = useStore(s => s.jobs.find(j => j.id === jobId));
  if(!job) return null;
  return html`<${ScanForm} title=${`Scan the drawing · ${job.jobNumber}`} close=${close}
    intro=${job.blueprint
      ? 'The new scan becomes what everyone sees on this job. Earlier scans and their files are kept.'
      : 'Photograph a paper drawing or pick a saved image or PDF. The AI pulls out the parts and where they sit.'}
    button="Scan"
    onRead=${async ({ file, result, thumbnail }) => {
      const { fileSaved } = await saveScan(job, { components: result.components, file, thumbnail });
      close();
      toast(scanSummary(result.components, result.diagnostics), { ms: 6000, kind: result.components.length ? 'ok' : 'info' });
      if(!fileSaved) toast('The parts were saved, but the drawing file could not be uploaded. Try again to attach it.', { ms: 8000, kind: 'error' });
    }}
    jobNumber=${job.jobNumber} jobId=${job.id} />`;
}

function ScanForm({ title, intro, button, includeJobFields = false, onRead, close, jobNumber = null, jobId = null }){
  const ai = useStore(s => s.ai);
  const [file, setFile] = useState(null);
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
    try {
      const { blocks, thumbnail } = await contentFor(file, selection.pages, { withText: true, onStatus: setStatus });
      // Corrections people made to earlier scans. A scan without them is
      // still a scan, so a failure here is never fatal.
      const learned = await api.get('/api/parts/learned')
        .then(r => new Map(r.names.map(n => [n.key, { item: n.item, location: n.location }])))
        .catch(() => null);
      const result = await readDrawing(blocks, { includeJobFields, learned, onStatus: setStatus });
      if(result.diagnostics.learnedKeys.length){
        api.post('/api/parts/learned/used', { keys: result.diagnostics.learnedKeys }).catch(() => {});
      }
      if(diagnosticsWorthLogging(result.components, result.diagnostics)){
        logActivity('Blueprint scan diagnostics', { text: `${jobNumber || 'New job'}: ${scanSummary(result.components, result.diagnostics)}`,
          jobNumber, ...result.diagnostics }, jobId ? { type: 'job', id: jobId } : null);
      }
      await onRead({ file, result, thumbnail });
    } catch (e) {
      console.error(e);
      const saved = e.readingsAlreadySaved ? ` ${e.readingsAlreadySaved} reading(s) of this drawing are saved, so trying again only re-reads the rest.` : '';
      setError(explainAiError(e) + saved);
      logActivity('Blueprint scan failed', { text: `${jobNumber || 'New job'}: ${explainAiError(e)}`, jobNumber },
        jobId ? { type: 'job', id: jobId } : null);
    } finally {
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
        <span class="hint">${file ? 'Tap to pick a different one' : 'A photo of the drawing, an image, or a PDF'}</span>
      </label>
      ${isPdf && html`
        <${Field} label="Pages to scan" hint=${pagesHint}>
          <input value=${pages} placeholder="All pages" autocomplete="off" disabled=${busy}
                 onInput=${e => setPages(e.currentTarget.value)} />
        <//>`}
      ${error && html`<p class="error-text">${error}</p>`}
      <button class="btn btn-primary btn-block" disabled=${!file || busy || !!selection.error} onClick=${read}>
        ${busy ? (status || 'Reading the drawing…') : button}
      </button>
    <//>`;
}
