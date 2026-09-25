/**
 * Home: an interactive dashboard of the shop. Headline numbers, where
 * the open jobs are, when they're due, who leads them and how many were
 * finished each week -- all sharing one set of filters. Clicking a
 * number or a bar filters everything else, including the list of jobs.
 * Today's tasks and the assistant sit alongside.
 */
import { html, useRef, useState } from '../vendor/index.js';
import { useStore, setState } from '../lib/store.js';
import { dashboard, describeFilters, DUE_SERIES, NO_FILTERS } from '../lib/dashboard.js';
import { blockedJobIds, dueStatus, DUE_LABEL } from '../lib/jobs.js';
import { stageLabel } from '../../shared/procedure.js';
import { useCan } from '../lib/permissions.js';
import { navigate, jobLink } from '../lib/router.js';
import { fmtDue } from '../lib/format.js';
import { PageHeader, Segmented, Empty } from '../ui/kit.js';
import { ChartCard, HBars, Columns } from '../ui/charts.js';
import { Icon } from '../ui/icons.js';
import { openModal, toastError } from '../ui/overlays.js';
import { JobForm } from '../jobs/JobForm.js';
import { TodayTasks } from './Tasks.js';

function greeting(){
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export const newFromDrawing = () => import('../scan/ScanDialog.js')
  .then(m => openModal(m.NewJobFromDrawing))
  .catch(toastError);

/** "New job" and "From a drawing", for whoever may create jobs. */
export function NewJobButtons(){
  if(!useCan('job.manage')) return null;
  return html`
    <button class="btn" onClick=${newFromDrawing}><${Icon} name="scan" />From a drawing</button>
    <button class="btn btn-primary" onClick=${() => openModal(JobForm)}><${Icon} name="plus" />New job</button>`;
}

/** The due-status colors, the same in every chart. */
const COLOR = { overdue: 'var(--viz-overdue)', soon: 'var(--viz-soon)', later: 'var(--viz-later)' };
const SERIES = DUE_SERIES.map(s => ({ ...s, color: COLOR[s.id] }));
const BUCKET_COLOR = { overdue: COLOR.overdue, d7: COLOR.soon };
const PRIORITIES = [{ id: '', label: 'All' }, { id: 'High', label: 'High' }, { id: 'Medium', label: 'Medium' }, { id: 'Low', label: 'Low' }];

const splitTable = (first, rows) => ({
  head: [first, ...SERIES.map(s => s.label), 'Total'],
  rows: rows.map(r => [r.fullLabel || r.label, ...SERIES.map(s => r.values[s.id]), r.total])
});

export function Home(){
  const me = useStore(s => s.me);
  const jobs = useStore(s => s.jobs);
  const blockers = useStore(s => s.blockers);
  const f = useStore(s => s.homeFilters);
  const listRef = useRef(null);

  const set = patch => setState(s => ({ homeFilters: { ...s.homeFilters, ...patch } }));
  const d = dashboard(jobs, blockers, f);
  const chips = describeFilters(f, d.leadOptions);
  const filtered = chips.length > 0;

  const header = html`
    <div class="greeting">
      <${PageHeader} title=${`${greeting()}, ${me.fullName.split(' ')[0]}`}
                     sub=${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                     actions=${html`<${NewJobButtons} />`} />
    </div>`;

  if(!jobs.length){
    return html`
      ${header}
      <div class="grid-2">
        <section class="card"><${Empty} icon="jobs">No jobs yet. Once there are, this page shows where they all stand.<//></section>
        <div class="stack"><${TasksCard} /><${Ask} /></div>
      </div>`;
  }

  const t = d.tiles;
  const tiles = [
    { id: 'open', label: 'Open jobs', n: t.open, icon: 'jobs', pressed: null, onClick: () => set({ due: '', blocked: false }) },
    { id: 'soon', label: 'Due in 7 days', n: t.soon, icon: 'clock', tone: 'amber', pressed: f.due === 'd7', onClick: () => set({ due: f.due === 'd7' ? '' : 'd7' }) },
    { id: 'overdue', label: 'Overdue', n: t.overdue, icon: 'alert', tone: 'red', pressed: f.due === 'overdue', onClick: () => set({ due: f.due === 'overdue' ? '' : 'overdue' }) },
    { id: 'blocked', label: 'Blocked', n: t.blocked, icon: 'issues', tone: 'red', pressed: f.blocked, onClick: () => set({ blocked: !f.blocked }) }
  ];

  return html`
    ${header}

    <div class="dash-filters" role="group" aria-label="Filter the dashboard">
      <label class="dash-select">
        <span>Lead</span>
        <select value=${f.lead} onChange=${e => set({ lead: e.currentTarget.value })}>
          <option value="">Everyone</option>
          ${d.leadOptions.map(o => html`<option key=${o.id} value=${o.id}>${o.label}</option>`)}
          ${f.lead && !d.leadOptions.some(o => o.id === f.lead) && html`<option value=${f.lead}>Someone else</option>`}
        </select>
      </label>
      <${Segmented} label="Priority" value=${f.priority} onChange=${priority => set({ priority })} options=${PRIORITIES} />
      ${chips.filter(c => !['lead', 'priority'].includes(c.key)).map(c => html`
        <button key=${c.key} type="button" class="filter-chip" onClick=${() => set({ [c.key]: NO_FILTERS[c.key] })}
                aria-label=${`Remove filter ${c.label}`}>${c.label}<${Icon} name="close" /></button>`)}
      ${filtered && html`
        <button type="button" class="link-btn" onClick=${() => setState({ homeFilters: { ...NO_FILTERS } })}>Clear filters</button>
        <button type="button" class="btn btn-sm dash-see" onClick=${() => listRef.current && listRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
          See ${d.jobs.length} ${d.jobs.length === 1 ? 'job' : 'jobs'}
        </button>`}
    </div>

    <div class="stats">
      ${tiles.map(tile => html`
        <button key=${tile.id} type="button" onClick=${tile.onClick} aria-pressed=${tile.pressed == null ? undefined : tile.pressed}
                class=${`stat-tile${tile.n ? (tile.tone ? ` tone-${tile.tone}` : '') : ' zero'}`}>
          <span class="stat-label"><${Icon} name=${tile.icon} size=${17} />${tile.label}</span>
          <span class="stat-value">${tile.n}</span>
        </button>`)}
    </div>

    <div class="dash-grid">
      <div class="dash-col">
        <${ChartCard} class="o-1" title="Where the jobs are" sub="Open jobs by stage. Pick a stage to see its jobs."
                      legend=${SERIES} table=${splitTable('Stage', d.stages)}>
          <${HBars} label="Open jobs by stage" rows=${d.stages} series=${SERIES} selected=${f.stage} onSelect=${stage => set({ stage })} />
        <//>

        <div ref=${listRef} class="dash-list o-3">
          <${InView} jobs=${d.jobs} blockers=${blockers} filtered=${filtered}
                     onClear=${() => setState({ homeFilters: { ...NO_FILTERS } })} />
        </div>

        <${ChartCard} class="o-5" title="Finished" sub=${`Jobs completed each week${f.lead || f.priority ? ', for the lead and priority picked' : ''}`}
                      table=${{ head: ['Week', 'Completed'], rows: d.completed.map(w => [w.current ? 'This week' : `Week of ${w.label}`, w.value]) }}>
          <${Columns} label="Jobs completed each week" tipTitle=${w => (w.current ? 'This week' : `Week of ${w.label}`)}
                      cols=${d.completed.map(w => ({ ...w, color: 'var(--viz-done)' }))} unit="completed" />
        <//>
      </div>

      <div class="dash-col">
        <${ChartCard} class="o-2" title="When they're due" sub="Open jobs by due date"
                      table=${{ head: ['Due', 'Jobs'], rows: d.due.map(b => [b.label, b.value]) }}>
          <${Columns} label="Open jobs by due date" selected=${f.due} onSelect=${due => set({ due })}
                      cols=${d.due.map(b => ({ ...b, color: BUCKET_COLOR[b.id] || COLOR.later }))} />
        <//>

        <${ChartCard} class="o-4" title="Who's leading what" sub="Open jobs by lead. Pick someone to see only theirs."
                      legend=${SERIES} table=${splitTable('Lead', d.leads)}>
          ${d.leads.length
            ? html`<${HBars} label="Open jobs by lead" rows=${d.leads} series=${SERIES} selected=${f.lead} onSelect=${lead => set({ lead })} />`
            : html`<p class="hint">No open jobs match.</p>`}
        <//>

        <div class="o-6"><${TasksCard} /></div>
        <div class="o-7"><${Ask} /></div>
      </div>
    </div>`;
}

/** The open jobs the filters leave, most urgent first. */
function InView({ jobs, blockers, filtered, onClear }){
  const [all, setAll] = useState(false);
  const blocked = blockedJobIds(blockers);
  const shown = all ? jobs : jobs.slice(0, 7);
  return html`
    <section class="card">
      <div class="card-head">
        <h2>${filtered ? `${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'} in view` : 'Open jobs, most urgent first'}</h2>
        <a href="#/jobs" class="hint">All jobs</a>
      </div>
      ${jobs.length ? shown.map(j => {
        const status = dueStatus(j);
        return html`
          <a key=${j.id} class="attention-row" href=${jobLink(j.id)}>
            <div class="attention-main">
              <div class="attention-num">${j.jobNumber} <span class="hint">· ${j.customer}</span></div>
              <div class="attention-sub">${stageLabel(j.stage)} · ${j.percentComplete}%${j.assignedName ? ` · ${j.assignedName}` : ''}</div>
            </div>
            <div class="attention-tags">
              ${blocked.has(j.id) && html`<span class="blocked-tag">Blocked</span>`}
              ${j.dueDate && status !== 'ok' && html`<span class=${`due-tag due-${status}`}>${status === 'overdue' ? fmtDue(j.dueDate) : DUE_LABEL[status]}</span>`}
            </div>
          </a>`;
      }) : filtered
        ? html`<div class="calm"><${Icon} name="inbox" size=${24} />No open jobs match these filters.
                 <button type="button" class="link-btn" onClick=${onClear}>Clear filters</button></div>`
        : html`<div class="calm"><${Icon} name="checkCircle" size=${24} />No open jobs. Everything is finished.</div>`}
      ${jobs.length > 7 && html`
        <div class="card-foot">
          <button type="button" class="link-btn" onClick=${() => setAll(!all)}>${all ? 'Show fewer' : `Show all ${jobs.length}`}</button>
        </div>`}
    </section>`;
}

function TasksCard(){
  return html`
    <section class="card">
      <div class="card-head"><h2>Today's tasks</h2><a href="#/tasks" class="hint">All tasks</a></div>
      <${TodayTasks} />
    </section>`;
}

/** Ask the assistant from Home; the answer opens on the Assistant screen. */
function Ask(){
  const ref = useRef(null);
  const ask = e => {
    e.preventDefault();
    const q = ref.current.value.trim() || 'What should the team focus on today? Rank the open jobs and say why.';
    setState({ assistantDraft: q });
    navigate('assistant');
  };
  return html`
    <section class="card card-pad">
      <h2 style=${{ fontSize: '15.5px', marginBottom: '4px' }}>Ask the assistant</h2>
      <p class="hint" style=${{ marginTop: 0 }}>It knows every job, blocker and note, and the shop's documents.</p>
      <form class="ask" onSubmit=${ask}>
        <input ref=${ref} placeholder="What should we focus on today?" aria-label="Ask the assistant" />
        <button type="submit" class="btn btn-primary" aria-label="Ask"><${Icon} name="send" /></button>
      </form>
    </section>`;
}
