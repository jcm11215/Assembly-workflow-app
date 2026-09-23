/**
 * The engineering and purchasing error log. One error is a story; a
 * couple of hundred sorted by department, category and the stage that
 * caught them answers "what do we keep getting wrong" -- which is why
 * the breakdown is here.
 */
import { html, useState } from '../vendor/index.js';
import { useStore } from '../lib/store.js';
import { logError, setErrorStatus, deleteError } from '../lib/actions.js';
import { useCan } from '../lib/permissions.js';
import { fmtDate } from '../lib/format.js';
import { jobLink } from '../lib/router.js';
import { STAGES, stageLabel } from '../../shared/procedure.js';
import { ERROR_DEPARTMENTS, department, categoryLabel, costSummary, totals, byCategory, byStageCaught, byJob } from '../../shared/errors.js';
import { Chips, Empty, Field, Select, submitting } from '../ui/kit.js';
import { openModal, Sheet, confirmAction, toast, toastError } from '../ui/overlays.js';

const STATUS_FILTERS = [
  { id: 'open', label: 'Open', test: e => e.status !== 'Corrected' },
  { id: 'corrected', label: 'Corrected', test: e => e.status === 'Corrected' },
  { id: 'all', label: 'All', test: () => true }
];

export function Errors(){
  const errors = useStore(s => s.errors);
  const [dept, setDept] = useState('all');
  const [status, setStatus] = useState('all');
  const [breakdown, setBreakdown] = useState(false);

  const list = errors.filter(e => (dept === 'all' || e.department === dept) && STATUS_FILTERS.find(s => s.id === status).test(e));
  const t = totals(list);
  const deptOptions = [{ id: 'all', label: 'All', count: errors.length },
    ...ERROR_DEPARTMENTS.map(d => ({ id: d.id, label: d.label, count: errors.filter(e => e.department === d.id).length }))
      .filter(o => o.count)];

  return html`
    <div class="stat-grid">
      <div class="stat"><b>${t.total}</b><span>Errors</span></div>
      <div class="stat"><b>${t.open}</b><span>Still open</span></div>
      <div class="stat"><b>${t.jobsAffected}</b><span>Jobs hit</span></div>
      <div class="stat"><b>${t.reworkHours}</b><span>Rework hrs</span>
        ${t.timedCount < t.total && html`<small>${t.timedCount} of ${t.total} timed</small>`}</div>
    </div>

    <div class="toolbar">
      <${Chips} label="Department" value=${dept} onChange=${setDept} options=${deptOptions} />
      <${Chips} label="Status" value=${status} onChange=${setStatus} options=${STATUS_FILTERS} />
    </div>

    ${list.length >= 3 && html`
      <div style=${{ marginBottom: '12px' }}><button class="btn btn-sm" onClick=${() => setBreakdown(!breakdown)}>${breakdown ? 'Hide the breakdown' : 'Show the breakdown'}</button></div>
      ${breakdown && html`<${Breakdown} list=${list} />`}`}

    <div class="list">
      ${list.length ? list.map(e => html`<${ErrorCard} key=${e.id} error=${e} showJob=${true} />`)
                    : html`<div class="card"><${Empty} icon="flag">${errors.length ? 'No errors match.' : 'No errors logged yet.'}<//></div>`}
    </div>`;
}

function Bars({ rows }){
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  return html`
    <div class="bars">
      ${rows.map(r => html`
        <div class="bar-label">${r.label}${r.sub && html`<span class="bar-sub">${r.sub}</span>`}</div>
        <div class="bar-track"><div class="bar-fill" style=${{ width: `${max ? Math.max(3, Math.round(r.count / max * 100)) : 0}%`, background: r.color }}></div></div>
        <b class="bar-n">${r.count}</b>`)}
    </div>`;
}

function Breakdown({ list }){
  const jobs = byJob(list, 5);
  return html`
    <div class="breakdown">
      <h3 class="section-title">What we get wrong most</h3>
      <${Bars} rows=${byCategory(list, 6).map(c => ({ label: c.label, sub: c.departmentLabel, count: c.count, color: c.color }))} />
      <h3 class="section-title">Where they get caught</h3>
      <p class="hint">The same mistake costs minutes at layout and a teardown at final assembly. Errors bunched at the late
        stages mean the checks are happening too late -- a different problem from making more of them.</p>
      <${Bars} rows=${byStageCaught(list).map(s => ({ label: s.label, count: s.count, color: 'var(--accent)' }))} />
      ${jobs.length > 1 && html`
        <h3 class="section-title">Jobs with the most</h3>
        <${Bars} rows=${jobs.map(j => ({ label: j.jobNumber, sub: j.open ? `${j.open} open` : 'all corrected', count: j.count, color: 'var(--text-faint)' }))} />`}
    </div>`;
}

export function ErrorCard({ error: e, showJob }){
  const canClose = useCan('error.close');
  const canDelete = useCan('error.delete');
  const corrected = e.status === 'Corrected';
  const d = department(e.department);
  const cost = costSummary(e);

  const toggle = async () => {
    if(corrected){ setErrorStatus(e, 'Open').catch(toastError); return; }
    openModal(CorrectForm, { error: e });
  };
  const remove = async () => {
    if(!(await confirmAction({ title: 'Delete error', message: `Delete this logged error on ${e.jobNumber}? The record of what went wrong goes with it.`,
                               confirmLabel: 'Delete', danger: true }))) return;
    deleteError(e).then(() => toast('Error deleted.'), toastError);
  };

  return html`
    <div class=${`err${corrected ? ' corrected' : ''}`} style=${{ borderLeftColor: d.color }}>
      <div class="err-top">
        <div>
          ${showJob && html`<a class="job-num" href=${jobLink(e.jobId)}>${e.jobNumber}</a>`}
          <div class="job-cust">
            ${e.foundAtStage === 'unknown' ? 'Stage not recorded' : `Caught at ${stageLabel(e.foundAtStage)}`}
            · ${fmtDate(e.reportedAt.slice(0, 10))}${e.reportedByName ? ` by ${e.reportedByName}` : ''}
          </div>
        </div>
        <span class="err-dept" style=${{ background: d.color }}>${d.label}</span>
      </div>
      <div class="err-cat">${categoryLabel(e.department, e.category)}</div>
      <div class="err-desc">${e.description}</div>
      ${cost && html`<div class="err-cost">${cost}</div>`}
      ${e.correction && html`<div class="err-fix"><b>Correction:</b> ${e.correction}</div>`}
      <div class="card-actions">
        <span class=${`pill pill-${corrected ? 'resolved' : 'open'}`}>${e.status}</span>
        ${canClose && html`<button class="btn btn-sm" onClick=${toggle}>${corrected ? 'Reopen' : 'Mark corrected'}</button>`}
        ${canDelete && html`<button class="btn btn-sm btn-danger-outline" onClick=${remove}>Delete</button>`}
      </div>
    </div>`;
}

function CorrectForm({ error, close }){
  const submit = submitting(async f => {
    await setErrorStatus(error, 'Corrected', f.correction);
    toast('Marked corrected.', { kind: 'ok' });
    close();
  });
  return html`
    <${Sheet} title="Mark corrected" close=${close} small>
      <form onSubmit=${submit}>
        <${Field} label="What was done about it? (optional)"><textarea name="correction" rows="3" defaultValue=${error.correction}></textarea><//>
        <button type="submit" class="btn btn-primary btn-block">Mark corrected</button>
      </form>
    <//>`;
}

