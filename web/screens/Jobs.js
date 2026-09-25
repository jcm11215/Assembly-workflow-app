/**
 * Every job: search, filter, and see them as a list or as a board of
 * stages. Tapping a job opens its page, where the work happens.
 */
import { html, useState } from '../vendor/index.js';
import { useStore, setState } from '../lib/store.js';
import { jobFilters, blockedJobIds, dueStatus, matchesSearch } from '../lib/jobs.js';
import { stageLabel } from '../../shared/procedure.js';
import { daysUntil } from '../../shared/dates.js';
import { navigate, jobLink } from '../lib/router.js';
import { fmtDate, fmtDue } from '../lib/format.js';
import { PageHeader, Chips, Empty, Segmented } from '../ui/kit.js';
import { Icon } from '../ui/icons.js';
import { NewJobButtons } from './Home.js';
import { Board } from './Board.js';

const VIEW_KEY = 'awt.jobsView';
const savedView = () => { try { return localStorage.getItem(VIEW_KEY) || 'list'; } catch { return 'list'; } };

export function Jobs({ query = {} }){
  const jobs = useStore(s => s.jobs);
  const blockers = useStore(s => s.blockers);
  const filterId = useStore(s => s.jobFilter);
  const [search, setSearch] = useState('');
  const [view, setViewState] = useState(query.view || savedView());
  const setView = v => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ } };

  const filters = jobFilters(blockers);
  const filter = filters.find(f => f.id === (query.filter || filterId)) || filters[0];
  const blocked = blockedJobIds(blockers);
  const shown = jobs
    .filter(filter.test)
    .filter(j => matchesSearch(j, search))
    .sort((a, b) => (a.dueDate ? daysUntil(a.dueDate) : 9999) - (b.dueDate ? daysUntil(b.dueDate) : 9999));

  return html`
    <${PageHeader} title="Jobs" sub=${`${jobs.filter(j => j.stage !== 'complete').length} open`} actions=${html`<${NewJobButtons} />`} />

    <div class="toolbar">
      <input type="search" class="search" placeholder="Search by job number, customer or description"
             value=${search} onInput=${e => setSearch(e.currentTarget.value)} aria-label="Search jobs" />
      <${Segmented} label="View" value=${view} onChange=${setView}
                    options=${[{ id: 'list', label: 'List', icon: 'list' }, { id: 'board', label: 'Board', icon: 'columns' }]} />
    </div>

    ${view === 'board'
      ? html`<${Board} jobs=${jobs.filter(j => matchesSearch(j, search))} />`
      : html`
        <div class="toolbar">
          <${Chips} label="Filter jobs" value=${filter.id} onChange=${id => setState({ jobFilter: id })}
                    options=${filters.map(f => ({ id: f.id, label: f.label, count: jobs.filter(f.test).length }))} />
        </div>
        ${shown.length
          ? html`<${JobTable} jobs=${shown} blocked=${blocked} /><${JobCards} jobs=${shown} blocked=${blocked} />`
          : html`<div class="card"><${Empty} icon="jobs">${jobs.length ? 'No jobs match.' : 'No jobs yet.'}<//></div>`}`}`;
}

export function Thumbnail({ job, large }){
  const bp = job.blueprint;
  const cls = `thumb${large ? ' thumb-lg' : ''}`;
  if(!bp || !bp.hasThumbnail) return html`<div class=${cls} title="No drawing yet"><${Icon} name="drawing" /></div>`;
  return html`<div class=${cls}><img src=${`/api/blueprints/${bp.id}/thumbnail`} alt="" loading="lazy" /></div>`;
}

const DueCell = ({ job }) => {
  const status = dueStatus(job);
  return html`
    <div>${fmtDate(job.dueDate) || '—'}</div>
    ${status !== 'ok' && html`<span class=${`due-tag due-${status}`}>${status === 'complete' ? 'Complete' : fmtDue(job.dueDate)}</span>`}`;
};

const StageCell = ({ job }) => html`
  <div>${stageLabel(job.stage)}</div>
  <div class="mini-progress"><div class="gauge-track"><div class="gauge-fill" style=${{ width: `${job.percentComplete}%` }}></div></div>${job.percentComplete}%</div>`;

function JobTable({ jobs, blocked }){
  return html`
    <div class="card jobs-table">
      <table class="table">
        <thead><tr><th>Job</th><th>Stage</th><th>Lead</th><th>Due</th><th>Priority</th></tr></thead>
        <tbody>
          ${jobs.map(j => html`
            <tr key=${j.id} onClick=${() => navigate(jobLink(j.id))}>
              <td>
                <div class="cell-job">
                  <${Thumbnail} job=${j} />
                  <div style=${{ minWidth: 0 }}>
                    <a class="num" href=${jobLink(j.id)} style=${{ color: 'var(--text)' }}>${j.jobNumber}</a>
                    ${blocked.has(j.id) && html` <span class="blocked-tag">Blocked</span>`}
                    <div class="sub cell-clip">${[j.customer, j.description].filter(Boolean).join(' · ')}</div>
                  </div>
                </div>
              </td>
              <td><${StageCell} job=${j} /></td>
              <td>${j.assignedName || html`<span class="hint">Unassigned</span>`}</td>
              <td><${DueCell} job=${j} /></td>
              <td><span class=${`badge prio-${j.priority.toLowerCase()}`}>${j.priority}</span></td>
            </tr>`)}
        </tbody>
      </table>
    </div>`;
}

function JobCards({ jobs, blocked }){
  return html`
    <div class="jobs-cards">
      ${jobs.map(j => {
        const status = dueStatus(j);
        return html`
          <a key=${j.id} class=${`card job-tile edge-${status}`} href=${jobLink(j.id)}>
            <div class="job-tile-top">
              <div style=${{ minWidth: 0 }}>
                <div class="num">${j.jobNumber}</div>
                <div class="hint">${j.customer}</div>
              </div>
              <span class=${`badge prio-${j.priority.toLowerCase()}`}>${j.priority}</span>
            </div>
            <div class="job-tile-meta">
              <span>${stageLabel(j.stage)} · ${j.percentComplete}%</span>
              ${blocked.has(j.id) && html`<span class="blocked-tag">Blocked</span>`}
              ${j.dueDate && html`<span class=${`due-tag due-${status}`}>${status === 'complete' ? 'Complete' : fmtDue(j.dueDate)}</span>`}
            </div>
          </a>`;
      })}
    </div>`;
}
