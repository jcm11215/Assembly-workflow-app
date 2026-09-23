/**
 * Home: how the shop stands at a glance, the jobs that need attention
 * first, today's tasks, and a quick way to ask the assistant.
 */
import { html, useRef } from '../vendor/index.js';
import { useStore, setState } from '../lib/store.js';
import { metrics, focusOrder, blockedJobIds, dueStatus, DUE_LABEL } from '../lib/jobs.js';
import { stageLabel } from '../../shared/procedure.js';
import { useCan } from '../lib/permissions.js';
import { navigate, jobLink } from '../lib/router.js';
import { fmtDue } from '../lib/format.js';
import { PageHeader } from '../ui/kit.js';
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

export function Home(){
  const me = useStore(s => s.me);
  const jobs = useStore(s => s.jobs);
  const blockers = useStore(s => s.blockers);
  const m = metrics(jobs, blockers);
  const openJobs = filter => { setState({ jobFilter: filter }); navigate('jobs'); };

  const tiles = [
    { id: 'open', label: 'Open jobs', n: m.open, icon: 'jobs' },
    { id: 'week', label: 'Due this week', n: m.dueThisWeek, icon: 'clock' },
    { id: 'overdue', label: 'Overdue', n: m.overdue, icon: 'alert', tone: 'red' },
    { id: 'blocked', label: 'Blocked', n: m.blocked, icon: 'issues', tone: 'red' }
  ];

  return html`
    <div class="greeting">
      <${PageHeader} title=${`${greeting()}, ${me.fullName.split(' ')[0]}`}
                     sub=${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                     actions=${html`<${NewJobButtons} />`} />
    </div>

    <div class="stats">
      ${tiles.map(t => html`
        <button key=${t.id} class=${`stat-tile${t.n ? (t.tone ? ` tone-${t.tone}` : '') : ' zero'}`} onClick=${() => openJobs(t.id)}>
          <span class="stat-label"><${Icon} name=${t.icon} size=${17} />${t.label}</span>
          <span class="stat-value">${t.n}</span>
        </button>`)}
    </div>

    <div class="grid-2">
      <${Attention} jobs=${jobs} blockers=${blockers} />
      <div class="stack">
        <section class="card">
          <div class="card-head"><h2>Today's tasks</h2><a href="#/tasks" class="hint">All tasks</a></div>
          <${TodayTasks} />
        </section>
        <${Ask} />
      </div>
    </div>`;
}

/** The open jobs most in need of attention: overdue, blocked, due soon. */
function Attention({ jobs, blockers }){
  const blocked = blockedJobIds(blockers);
  const top = focusOrder(jobs, blockers)
    .filter(j => blocked.has(j.id) || ['overdue', 'soon'].includes(dueStatus(j)))
    .slice(0, 6);
  return html`
    <section class="card">
      <div class="card-head"><h2>Needs attention</h2><a href="#/jobs" class="hint">All jobs</a></div>
      ${top.length ? top.map(j => {
        const status = dueStatus(j);
        return html`
          <a key=${j.id} class="attention-row" href=${jobLink(j.id)}>
            <div class="attention-main">
              <div class="attention-num">${j.jobNumber} <span class="hint">· ${j.customer}</span></div>
              <div class="attention-sub">${stageLabel(j.stage)}${j.assignedName ? ` · ${j.assignedName}` : ''}</div>
            </div>
            <div class="attention-tags">
              ${blocked.has(j.id) && html`<span class="blocked-tag">Blocked</span>`}
              ${status !== 'ok' && html`<span class=${`due-tag due-${status}`}>${status === 'overdue' ? fmtDue(j.dueDate) : DUE_LABEL[status]}</span>`}
            </div>
          </a>`;
      }) : html`
        <div class="calm"><${Icon} name="checkCircle" size=${24} />Nothing overdue or blocked. The schedule is on track.</div>`}
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
