/**
 * Drawing scans the server is running for this person, at the top of
 * every screen: how far each has got, and what to do once it's done --
 * review the new job it read, open the job it saved to, or try again.
 * The same scans show on every device the person is signed in on, so a
 * drawing started on a phone can be reviewed at a desk.
 */
import { html, useEffect, useRef } from '../vendor/index.js';
import { useStore } from '../lib/store.js';
import { dismissScan, retryScan } from '../lib/actions.js';
import { navigate, jobLink } from '../lib/router.js';
import { Icon } from '../ui/icons.js';
import { confirmAction, openModal, toast, toastError } from '../ui/overlays.js';
import { JobForm } from '../jobs/JobForm.js';

const BUSY = ['queued', 'running'];

export function ScanBanner(){
  const scans = useStore(s => s.scans);
  // A scan that finishes while the app is open says so, wherever you are.
  const seen = useRef(null);
  useEffect(() => {
    const before = seen.current;
    seen.current = new Map(scans.map(s => [s.id, s.status]));
    if(!before) return;
    for(const s of scans){
      if(!BUSY.includes(before.get(s.id)) || BUSY.includes(s.status)) continue;
      if(s.status === 'saved') toast(`${s.jobNumber}: ${s.summary}`, { kind: 'ok', ms: 6000 });
      else if(s.status === 'done') toast('The drawing has been read. Review the new job at the top of the screen.', { kind: 'ok', ms: 6000 });
      else if(s.status === 'failed') toast(`The scan failed: ${s.error}`, { kind: 'error', ms: 8000 });
    }
  }, [scans]);

  const shown = scans.filter(s => s.status !== 'cancelled');
  if(!shown.length) return null;
  return html`<div class="scan-bars">${shown.map(s => html`<${ScanBar} key=${s.id} scan=${s} />`)}</div>`;
}

function ScanBar({ scan: s }){
  const run = fn => () => fn().catch(toastError);
  const name = s.fileName || 'the drawing';
  const forWhat = s.jobId ? s.jobNumber : 'a new job';

  const stop = run(async () => {
    const ok = await confirmAction({ title: 'Stop this scan?', message: `${name} won't be read. You can scan it again any time.`, confirmLabel: 'Stop scan', danger: true });
    if(ok) await dismissScan(s);
  });
  const discard = run(async () => {
    const ok = await confirmAction({ title: 'Discard this scan?', message: `What was read from ${name} is thrown away and no job is made.`, confirmLabel: 'Discard', danger: true });
    if(ok) await dismissScan(s);
  });
  const review = () => {
    const tb = s.result.titleBlock || {};
    openModal(JobForm, {
      prefill: { jobNumber: tb.jobNumber || '', customer: tb.customer || '', description: tb.description || '' },
      scan: { id: s.id, parts: s.result.components.length }
    });
  };
  const open = run(async () => { navigate(jobLink(s.jobId)); await dismissScan(s); });

  const view = {
    queued: { icon: 'clock', title: `Waiting to read ${name}`, detail: `For ${forWhat}. Another scan is ahead of it.`,
      actions: html`<button class="btn btn-sm btn-ghost" onClick=${stop}>Stop</button>` },
    running: { icon: 'scan', title: `Reading ${name}`, detail: s.progress || 'Starting…',
      actions: html`<button class="btn btn-sm btn-ghost" onClick=${stop}>Stop</button>` },
    done: { icon: 'check', title: `${name} is read`, detail: `${s.summary} Check it and create the job.`,
      actions: html`<button class="btn btn-sm btn-primary" onClick=${review}>Review new job</button>
                    <button class="btn btn-sm btn-ghost" onClick=${discard}>Discard</button>` },
    saved: { icon: 'check', title: `Saved to ${s.jobNumber}`, detail: s.summary,
      actions: html`<button class="btn btn-sm" onClick=${open}>Open job</button>
                    <button class="btn btn-sm btn-ghost" aria-label="Close" onClick=${run(() => dismissScan(s))}><${Icon} name="close" size=${16} /></button>` },
    failed: { icon: 'alert', title: `Couldn't read ${name}`, detail: s.error,
      actions: html`<button class="btn btn-sm" onClick=${run(() => retryScan(s))}>Try again</button>
                    <button class="btn btn-sm btn-ghost" aria-label="Close" onClick=${run(() => dismissScan(s))}><${Icon} name="close" size=${16} /></button>` }
  }[s.status];
  if(!view) return null;

  return html`
    <div class=${`scan-bar scan-${s.status}`} role="status">
      <span class="scan-bar-icon"><${Icon} name=${view.icon} size=${20} /></span>
      <div class="scan-bar-text">
        <b>${view.title}</b>
        <span class="hint">${view.detail}</span>
        ${BUSY.includes(s.status) && html`<span class="scan-bar-progress" aria-hidden="true"><span></span></span>`}
      </div>
      <div class="scan-bar-actions">${view.actions}</div>
    </div>`;
}
