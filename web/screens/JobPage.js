/**
 * A job's own page -- where an assembler actually works the job: where
 * it stands, the one thing to do next, and tabs for the checklist, the
 * drawing and parts, its issues and its notes.
 */
import { html, useState } from '../vendor/index.js';
import { useStore } from '../lib/store.js';
import { STAGES, stageIndex, stageLabel, nextStage, stageProgress } from '../../shared/procedure.js';
import { updateJob } from '../lib/actions.js';
import { dueStatus, blockedJobIds } from '../lib/jobs.js';
import { fmtDate, fmtDue } from '../lib/format.js';
import { useCan } from '../lib/permissions.js';
import { Empty, Progress, Menu, Tabs } from '../ui/kit.js';
import { Icon } from '../ui/icons.js';
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
  const [tab, setTab] = useState('checklist');

  if(!job){
    return html`<div class="card"><${Empty} icon="alert">That job isn't here -- it may have been deleted.
      <div style=${{ marginTop: '10px' }}><a class="btn btn-sm" href="#/jobs">Back to jobs</a></div><//></div>`;
  }

  const status = dueStatus(job);
  const to = nextStage(job.stage);
  const progress = stageProgress(job.checklist, job.stage);
  const isBlocked = blockedJobIds(blockers).has(job.id);
  const openBlockers = blockers.filter(b => b.jobId === job.id && b.status !== 'Resolved');
  const jobErrors = errors.filter(e => e.jobId === job.id);
  const jobNotes = notes.filter(n => n.jobId === job.id).slice(0, 20);
  const scan = () => import('../scan/ScanDialog.js').then(m => openModal(m.RescanJob, { jobId: job.id })).catch(toastError);

  const menu = [
    canWork && { label: 'Move to a stage…', icon: 'move', onSelect: () => openModal(StagePicker, { jobId: job.id }) },
    { label: 'Report a blocker', icon: 'issues', onSelect: () => openModal(BlockerForm, { jobId: job.id }) },
    { label: 'Log an error', icon: 'flag', onSelect: () => openModal(ErrorForm, { jobId: job.id }) },
    { label: 'Add a note', icon: 'note', onSelect: () => openModal(NoteForm, { jobId: job.id }) },
    (canScan || canManage) && 'sep',
    canScan && { label: job.blueprint ? 'Re-scan the drawing' : 'Scan a drawing', icon: 'scan', onSelect: scan },
    canManage && { label: 'Edit details', icon: 'edit', onSelect: () => openModal(JobForm, { job }) }
  ];

  return html`
    <div class="crumbs"><a href="#/jobs">Jobs</a><span>/</span><span>${job.jobNumber}</span></div>

    <section class="card job-head">
      <div class="job-head-top">
        <div style=${{ minWidth: 0 }}>
          <div class="job-title">
            <h1>${job.jobNumber}</h1>
            <span class=${`badge prio-${job.priority.toLowerCase()}`}>${job.priority} priority</span>
            ${isBlocked && html`<span class="blocked-tag">Blocked</span>`}
          </div>
          ${job.customer && html`<div class="job-customer">${job.customer}</div>`}
          ${job.description && html`<div class="job-desc">${job.description}</div>`}
        </div>
        <div class="job-actions">
          <${Menu} label="More" items=${menu} />
          ${to && canWork && html`
            <button class="btn btn-primary" onClick=${() => advance(job)}>
              Advance to ${stageLabel(to)}${progress.total ? ` · ${progress.done}/${progress.total}` : ''}
            </button>`}
        </div>
      </div>

      <${Stepper} stage=${job.stage} />

      <div class="facts">
        <div><div class="fact-label">Stage</div><div class="fact-value">${stageLabel(job.stage)}</div></div>
        <div><div class="fact-label">Due</div><div class="fact-value">${fmtDate(job.dueDate) || '—'}
          ${job.dueDate && status !== 'ok' && html`<span class=${`due-tag due-${status}`}>${status === 'complete' ? 'Complete' : fmtDue(job.dueDate)}</span>`}</div></div>
        <div><div class="fact-label">Lead</div><div class="fact-value">${job.assignedName || 'Unassigned'}</div></div>
        <div><div class="fact-label">Progress</div><${ProgressControl} job=${job} editable=${canWork} /></div>
      </div>
    </section>

    <div style=${{ marginTop: '22px' }}>
      <${Tabs} label="Job sections" value=${tab} onChange=${setTab} options=${[
        { id: 'checklist', label: 'Checklist', count: progress.total ? `${progress.done}/${progress.total}` : null },
        { id: 'drawing', label: 'Drawing & parts', count: job.blueprint ? job.blueprint.components.length : null },
        { id: 'issues', label: 'Issues', count: openBlockers.length + jobErrors.filter(e => e.status !== 'Corrected').length },
        { id: 'notes', label: 'Notes', count: jobNotes.length }
      ]} />

      ${tab === 'checklist' && html`
        <${StageChecklist} job=${job} showTips=${true} />
        <${PartLookup} />`}

      ${tab === 'drawing' && html`
        ${!job.blueprint && html`
          <div class="card"><${Empty} icon="drawing">No drawing scanned for this job yet.
            ${canScan && html`<div style=${{ marginTop: '10px' }}><button class="btn btn-primary" onClick=${scan}><${Icon} name="scan" />Scan a drawing</button></div>`}<//></div>`}
        ${job.blueprint && job.blueprint.hasFile && html`<${Diagram} job=${job} />`}
        ${job.blueprint && html`<${DrawingPreview} job=${job} />`}
        <${PartsList} job=${job} />`}

      ${tab === 'issues' && html`
        <div class="section-head">
          <h2 class="section-title">Open blockers <span class="count">${openBlockers.length}</span></h2>
          <button class="btn btn-sm" onClick=${() => openModal(BlockerForm, { jobId: job.id })}><${Icon} name="plus" />Report a blocker</button>
        </div>
        <div class="list">
          ${openBlockers.length ? openBlockers.map(b => html`<${BlockerCard} key=${b.id} blocker=${b} showJob=${false} />`)
                                : html`<p class="hint">Nothing is blocking this job.</p>`}
        </div>
        <div class="section">
          <div class="section-head">
            <h2 class="section-title">Logged errors <span class="count">${jobErrors.length}</span></h2>
            <button class="btn btn-sm" onClick=${() => openModal(ErrorForm, { jobId: job.id })}><${Icon} name="plus" />Log an error</button>
          </div>
          <div class="list">
            ${jobErrors.length ? jobErrors.map(e => html`<${ErrorCard} key=${e.id} error=${e} showJob=${false} />`)
                               : html`<p class="hint">No errors logged against this job.</p>`}
          </div>
        </div>`}

      ${tab === 'notes' && html`
        <div class="section-head">
          <h2 class="section-title">Notes</h2>
          <button class="btn btn-sm" onClick=${() => openModal(NoteForm, { jobId: job.id })}><${Icon} name="plus" />Add a note</button>
        </div>
        <div class="list">
          ${jobNotes.length ? jobNotes.map(n => html`<${NoteCard} key=${n.id} note=${n} showJob=${false} />`)
                            : html`<p class="hint">No notes on this job yet.</p>`}
        </div>`}
    </div>`;
}

/** Where the job is on the way from Ready to Complete. */
function Stepper({ stage }){
  const at = stageIndex(stage);
  return html`
    <ol class="stepper" aria-label="Stages">
      ${STAGES.map((s, i) => {
        const state = i < at || stage === 'complete' ? 'done' : i === at ? 'current' : '';
        return html`
          <li key=${s.id} class=${`step ${state}`} aria-current=${state === 'current' ? 'step' : undefined}>
            <span class="step-dot">${state === 'done' ? html`<${Icon} name="check" />` : i + 1}</span>
            <span>${s.label}</span>
          </li>`;
      })}
    </ol>`;
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
      <div class="fact-value">${value}%</div>
      ${editable
        ? html`<input type="range" min="0" max="100" step="5" value=${value} aria-label="Percent complete"
                      onInput=${e => setDraft(Number(e.currentTarget.value))} onChange=${commit} />`
        : html`<${Progress} value=${value} />`}
    </div>`;
}
