/**
 * The complete set of actions the AI is permitted to request. This is
 * the ONLY place a natural-language request turns into a repository
 * call -- actionParser.js never touches a repository, and nothing in
 * this file ever issues a raw fetch or SQL. Every `run()` below calls
 * an existing Phase 3/8 repository function; none of them do their own
 * network I/O.
 *
 * Each tool: { description, params, permission, resolve, validate, run,
 * preview }. `resolve` turns loose natural-language references
 * (a job number string, an assignee name) into real objects using data
 * already loaded client-side. `validate` re-runs the SAME business-rule
 * functions the human UI uses -- never a reimplementation of them, so
 * there is exactly one source of truth for what's a legal move.
 */
import { state } from '../state/store.js';
import * as jobsRepo from '../db/jobsRepo.js';
import * as blockersRepo from '../db/blockersRepo.js';
import * as notesRepo from '../db/notesRepo.js';
import * as checklistRepo from '../db/checklistRepo.js';
import * as blueprintsRepo from '../db/blueprintsRepo.js';
import { validateStageTransition, TRANSITION } from '../jobs/transitions.js';
import { STAGES, stageLabel, PROCEDURE, checklistItemLabel } from '../jobs/procedure.js';
import { PERMISSION } from './permissionAdapter.js';
import { listProfiles } from '../auth/profileService.js';
import { currentActorName } from '../auth/authService.js';

/* ---------------- shared resolution helpers ---------------- */

function findJob(jobNumber){
  if(!jobNumber) return null;
  const needle = String(jobNumber).trim().toLowerCase();
  return state.jobs.find(j => (j.jobNumber||'').toLowerCase() === needle)
    || state.jobs.find(j => (j.jobNumber||'').toLowerCase().includes(needle));
}

async function findAssigneeId(name){
  if(!name) return null;
  const profiles = await listProfiles().catch(() => []);
  const needle = String(name).trim().toLowerCase();
  const exact = profiles.find(p => (p.full_name||'').toLowerCase() === needle);
  if(exact) return exact.id;
  const partial = profiles.find(p => (p.full_name||'').toLowerCase().includes(needle));
  return partial ? partial.id : null;
}

/** Matches free-text ("verify hardware", "check tolerances") against the
 *  procedure's actual item labels -- the AI is given this same list in
 *  its prompt context, but text can still drift, so match loosely. */
function findChecklistKey(job, itemText){
  if(!itemText) return null;
  const needle = String(itemText).trim().toLowerCase();
  for(let si=0; si<PROCEDURE.length; si++){
    const items = PROCEDURE[si].items;
    for(let ii=0; ii<items.length; ii++){
      const label = `${PROCEDURE[si].title} ${items[ii]}`.toLowerCase();
      if(label.includes(needle) || items[ii].toLowerCase().includes(needle)) return `${si}-${ii}`;
    }
  }
  return null;
}

function findBlocker(jobNumber, issueText){
  const job = findJob(jobNumber);
  const candidates = job ? state.blockers.filter(b => b.jobId === job.id || b.jobNumber === job.jobNumber) : state.blockers;
  if(!issueText) return candidates.find(b => b.status !== 'Resolved') || candidates[0] || null;
  const needle = String(issueText).trim().toLowerCase();
  return candidates.find(b => (b.issueDescription||'').toLowerCase().includes(needle)) || candidates[0] || null;
}

const nextStageOf = job => {
  const idx = STAGES.findIndex(s => s.id === job.assemblyStatus);
  return idx >= 0 && idx < STAGES.length-1 ? STAGES[idx+1].id : null;
};

const ok = (data) => ({ ok:true, ...data });
const fail = (reason) => ({ ok:false, reason });

/* ================================================================
   TOOL DEFINITIONS
   ================================================================ */