export function ErrorForm({ jobId, close }){
  const jobs = useStore(s => s.jobs);
  const [dept, setDept] = useState(ERROR_DEPARTMENTS[0].id);
  const submit = submitting(async f => {
    await logError({
      jobId: f.jobId, department: f.department, category: f.category, description: f.description,
      foundAtStage: f.foundAtStage, reworkHours: f.reworkHours === '' ? null : f.reworkHours,
      causedDelay: f.causedDelay === 'on', scrapped: f.scrapped === 'on'
    });
    toast('Error logged.', { kind: 'ok' });
    close();
  });
  return html`
    <${Sheet} title="Log an error" close=${close}>
      <form onSubmit=${submit}>
        <${Field} label="Job">
          <${Select} name="jobId" value=${jobId || ''} required
                     options=${[{ value: '', label: 'Pick a job…' }, ...jobs.map(j => ({ value: j.id, label: `${j.jobNumber} -- ${j.customer}` }))]} />
        <//>
        <${Field} label="Where did it come from?">
          <${Select} name="department" value=${dept} onChange=${e => setDept(e.currentTarget.value)}
                     options=${ERROR_DEPARTMENTS.map(d => ({ value: d.id, label: d.label }))} />
        <//>
        <${Field} label="What kind of error?">
          <${Select} key=${dept} name="category" value=${department(dept).categories[0].id}
                     options=${department(dept).categories.map(c => ({ value: c.id, label: c.label }))} />
        <//>
        <${Field} label="What happened?">
          <textarea name="description" required rows="3" placeholder="e.g. Drawing called for a 2-7/16 bore; the shaft supplied is 2-3/16"></textarea>
        <//>
        <div class="field-row">
          <${Field} label="Which stage caught it?">
            <${Select} name="foundAtStage" value="unknown"
                       options=${[...STAGES.map(s => ({ value: s.id, label: s.label })), { value: 'unknown', label: 'Not sure' }]} />
          <//>
          <${Field} label="Rework hours"><input name="reworkHours" type="number" min="0" step="0.25" placeholder="blank if not timed" /><//>
        </div>
        <label class="check"><input type="checkbox" name="causedDelay" /> It pushed the ship date</label>
        <label class="check"><input type="checkbox" name="scrapped" /> Material had to be scrapped</label>
        <button type="submit" class="btn btn-primary btn-block">Log error</button>
      </form>
    <//>`;
}
