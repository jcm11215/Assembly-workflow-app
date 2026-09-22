/**
 * A job's own page -- where an assembler actually works the job: the
 * called-out drawing, the current stage's checklist, the parts, and the
 * job's blockers, errors and notes.
 */
import { html, useState } from '../vendor/index.js';
import { useStore } from '../lib/store.js';
import { stageLabel, nextStage, stageProgress } from '../../shared/procedure.js';
import { updateJob } from '../lib/actions.js';
import { dueStatus } from '../lib/jobs.js';
import { fmtDate, fmtDue } from '../lib/format.js';
import { useCan } from '../lib/permissions.js';
import { Section, Empty, Progress } from '../ui/kit.js';
import { openModal, toastError } from '../ui/overlays.js';
import { advance, StagePicker } from '../jobs/stage.js';
import { StageChecklist } from '../jobs/Checklist.js';
import { JobForm } from '../jobs/JobForm.js';
import { PartsList } from '../jobs/PartsList.js';
import { DrawingPreview } from '../jobs/Drawing.js';
import { PartLookup } from '../jobs/Tips.js';
import { Diagram } from '../scan/Diagram.js';
import { BlockerForm, BlockerCard } from './Blockers.js';
import { ErrorForm, ErrorCard } from './Errors.js';
import { NoteForm, NoteCard } from './Notes.js';

export function JobPage({ id }){
  const job = useStore(s => s.jobs.find(j => j.id === id));
  const blockers = useStore(s => s.blockers);
  const errors = useStore(s => s.errors);
  const notes = useStore(s => s.notes);
  const canWork = useCan('job.work');
  const canManage = useCan('job.manage');
  const canScan = useCan('blueprint.manage');

  if(!job){
    return html`<${Empty} icon="⚠">That job isn't here -- it may have been deleted.
      <div><a class="btn btn-sm" href="#/">Back to the dashboard</a></div><//>`;
  }

  const status = dueStatus(job);
  const to = nextStage(job.stage);
  const progress = stageProgress(job.checklist, job.stage);
  const openBlockers = blockers.filter(b => b.jobId === job.id && b.status !== 'Resolved');
  const jobErrors = errors.filter(e => e.jobId === job.id);
  const jobNotes = notes.filter(n => n.jobId === job.id).slice(0, 10);
  const scan = () => import('../scan/ScanDialog.js').then(m => openModal(m.RescanJob, { jobId: job.id })).catch(toastError);

  return html`
    <div class="job-page">
      <div class="job-page-bar">
        <button class="btn btn-sm" onClick=${() => history.length > 1 ? history.back() : (location.hash = '#/')}>← Back</button>
        <h2>${job.jobNumber}</h2>
        <span class=${`badge prio-${job.priority.toLowerCase()}`}>${job.priority}</span>
      </div>

      <div class=${`job-card job-summary due-${status}`}>
        <div class="job-cust">${job.customer}</div>
        ${job.description && html`<div class="job-desc">${job.description}</div>`}
        <div class="job-meta">
          <span>Stage <b>${stageLabel(job.stage)}</b></span>
          <span>Lead <b>${job.assignedName || 'Unassigned'}</b></span>
          <span>Due <b>${fmtDate(job.dueDate) || '—'}</b> <span class=${`due-tag due-${status}`}>${status === 'complete' ? 'Complete' : fmtDue(job.dueDate)}</span></span>
          ${job.lastMovedByName && html`<span>Last moved by <b>${job.lastMovedByName}</b></span>`}
        </div>
        <${ProgressControl} job=${job} editable=${canWork} />
      </div>

      <div class="row-actions">
        ${to && canWork && html`<button class="btn btn-primary" onClick=${() => advance(job)}>
          Advance ▸ ${stageLabel(to)}${progress.total ? ` (${progress.done}/${progress.total})` : ''}</button>`}
        ${canWork && html`<button class="btn" onClick=${() => openModal(StagePicker, { jobId: job.id })}>Move to…</button>`}
        <button class="btn" onClick=${() => openModal(BlockerForm, { jobId: job.id })}>Report blocker</button>
        <button class="btn" onClick=${() => openModal(ErrorForm, { jobId: job.id })}>Log an error</button>
        <button class="btn" onClick=${() => openModal(NoteForm, { jobId: job.id })}>Add note</button>
        ${canManage && html`<button class="btn" onClick=${() => openModal(JobForm, { job })}>Edit details</button>`}
      </div>

      ${job.blueprint && job.blueprint.hasFile && html`
        <${Section} title="What you're building"><${Diagram} job=${job} /><//>`}

      <${Section} title=${`Checklist · ${stageLabel(job.stage)}`}>
        <${StageChecklist} job=${job} showTips=${true} />
        <${PartLookup} />
      <//>

      <${Section} title="Drawing & parts"
                  actions=${canScan && html`<button class="btn btn-sm" onClick=${scan}>📐 ${job.blueprint ? 'Re-scan' : 'Scan a drawing'}</button>`}>
        <${DrawingPreview} job=${job} />
        <${PartsList} job=${job} />
      <//>

      <${Section} title="Open blockers" count=${openBlockers.length}>
        ${openBlockers.length
          ? openBlockers.map(b => html`<${BlockerCard} key=${b.id} blocker=${b} showJob=${false} />`)
          : html`<p class="hint">No open blockers.</p>`}
      <//>

      <${Section} title="Logged errors" count=${jobErrors.length}>
        ${jobErrors.length
          ? jobErrors.map(e => html`<${ErrorCard} key=${e.id} error=${e} showJob=${false} />`)
          : html`<p class="hint">No errors logged against this job.</p>`}
      <//>

      <${Section} title="Notes" count=${jobNotes.length}>
        ${jobNotes.length
          ? jobNotes.map(n => html`<${NoteCard} key=${n.id} note=${n} showJob=${false} />`)
          : html`<p class="hint">No notes on this job yet.</p>`}
      <//>
    </div>`;
}

/** Percent complete. Stage moves set it; anyone working the job can
 *  nudge it in between. */
function ProgressControl({ job, editable }){
  const [draft, setDraft] = useState(null);
  const value = draft ?? job.percentComplete;
  const commit = async () => {
    if(draft == null || draft === job.percentComplete){ setDraft(null); return; }
    try { await updateJob(job, { percentComplete: draft }); }
    catch (e) { toastError(e); }
    setDraft(null);
  };
  return html`
    <div class="progress-control">
      <${Progress} value=${value} label=${`${value}% complete`} />
      ${editable && html`<input type="range" min="0" max="100" step="5" value=${value} aria-label="Percent complete"
                               onInput=${e => setDraft(Number(e.currentTarget.value))} onChange=${commit} />`}
    </div>`;
}
