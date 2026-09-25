/**
 * Create or edit a job's details (admins). A new job can come pre-filled
 * from a drawing the server has read (`scan`: {id, parts}); the scan is
 * saved to the job the moment the job exists.
 */
import { html } from '../vendor/index.js';
import { useStore } from '../lib/store.js';
import { createJob, updateJob, deleteJob, attachScan } from '../lib/actions.js';
import { navigate, jobLink } from '../lib/router.js';
import { todayISO } from '../../shared/dates.js';
import { Field, Select, submitting } from '../ui/kit.js';
import { Sheet, toast, confirmAction, toastError } from '../ui/overlays.js';

export function JobForm({ job, prefill = {}, scan = null, close }){
  const team = useStore(s => s.team.filter(u => u.active));
  const v = job || { jobNumber: '', customer: '', description: '', dueDate: todayISO(), priority: 'Medium', assignedTo: null, ...prefill };

  const submit = submitting(async f => {
    const fields = {
      jobNumber: f.jobNumber.trim(),
      customer: f.customer.trim(),
      description: f.description.trim(),
      dueDate: f.dueDate || null,
      priority: f.priority,
      assignedTo: f.assignedTo || null
    };
    if(job){
      await updateJob(job, fields);
      toast('Job saved.', { kind: 'ok' });
      close();
      return;
    }
    const created = await createJob(fields);
    close();
    navigate(jobLink(created.id));
    if(scan){
      try {
        await attachScan(scan.id, created);
        if(!scan.parts) toast('Job saved with the drawing, but the scan found no parts on it. Re-scan, or add parts by hand.', { ms: 8000 });
        else toast(`Job saved with ${scan.parts} parts from the drawing.`, { kind: 'ok' });
      } catch (e) {
        toastError(e, 'Job saved, but the scan could not be attached: ');
      }
    } else {
      toast('Job created.', { kind: 'ok' });
    }
  });

  const remove = async () => {
    const ok = await confirmAction({
      title: 'Delete job',
      message: `Delete ${job.jobNumber}${job.customer ? ` (${job.customer})` : ''}? Its blockers, notes, errors, tasks and drawings go with it. This cannot be undone.`,
      confirmLabel: 'Delete job', danger: true
    });
    if(!ok) return;
    try {
      await deleteJob(job);
      close();
      navigate('');
      toast('Job deleted.');
    } catch (e) { toastError(e); }
  };

  return html`
    <${Sheet} title=${job ? `Edit ${job.jobNumber}` : 'New job'} close=${close}>
      <form onSubmit=${submit}>
        <${Field} label="Job number"><input name="jobNumber" required defaultValue=${v.jobNumber} autocomplete="off" /><//>
        <${Field} label="Customer"><input name="customer" defaultValue=${v.customer} /><//>
        <${Field} label="Description"><textarea name="description" rows="3" defaultValue=${v.description}></textarea><//>
        <div class="field-row">
          <${Field} label="Due date"><input name="dueDate" type="date" defaultValue=${v.dueDate} /><//>
          <${Field} label="Priority"><${Select} name="priority" value=${v.priority} options=${['High', 'Medium', 'Low']} /><//>
        </div>
        <${Field} label="Assigned to" hint="Who is leading this job. Anyone on the team can still work it.">
          <${Select} name="assignedTo" value=${v.assignedTo || ''}
                     options=${[{ value: '', label: 'Unassigned' }, ...team.map(u => ({ value: u.id, label: u.fullName }))]} />
        <//>
        ${scan && html`<p class="hint">The drawing and ${scan.parts} scanned part${scan.parts === 1 ? '' : 's'} will be attached when you save.</p>`}
        <button type="submit" class="btn btn-primary btn-block">${job ? 'Save' : 'Create job'}</button>
      </form>
      ${job && html`<button type="button" class="btn btn-danger-outline btn-block" onClick=${remove}>Delete job</button>`}
    <//>`;
}