export const TOOLS = {

  create_job: {
    description: 'Create a new job.',
    params: { required:['jobNumber','customer'], optional:['description','dueDate','priority'] },
    permission: PERMISSION.LEAD_OR_ADMIN,
    mutates: true,
    async resolve(params){
      if(state.jobs.some(j => (j.jobNumber||'').toLowerCase() === String(params.jobNumber||'').toLowerCase())){
        return fail(`Job "${params.jobNumber}" already exists.`);
      }
      return ok({ params });
    },
    validate(){ return ok({}); },
    async run({ params }){
      const created = await jobsRepo.createJob({
        jobNumber: params.jobNumber, customer: params.customer,
        description: params.description || '', dueDate: params.dueDate || null,
        priority: params.priority || 'Medium', assemblyStatus: 'ready', percentComplete: 0
      });
      return { job: created };
    },
    preview({ params }){
      return `Create job ${params.jobNumber} for ${params.customer}${params.dueDate?`, due ${params.dueDate}`:''}.`;
    },
    entity: (r) => r && r.job ? { type:'job', id:r.job.id } : null
  },

  update_job: {
    description: 'Update fields on an existing job (customer, description, dueDate, priority, or percentComplete).',
    params: { required:['jobNumber'], optional:['customer','description','dueDate','priority','percentComplete'] },
    permission: PERMISSION.PROGRESS_ONLY_OR_LEAD,
    mutates: true,
    async resolve(params){
      const job = findJob(params.jobNumber);
      if(!job) return fail(`No job matching "${params.jobNumber}".`);
      const changedFields = ['customer','description','dueDate','priority','percentComplete']
        .filter(f => params[f] !== undefined);
      if(!changedFields.length) return fail('No fields to update were given.');
      return ok({ job, changedFields });
    },
    validate(){ return ok({}); },
    async run({ job, params }){
      const patch = {};
      ['customer','description'].forEach(f => { if(params[f] !== undefined) patch[f] = params[f]; });
      if(params.dueDate !== undefined) patch.due_date = params.dueDate;
      if(params.priority !== undefined) patch.priority = params.priority;
      if(params.percentComplete !== undefined){
        patch.percent_complete = Math.min(100, Math.max(0, Number(params.percentComplete)||0));
      }
      const updated = await jobsRepo.updateJob(job, patch);
      return { job: updated };
    },
    preview({ job, params, changedFields }){
      return `Update ${job.jobNumber}: ${changedFields.map(f=>`${f} → ${params[f]}`).join(', ')}.`;
    },
    entity: (r, {job}) => ({ type:'job', id: job.id })
  },

  assign_job: {
    description: 'Assign a job to a team member.',
    params: { required:['jobNumber','assignee'], optional:[] },
    permission: PERMISSION.LEAD_OR_ADMIN,
    mutates: true,
    async resolve(params){
      const job = findJob(params.jobNumber);
      if(!job) return fail(`No job matching "${params.jobNumber}".`);
      const assigneeId = await findAssigneeId(params.assignee);
      if(!assigneeId) return fail(`No team member matching "${params.assignee}".`);
      return ok({ job, assigneeId });
    },
    validate(){ return ok({}); },
    async run({ job, assigneeId, params }){
      const updated = await jobsRepo.updateJob(job, { assigned_to: assigneeId });
      return { job: updated };
    },
    preview({ job, params }){ return `Assign ${job.jobNumber} to ${params.assignee}.`; },
    entity: (r, {job}) => ({ type:'job', id: job.id })
  },

  move_stage: {
    description: 'Move a job to a specific stage.',
    params: { required:['jobNumber','targetStage'], optional:[] },
    permission: PERMISSION.ASSIGNED_OR_LEAD,
    mutates: true,
    async resolve(params){
      const job = findJob(params.jobNumber);
      if(!job) return fail(`No job matching "${params.jobNumber}".`);
      const stageId = STAGES.find(s => s.id === params.targetStage || s.label.toLowerCase() === String(params.targetStage||'').toLowerCase());
      if(!stageId) return fail(`"${params.targetStage}" is not a valid stage.`);
      return ok({ job, targetStage: stageId.id });
    },
    // Reuses the EXACT function the board/detail-view UI calls -- one
    // source of truth for "is this move legal", per the requirement
    // that the AI cannot bypass existing business rules.
    validate({ job, targetStage }){
      const v = validateStageTransition(job, targetStage);
      return v.allowed ? ok({}) : fail(v.reason);
    },
    async run({ job, targetStage }){
      const updated = await jobsRepo.moveStage(job, targetStage);
      return { job: updated };
    },
    preview({ job, targetStage }){ return `Move ${job.jobNumber} from ${stageLabel(job.assemblyStatus)} to ${stageLabel(targetStage)}.`; },
    entity: (r, {job}) => ({ type:'job', id: job.id })
  },

  advance_stage: {
    description: 'Advance a job to its next stage.',
    params: { required:['jobNumber'], optional:[] },
    permission: PERMISSION.ASSIGNED_OR_LEAD,
    mutates: true,
    async resolve(params){
      const job = findJob(params.jobNumber);
      if(!job) return fail(`No job matching "${params.jobNumber}".`);
      const targetStage = nextStageOf(job);
      if(!targetStage) return fail(`${job.jobNumber} is already at the final stage.`);
      return ok({ job, targetStage });
    },
    validate({ job, targetStage }){
      const v = validateStageTransition(job, targetStage);
      return v.allowed ? ok({}) : fail(v.reason);
    },
    async run({ job, targetStage }){
      const updated = await jobsRepo.moveStage(job, targetStage);
      return { job: updated };
    },
    preview({ job, targetStage }){ return `Advance ${job.jobNumber} to ${stageLabel(targetStage)}.`; },
    entity: (r, {job}) => ({ type:'job', id: job.id })
  },

  toggle_checklist: {
    description: 'Check or uncheck a checklist item on a job.',
    params: { required:['jobNumber','item'], optional:['done'] },
    permission: PERMISSION.ASSIGNED_OR_LEAD,
    mutates: true,
    async resolve(params){
      const job = findJob(params.jobNumber);
      if(!job) return fail(`No job matching "${params.jobNumber}".`);
      const key = findChecklistKey(job, params.item);
      if(!key) return fail(`No checklist item matching "${params.item}".`);
      return ok({ job, key, done: params.done !== false });
    },
    validate(){ return ok({}); },
    async run({ job, key, done }){
      await checklistRepo.setItem(job.id, key, done);
      return { jobId: job.id, key, done };
    },
    preview({ job, key, done }){ return `${done?'Check off':'Uncheck'} "${checklistItemLabel(key)}" on ${job.jobNumber}.`; },
    entity: (r, {job}) => ({ type:'job', id: job.id })
  },

  create_note: {
    description: 'Add a note (Progress, Issue, or NextSteps) to a job, or a shop-wide note.',
    params: { required:['notes'], optional:['jobNumber','noteType'] },
    permission: PERMISSION.ANY_SIGNED_IN,
    mutates: true,
    async resolve(params){
      const job = params.jobNumber ? findJob(params.jobNumber) : null;
      if(params.jobNumber && !job) return fail(`No job matching "${params.jobNumber}".`);
      return ok({ job });
    },
    validate(){ return ok({}); },
    async run({ job, params }){
      const created = await notesRepo.createNote({
        jobId: job ? job.id : null, jobNumber: job ? job.jobNumber : '',
        noteType: params.noteType || 'Progress', notes: params.notes,
        date: new Date().toISOString().slice(0,10)
      });
      return { note: created };
    },
    preview({ job, params }){ return `Add ${params.noteType||'Progress'} note${job?` to ${job.jobNumber}`:' (shop-wide)'}: "${params.notes}".`; },
    entity: (r) => r && r.note ? { type:'note', id: r.note.id } : null
  },

  create_blocker: {
    description: 'Report a blocker on a job.',
    params: { required:['jobNumber','issueDescription'], optional:['severity','department'] },
    permission: PERMISSION.ANY_SIGNED_IN,   // matches RLS: anyone may report a blocker
    mutates: true,
    async resolve(params){
      const job = findJob(params.jobNumber);
      if(!job) return fail(`No job matching "${params.jobNumber}".`);
      return ok({ job });
    },
    validate(){ return ok({}); },
    async run({ job, params }){
      const created = await blockersRepo.createBlocker({
        jobId: job.id, jobNumber: job.jobNumber,
        issueDescription: params.issueDescription,
        severity: params.severity || 'Medium',
        responsibleDepartment: params.department || '',
        dateReported: new Date().toISOString().slice(0,10)
      });
      return { blocker: created };
    },
    preview({ job, params }){ return `Report a ${params.severity||'Medium'} blocker on ${job.jobNumber}: "${params.issueDescription}".`; },
    entity: (r) => r && r.blocker ? { type:'blocker', id: r.blocker.id } : null
  },

  resolve_blocker: {
    description: 'Mark a blocker resolved.',
    params: { required:['jobNumber'], optional:['issueDescription'] },
    permission: PERMISSION.LEAD_OR_ADMIN,
    mutates: true,
    async resolve(params){
      const blocker = findBlocker(params.jobNumber, params.issueDescription);
      if(!blocker) return fail(`No open blocker found for "${params.jobNumber}".`);
      return ok({ blocker });
    },
    validate(){ return ok({}); },
    async run({ blocker }){
      const updated = await blockersRepo.setStatus(blocker.id, 'Resolved');
      return { blocker: updated };
    },
    preview({ blocker }){ return `Resolve blocker on ${blocker.jobNumber}: "${blocker.issueDescription}".`; },
    entity: (r, {blocker}) => ({ type:'blocker', id: blocker.id })
  },

  approve_blueprint: {
    description: "Approve a job's pending blueprint extraction.",
    params: { required:['jobNumber'], optional:['note'] },
    permission: PERMISSION.LEAD_OR_ADMIN,
    mutates: true,
    async resolve(params){
      const job = findJob(params.jobNumber);
      if(!job) return fail(`No job matching "${params.jobNumber}".`);
      if(!job.blueprintId) return fail(`${job.jobNumber} has no blueprint extraction to approve.`);
      return ok({ job });
    },
    validate(){ return ok({}); },
    async run({ job, params }){
      const updated = await blueprintsRepo.approveVersion(job.blueprintId, params.note);
      return { blueprint: updated };
    },
    preview({ job }){ return `Approve the blueprint extraction for ${job.jobNumber} (v${job.blueprintVersion||'?'}).`; },
    entity: (r, {job}) => ({ type:'blueprint', id: job.blueprintId })
  },

  reject_blueprint: {
    description: "Reject a job's pending blueprint extraction.",
    params: { required:['jobNumber'], optional:['note'] },
    permission: PERMISSION.LEAD_OR_ADMIN,
    mutates: true,
    async resolve(params){
      const job = findJob(params.jobNumber);
      if(!job) return fail(`No job matching "${params.jobNumber}".`);
      if(!job.blueprintId) return fail(`${job.jobNumber} has no blueprint extraction to reject.`);
      return ok({ job });
    },
    validate(){ return ok({}); },
    async run({ job, params }){
      const updated = await blueprintsRepo.rejectVersion(job.blueprintId, params.note);
      return { blueprint: updated };
    },
    preview({ job, params }){ return `Reject the blueprint extraction for ${job.jobNumber}${params.note?`: "${params.note}"`:''}.`; },
    entity: (r, {job}) => ({ type:'blueprint', id: job.blueprintId })
  },

  generate_pull_list: {
    description: 'Generate a consolidated hardware pull list across jobs (optionally filtered by stage).',
    params: { required:[], optional:['stage'] },
    permission: PERMISSION.ANY_SIGNED_IN,
    mutates: false,
    async resolve(params){ return ok({ stage: params.stage || null }); },
    validate(){ return ok({}); },
    async run({ stage }){
      const jobs = state.jobs.filter(j => !stage || j.assemblyStatus === stage);
      const totals = {};
      jobs.forEach(j => (j.billOfMaterials||[]).forEach(c => {
        const key = `${c.item}::${c.specification}`;
        if(!totals[key]) totals[key] = { item:c.item, specification:c.specification, quantity:0, jobs:new Set() };
        totals[key].quantity += Number(c.quantity)||0;
        totals[key].jobs.add(j.jobNumber);
      }));
      const lines = Object.values(totals).map(t => ({ ...t, jobs:[...t.jobs] }));
      return { report:{ type:'pull_list', stage, jobCount:jobs.length, lines } };
    },
    preview({ stage }){ return `Generate a pull list${stage?` for jobs in ${stageLabel(stage)}`:' across all active jobs'}.`; },
    entity: () => null
  },

  generate_shift_report: {
    description: "Summarize today's activity: stage moves, blockers, notes, checklist progress.",
    params: { required:[], optional:['date'] },
    permission: PERMISSION.ANY_SIGNED_IN,
    mutates: false,
    async resolve(params){ return ok({ date: params.date || new Date().toISOString().slice(0,10) }); },
    validate(){ return ok({}); },
    async run({ date }){
      const isToday = a => (a.at||'').slice(0,10) === date;
      const events = (state.activity||[]).filter(isToday);
      const moved = events.filter(e => /stage/i.test(e.action));
      const blockersOpened = state.blockers.filter(b => b.dateReported === date);
      const notesToday = state.notes.filter(n => n.date === date);
      return { report:{
        type:'shift_report', date,
        stageMoves: moved.length, blockersOpened: blockersOpened.length,
        notesAdded: notesToday.length, totalActivity: events.length,
        highlights: events.slice(0, 10).map(e => `${e.who}: ${e.action}${e.detail?` — ${e.detail}`:''}`)
      }};
    },
    preview({ date }){ return `Generate the shift report for ${date}.`; },
    entity: () => null
  }
};

export const ACTION_NAMES = Object.keys(TOOLS);
export function getTool(name){ return TOOLS[name] || null; }

/** Every requesting party's identity, for logs/previews that want to say who asked. */
export function actingAs(){ return currentActorName(); }
