/**
 * The home screen: what needs attention today, today's tasks, and every
 * job -- searchable, and filterable by the same buckets as the metric
 * tiles above.
 */
import { html, useState } from '../vendor/index.js';
import { useStore, setState } from '../lib/store.js';
import { jobFilters, focusOrder, blockedJobIds, dueStatus, matchesSearch, DUE_LABEL } from '../lib/jobs.js';
import { daysUntil } from '../../shared/dates.js';
import { useCan } from '../lib/permissions.js';
import { navigate, jobLink } from '../lib/router.js';
import { Chips, Empty } from '../ui/kit.js';
import { openModal, toastError } from '../ui/overlays.js';
import { JobCard } from '../jobs/JobCard.js';
import { JobForm } from '../jobs/JobForm.js';
import { TodayTasks } from './Tasks.js';

export function Dashboard(){
  const jobs = useStore(s => s.jobs);
  const blockers = useStore(s => s.blockers);
  const filterId = useStore(s => s.jobFilter);
  const canManage = useCan('job.manage');
  const [search, setSearch] = useState('');

  const filters = jobFilters(blockers);
  const filter = filters.find(f => f.id === filterId) || filters[0];
  const blocked = blockedJobIds(blockers);
  const shown = jobs
    .filter(filter.test)
    .filter(j => matchesSearch(j, search))
    .sort((a, b) => daysUntil(a.dueDate) - daysUntil(b.dueDate));

  const newFromDrawing = () => import('../scan/ScanDialog.js')
    .then(m => openModal(m.NewJobFromDrawing))
    .catch(toastError);

  return html`
    <${Focus} jobs=${jobs} blockers=${blockers} />
    <${TodayTasks} />

    <div class="toolbar">
      <input type="search" class="search" placeholder="Search job #, customer, description…"
             value=${search} onInput=${e => setSearch(e.currentTarget.value)} aria-label="Search jobs" />
      <${Chips} label="Filter jobs" value=${filter.id} onChange=${id => setState({ jobFilter: id })}
                options=${filters.map(f => ({ id: f.id, label: f.label, count: f.id === 'all' ? null : jobs.filter(f.test).length }))} />
    </div>

    <div class="job-list">
      ${shown.length
        ? shown.map(j => html`<${JobCard} key=${j.id} job=${j} blocked=${blocked.has(j.id)} />`)
        : html`<${Empty} icon="📋">${jobs.length ? 'No jobs match.' : 'No jobs yet.'}<//>`}
    </div>

    ${canManage && html`
      <div class="row-actions">
        <button class="btn btn-primary" onClick=${() => openModal(JobForm)}>+ New job</button>
        <button class="btn" onClick=${newFromDrawing}>📐 New job from a drawing</button>
      </div>`}`;
}

/** The three jobs most in need of attention, and a way to ask the
 *  assistant for a plan. */
function Focus({ jobs, blockers }){
  const top = focusOrder(jobs, blockers).slice(0, 3)
    .filter(j => ['overdue', 'soon'].includes(dueStatus(j)) || blockedJobIds(blockers).has(j.id));
  const ask = () => {
    setState({ assistantDraft: 'What should the shop focus on today? Rank the open jobs and say why.' });
    navigate('assistant');
  };
  return html`
    <section class="focus">
      <div class="focus-head">Today's focus</div>
      ${top.length
        ? html`<div class="focus-jobs">
            ${top.map(j => html`
              <a key=${j.id} class="focus-job" href=${jobLink(j.id)}>
                ${j.jobNumber}
                <span class=${`due-tag due-${dueStatus(j)}`}>${blockedJobIds(blockers).has(j.id) ? 'Blocked' : DUE_LABEL[dueStatus(j)]}</span>
              </a>`)}
          </div>`
        : html`<div class="focus-calm">✅ Nothing urgent -- the schedule looks on track.</div>`}
      <button class="btn btn-sm" onClick=${ask}>Ask the assistant for a plan ▸</button>
    </section>`;
}
