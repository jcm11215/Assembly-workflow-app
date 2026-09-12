/** Job create/edit form. */


/* ================= FORMS ================= */
import { requestRender as render } from '../app/bus.js';
import * as blueprintsRepo from '../db/blueprintsRepo.js';
import { logActivity, persistJobs } from '../db/repository.js';
import { STAGES } from './procedure.js';
import { state } from '../state/store.js';
import { closeModal, openModal } from '../ui/components/modal.js';
import { showToast } from '../ui/components/toast.js';
import { distinctValues } from '../utils/collection.js';
import { todayISO } from '../utils/date.js';
import { datalistHtml, escapeHtml } from '../utils/dom.js';
import { uid } from '../utils/id.js';
import { blueprintImageCache } from '../blueprints/images.js';

export function jobFormHtml(job, isEdit){
  job = job || {jobNumber:'', customer:'', description:'', dueDate: todayISO(), priority:'Medium', assignedAssembler:'', assemblyStatus:'ready', percentComplete:0};
  const customers = distinctValues('customer', state.jobs);
  const assemblers = distinctValues('assignedAssembler', state.jobs, ['D. Reyes','M. Okafor','J. Whitfield']);
  return `
  <div class="modal-sheet">
    <div class="modal-title">${isEdit?'Edit Job':'Add Job'} <button class="modal-close" data-close-overlay>&times;</button></div>
    ${(!isEdit && job.billOfMaterials && job.billOfMaterials.length) ? `<div class="bp-file-chip">&#128208; ${job.billOfMaterials.length} components read from the blueprint -- review the fields below, then save.</div>` : ''}
    <form id="jobForm">
      <div class="field"><label>Job Number</label><input required name="jobNumber" value="${escapeHtml(job.jobNumber)}"></div>
      <div class="field"><label>Customer</label><input required name="customer" list="customerList" value="${escapeHtml(job.customer)}"></div>
      <div class="field"><label>Description</label><textarea name="description">${escapeHtml(job.description)}</textarea></div>
      <div class="field"><label>Due Date</label><input required type="date" name="dueDate" value="${job.dueDate}"></div>
      <div class="field"><label>Priority</label>
        <select name="priority">
          ${['High','Medium','Low'].map(p=>`<option value="${p}" ${job.priority===p?'selected':''}>${p}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Assembly Status</label>
        <select name="assemblyStatus">
          ${STAGES.map(s=>`<option value="${s.id}" ${job.assemblyStatus===s.id?'selected':''}>${s.label}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Assigned Assembler</label><input name="assignedAssembler" list="assemblerList" value="${escapeHtml(job.assignedAssembler)}" placeholder="Unassigned"></div>
      <div class="field">
        <label id="pctLabel">Percent Complete (${job.percentComplete||0}%)</label>
        <input type="range" min="0" max="100" step="5" name="percentComplete" value="${job.percentComplete||0}"
          oninput="document.getElementById('pctLabel').textContent='Percent Complete ('+this.value+'%)'">
        <div class="preset-row">
          ${[0,25,50,75,100].map(v=>`<button type="button" onclick="const r=this.closest('form').querySelector('[name=percentComplete]'); r.value=${v}; document.getElementById('pctLabel').textContent='Percent Complete (${v}%)';">${v}%</button>`).join('')}
        </div>
      </div>
      <div class="fab-row">
        <button type="submit" class="btn btn-primary btn-block">${isEdit?'Save Changes':'Add Job'}</button>
      </div>
      ${isEdit ? `<div class="fab-row"><button type="button" class="btn btn-danger btn-block" data-action="delete-job" data-id="${job.id}">Delete Job</button></div>` : ''}
    </form>
    ${datalistHtml('customerList', customers)}
    ${datalistHtml('assemblerList', assemblers)}
  </div>`;
}

export function openJobForm(jobId, prefill){
  const job = jobId ? state.jobs.find(j=>j.id===jobId) : null;
  const formData = job || Object.assign({jobNumber:'', customer:'', description:'', dueDate: todayISO(), priority:'Medium', assignedAssembler:'', assemblyStatus:'ready', percentComplete:0}, prefill||{});
  openModal(jobFormHtml(formData, !!job), ()=>jobFormHtml(formData, !!job));
  document.getElementById('jobForm').addEventListener('submit', async e=>{
    e.preventDefault();
    const fd = new FormData(e.target);
    const vals = Object.fromEntries(fd.entries());
    vals.percentComplete = parseInt(vals.percentComplete,10)||0;
    let pendingBlueprint = null;
    let newJob = null;
    if(job){
      if(state.jobs.some(j=>j.id!==job.id && j.jobNumber===vals.jobNumber)){
        showToast('Job number already exists'); return;
      }
      Object.assign(job, vals);
      logActivity('Job edited', `${vals.jobNumber} (${vals.customer})`);
    }else{
      if(state.jobs.some(j=>j.jobNumber===vals.jobNumber)){
        showToast('Job number already exists'); return;
      }
      newJob = {id:(prefill && prefill.id) || uid('job'), ...vals};
      const hadExtraction = !!(prefill && ((prefill.billOfMaterials && prefill.billOfMaterials.length) || prefill.hasBlueprintImage));
      if(prefill && prefill.billOfMaterials && prefill.billOfMaterials.length){
        newJob.billOfMaterials = prefill.billOfMaterials;
      }
      if(prefill && prefill.hasBlueprintImage){
        newJob.hasBlueprintImage = true;
      }
      if(hadExtraction){
        newJob.blueprintExtractedAt = prefill.blueprintExtractedAt || new Date().toISOString();
      }
      // The blueprint extraction (original file + components) cannot be
      // saved until this job has a real database id -- persistJobs()
      // below is what assigns one. Hold it here rather than writing it
      // against the client-side placeholder id, which would never match.
      pendingBlueprint = prefill && prefill._pendingBlueprint || null;
      state.jobs.push(newJob);
      logActivity('Job created', `${vals.jobNumber} (${vals.customer})`);
    }
    await persistJobs();
    if(pendingBlueprint){
      // The object pushed above, not whatever happens to be last in the
      // list. persistJobs() awaits a round trip, and during it the job's
      // id changes from the client placeholder to the real one -- so the
      // realtime echo of this very insert arrives with an id that does
      // not match yet and gets appended as a second entry. Reading the
      // last element then hung the blueprint, and the components read
      // back from it, on that echo instead of on the job the person is
      // about to open.
      const created = newJob;
      try {
        const saved = await blueprintsRepo.saveExtraction(created.id, pendingBlueprint);
        created.hasBlueprintImage = true;
        created.blueprintId = saved.id;   // needed for Edit and "already scanned" detection
        created.billOfMaterials = await blueprintsRepo.listComponents(saved.id);   // real ids, not the raw AI output
        delete blueprintImageCache[created.id];
        if(pendingBlueprint.originalFile && !saved.storage_path){
          showToast('Job saved, but the original file could not be attached -- the thumbnail works, but "Open PDF" won\'t. Try Re-Scan.', 7000);
        } else if(!created.billOfMaterials.length){
          // The drawing is attached but carries no parts. Saying nothing
          // here is how a job ends up looking like it was never scanned.
          showToast('Job saved with the drawing attached, but the scan found no parts on it. Open the job and use Re-Scan Blueprint.', 7000);
        }
      } catch (e) {
        console.error('deferred blueprint save failed', e);
        showToast('Job saved, but the blueprint scan could not be attached -- re-scan it from the job.', 6000);
      }
    }
    closeModal();
    showToast('Job saved');
    render();
  });
}
