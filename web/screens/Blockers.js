/**
 * Blockers: whatever is stopping a job right now, until it is resolved.
 */
import { html, useState } from '../vendor/index.js';
import { useStore } from '../lib/store.js';
import { reportBlocker, setBlockerStatus, deleteBlocker } from '../lib/actions.js';
import { useCan } from '../lib/permissions.js';
import { fmtDate } from '../lib/format.js';
import { jobLink } from '../lib/router.js';
import { todayISO } from '../../shared/dates.js';
import { Chips, Empty, Field, Select, AsyncButton, submitting } from '../ui/kit.js';
import { openModal, Sheet, confirmAction, toast, toastError } from '../ui/overlays.js';

const STATUSES = ['Open', 'In Progress', 'Resolved'];
const NEXT_LABEL = { 'In Progress': 'Start working on it', Resolved: 'Mark resolved', Open: 'Reopen' };
const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];
const DEPARTMENTS = ['Purchasing', 'Engineering', 'QC', 'Maintenance', 'Shipping', 'Production'];

const FILTERS = [
  { id: 'active', label: 'Active', test: b => b.status !== 'Resolved' },
  { id: 'Open', label: 'Open', test: b => b.status === 'Open' },
  { id: 'In Progress', label: 'In progress', test: b => b.status === 'In Progress' },
  { id: 'Resolved', label: 'Resolved', test: b => b.status === 'Resolved' },
  { id: 'all', label: 'All', test: () => true }
];

export function Blockers(){
  const blockers = useStore(s => s.blockers);
  const [filter, setFilter] = useState('active');
  const f = FILTERS.find(x => x.id === filter);
  const shown = blockers.filter(f.test);
  return html`
    <div class="toolbar">
      <${Chips} label="Show" value=${filter} onChange=${setFilter}
                options=${FILTERS.map(x => ({ id: x.id, label: x.label, count: blockers.filter(x.test).length }))} />
    </div>
    <div class="list">
      ${shown.length ? shown.map(b => html`<${BlockerCard} key=${b.id} blocker=${b} showJob=${true} />`)
                     : html`<div class="card"><${Empty} icon="checkCircle">${filter === 'active' ? 'Nothing is blocked right now.' : 'No blockers here.'}<//></div>`}
    </div>`;
}

export function BlockerCard({ blocker: b, showJob }){
  const canManage = useCan('blocker.manage');
  const next = STATUSES[(STATUSES.indexOf(b.status) + 1) % STATUSES.length];
  const remove = async () => {
    if(!(await confirmAction({ title: 'Delete blocker', message: `Delete "${b.issue}" on ${b.jobNumber}? This cannot be undone.`,
                               confirmLabel: 'Delete', danger: true }))) return;
    deleteBlocker(b).then(() => toast('Blocker deleted.'), toastError);
  };
  return html`
    <div class=${`blocker sev-${b.severity.toLowerCase()} status-${b.status === 'Resolved' ? 'resolved' : 'open'}`}>
      <div class="blocker-top">
        <div>
          ${showJob && html`<a class="job-num" href=${jobLink(b.jobId)}>${b.jobNumber}</a>`}
          <div class="job-cust">${[b.department, `reported ${fmtDate(b.reportedOn)}`, b.reportedByName && `by ${b.reportedByName}`].filter(Boolean).join(' · ')}</div>
        </div>
        <span class=${`sev sev-${b.severity.toLowerCase()}`}>${b.severity}</span>
      </div>
      <div class="blocker-issue">${b.issue}</div>
      <div class="card-actions">
        <span class=${`pill pill-${b.status.replace(' ', '').toLowerCase()}`}>${b.status}</span>
        ${b.status === 'Resolved' && b.resolvedByName && html`<span class="hint">by ${b.resolvedByName}</span>`}
        ${canManage && html`
          <${AsyncButton} class="btn btn-sm" onClick=${() => setBlockerStatus(b, next)}>${NEXT_LABEL[next]}<//>
          <button class="btn btn-sm btn-danger-outline" onClick=${remove}>Delete</button>`}
      </div>
    </div>`;
}

export function BlockerForm({ jobId, close }){
  const jobs = useStore(s => s.jobs);
  const blockers = useStore(s => s.blockers);
  const departments = [...new Set([...DEPARTMENTS, ...blockers.map(b => b.department).filter(Boolean)])];
  const submit = submitting(async f => {
    await reportBlocker({ jobId: f.jobId, issue: f.issue, department: f.department, severity: f.severity, reportedOn: f.reportedOn });
    toast('Blocker reported.', { kind: 'ok' });
    close();
  });
  return html`
    <${Sheet} title="Report a blocker" close=${close}>
      <form onSubmit=${submit}>
        <${Field} label="Job">
          <${Select} name="jobId" value=${jobId || ''} required
                     options=${[{ value: '', label: 'Pick a job…' }, ...jobs.map(j => ({ value: j.id, label: `${j.jobNumber} -- ${j.customer}` }))]} />
        <//>
        <${Field} label="What's blocking it?"><textarea name="issue" required rows="3"></textarea><//>
        <${Field} label="Responsible department">
          <input name="department" list="blocker-departments" placeholder="e.g. Purchasing" />
          <datalist id="blocker-departments">${departments.map(d => html`<option key=${d} value=${d} />`)}</datalist>
        <//>
        <div class="field-row">
          <${Field} label="Severity"><${Select} name="severity" value="Medium" options=${SEVERITIES} /><//>
          <${Field} label="Reported"><input name="reportedOn" type="date" defaultValue=${todayISO()} /><//>
        </div>
        <button type="submit" class="btn btn-primary btn-block">Report blocker</button>
      </form>
    <//>`;
}
