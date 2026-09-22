/** A job in a list: what it is, where it is, when it's due, what's next. */
import { html } from '../vendor/index.js';
import { stageLabel, nextStage, stageProgress } from '../../shared/procedure.js';
import { dueStatus } from '../lib/jobs.js';
import { fmtDate, fmtDue } from '../lib/format.js';
import { jobLink, navigate } from '../lib/router.js';
import { useCan } from '../lib/permissions.js';
import { openModal } from '../ui/overlays.js';
import { Progress } from '../ui/kit.js';
import { Icon } from '../ui/icons.js';
import { advance } from './stage.js';
import { JobForm } from './JobForm.js';
import { BlockerForm } from '../screens/Blockers.js';

export function Thumbnail({ job }){
  const bp = job.blueprint;
  if(!bp || !bp.hasThumbnail){
    return html`<div class="thumb thumb-empty" title="No drawing scanned yet"><${Icon} name="drawing" size=${26} /></div>`;
  }
  const img = html`<img src=${`/api/blueprints/${bp.id}/thumbnail`} alt=${`Drawing for ${job.jobNumber}`} loading="lazy" />`;
  return bp.hasFile
    ? html`<a class="thumb" href=${`/api/blueprints/${bp.id}/file`} target="_blank" rel="noopener"
              title="Open the drawing" onClick=${e => e.stopPropagation()}>${img}</a>`
    : html`<div class="thumb">${img}</div>`;
}

export function JobCard({ job, blocked }){
  const canWork = useCan('job.work');
  const canManage = useCan('job.manage');
  const status = dueStatus(job);
  const to = nextStage(job.stage);
  const progress = stageProgress(job.checklist, job.stage);
  const parts = job.blueprint ? job.blueprint.components.length : 0;
  const open = () => navigate(jobLink(job.id));
  const stop = fn => e => { e.stopPropagation(); fn(); };

  return html`
    <article class=${`job-card due-${status}`} onClick=${open}>
      <div class="job-card-main">
        <${Thumbnail} job=${job} />
        <div class="job-card-body">
          <div class="job-card-top">
            <div>
              <a class="job-num" href=${jobLink(job.id)} onClick=${e => e.stopPropagation()}>${job.jobNumber}</a>
              <div class="job-cust">${job.customer}</div>
            </div>
            <span class=${`badge prio-${job.priority.toLowerCase()}`}>${job.priority}</span>
          </div>
          ${job.description && html`<div class="job-desc">${job.description}</div>`}
          <div class="job-meta">
            <span>Stage <b>${stageLabel(job.stage)}</b></span>
            ${job.assignedName && html`<span>Lead <b>${job.assignedName}</b></span>`}
            <span>Due <b>${fmtDate(job.dueDate) || '—'}</b> <span class=${`due-tag due-${status}`}>${status === 'complete' ? 'Complete' : fmtDue(job.dueDate)}</span></span>
            ${blocked && html`<span class="blocked-tag">⚠ Blocked</span>`}
          </div>
          ${job.percentComplete > 0 && html`<${Progress} value=${job.percentComplete} label=${`${job.percentComplete}% complete`} />`}
        </div>
      </div>
      <div class="job-card-actions">
        ${to && canWork && html`
          <button class="btn btn-primary btn-sm" onClick=${stop(() => advance(job))}>
            Advance ▸ ${stageLabel(to)}${progress.total ? ` (${progress.done}/${progress.total})` : ''}
          </button>`}
        <button class="btn btn-sm" onClick=${stop(open)}><${Icon} name="drawing" size=${16} /> Drawing${parts ? ` (${parts})` : ''}</button>
        ${canManage && html`<button class="btn btn-sm" onClick=${stop(() => openModal(JobForm, { job }))}>Edit</button>`}
        <button class="btn btn-sm" onClick=${stop(() => openModal(BlockerForm, { jobId: job.id }))}>Blocker</button>
      </div>
    </article>`;
}
