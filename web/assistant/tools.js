/**
 * Everything the assistant is allowed to do, and nothing else.
 *
 * Each tool:
 *   description, params { required, optional }  -- what the AI is told
 *   permission    -- a name from shared/roles.js
 *   resolve(p, s) -- loose words ("the Acme job", "Dana") to real records,
 *                    using the data already loaded; { ok, ...found } or { ok:false, reason }
 *   check(r, me)  -- the same business rule the screens use (optional)
 *   run(r)        -- calls the same action the screens call; no fetches here
 *   preview(r)    -- one line saying exactly what will happen
 *
 * The server checks permissions and rules again on every request, so a
 * wrong answer here can only produce a clear refusal, never a bad write.
 */
import { STAGES, stageLabel, nextStage, checkStageMove, PROCEDURE, checklistKey, checklistItemLabel } from '../../shared/procedure.js';
import { todayISO } from '../../shared/dates.js';
import * as actions from '../lib/actions.js';

const ok = data => ({ ok: true, ...data });
const fail = reason => ({ ok: false, reason });
const lc = v => String(v || '').trim().toLowerCase();

function findJob(state, jobNumber){
  const needle = lc(jobNumber);
  if(!needle) return null;
  return state.jobs.find(j => lc(j.jobNumber) === needle) || state.jobs.find(j => lc(j.jobNumber).includes(needle)) || null;
}

function findPerson(state, name){
  const needle = lc(name);
  const people = state.team.filter(u => u.active);
  return people.find(u => lc(u.fullName) === needle) || people.find(u => lc(u.fullName).includes(needle)) || null;
}

/** Free text ("verify hardware") against the real checklist wording. */
function findChecklistKey(text){
  const needle = lc(text);
  for(let s = 0; s < PROCEDURE.length; s++){
    for(let i = 0; i < PROCEDURE[s].items.length; i++){
      const item = lc(PROCEDURE[s].items[i]);
      if(item.includes(needle) || `${lc(PROCEDURE[s].title)} ${item}`.includes(needle)) return checklistKey(s, i);
    }
  }
  return null;
}

function findStage(text){
  const needle = lc(text);
  return (STAGES.find(s => s.id === needle || lc(s.label) === needle) || STAGES.find(s => lc(s.label).includes(needle)) || {}).id || null;
}

const withJob = (state, p, then) => {
  const job = findJob(state, p.jobNumber);
  return job ? then(job) : fail(`No job matching "${p.jobNumber}".`);
};

const stageCheck = (r, me) => {
  const v = checkStageMove(r.job, r.to, me.role);
  return v.ok ? ok() : fail(v.reason);
};

export const TOOLS = {
  create_job: {
    description: 'Create a new job.',
    params: { required: ['jobNumber'], optional: ['customer', 'description', 'dueDate', 'priority'] },
    permission: 'job.manage',
    resolve: (p, s) => findJob(s, p.jobNumber) && lc(findJob(s, p.jobNumber).jobNumber) === lc(p.jobNumber)
      ? fail(`Job ${p.jobNumber} already exists.`) : ok({ p }),
    run: ({ p }) => actions.createJob({
      jobNumber: p.jobNumber, customer: p.customer || '', description: p.description || '',
      dueDate: p.dueDate || null, priority: ['High', 'Medium', 'Low'].includes(p.priority) ? p.priority : 'Medium'
    }),
    preview: ({ p }) => `Create job ${p.jobNumber}${p.customer ? ` for ${p.customer}` : ''}${p.dueDate ? `, due ${p.dueDate}` : ''}.`
  },

  update_job: {
    description: 'Change a job\'s customer, description, due date, priority or percent complete.',
    params: { required: ['jobNumber'], optional: ['customer', 'description', 'dueDate', 'priority', 'percentComplete'] },
    permission: p => (Object.keys(p).every(k => k === 'jobNumber' || k === 'percentComplete') ? 'job.work' : 'job.manage'),
    resolve: (p, s) => withJob(s, p, job => {
      const fields = {};
      for(const k of ['customer', 'description', 'dueDate', 'priority']) if(p[k] !== undefined) fields[k] = p[k];
      if(p.percentComplete !== undefined) fields.percentComplete = Math.min(100, Math.max(0, Math.round(Number(p.percentComplete) || 0)));
      return Object.keys(fields).length ? ok({ job, fields }) : fail('Nothing to change was given.');
    }),
    run: ({ job, fields }) => actions.updateJob(job, fields),
    preview: ({ job, fields }) => `Update ${job.jobNumber}: ${Object.entries(fields).map(([k, v]) => `${k} → ${v}`).join(', ')}.`
  },

  assign_job: {
    description: 'Set who leads a job.',
    params: { required: ['jobNumber', 'assignee'], optional: [] },
    permission: 'job.manage',
    resolve: (p, s) => withJob(s, p, job => {
      const person = findPerson(s, p.assignee);
      return person ? ok({ job, person }) : fail(`No one on the team matches "${p.assignee}".`);
    }),
    run: ({ job, person }) => actions.updateJob(job, { assignedTo: person.id }),
    preview: ({ job, person }) => `Assign ${job.jobNumber} to ${person.fullName}.`
  },

  move_stage: {
    description: 'Move a job to a named stage.',
    params: { required: ['jobNumber', 'targetStage'], optional: [] },
    permission: 'job.work',
    resolve: (p, s) => withJob(s, p, job => {
      const to = findStage(p.targetStage);
      return to ? ok({ job, to }) : fail(`"${p.targetStage}" isn't a stage.`);
    }),
    check: stageCheck,
    run: ({ job, to }) => actions.moveStage(job, to),
    preview: ({ job, to }) => `Move ${job.jobNumber} from ${stageLabel(job.stage)} to ${stageLabel(to)}.`
  },

  advance_stage: {
    description: 'Move a job on to its next stage.',
    params: { required: ['jobNumber'], optional: [] },
    permission: 'job.work',
    resolve: (p, s) => withJob(s, p, job => {
      const to = nextStage(job.stage);
      return to ? ok({ job, to }) : fail(`${job.jobNumber} is already at the last stage.`);
    }),
    check: stageCheck,
    run: ({ job, to }) => actions.moveStage(job, to),
    preview: ({ job, to }) => `Advance ${job.jobNumber} to ${stageLabel(to)}.`
  },

  toggle_checklist: {
    description: 'Tick or untick a checklist item on a job. Put the item\'s own wording in "item".',
    params: { required: ['jobNumber', 'item'], optional: ['done'] },
    permission: 'job.work',
    resolve: (p, s) => withJob(s, p, job => {
      const key = findChecklistKey(p.item);
      return key ? ok({ job, key, done: p.done !== false }) : fail(`No checklist item matches "${p.item}".`);
    }),
    run: ({ job, key, done }) => actions.setChecklistItem(job, key, done),
    preview: ({ job, key, done }) => `${done ? 'Tick' : 'Untick'} "${checklistItemLabel(key)}" on ${job.jobNumber}.`
  },

  create_note: {
    description: 'Add a note (Progress, Issue or NextSteps) to a job, or a shop-wide note.',
    params: { required: ['notes'], optional: ['jobNumber', 'noteType'] },
    permission: 'note.write',
    resolve: (p, s) => {
      const job = p.jobNumber ? findJob(s, p.jobNumber) : null;
      if(p.jobNumber && !job) return fail(`No job matching "${p.jobNumber}".`);
      return ok({ job, type: ['Progress', 'Issue', 'NextSteps'].includes(p.noteType) ? p.noteType : 'Progress', body: String(p.notes) });
    },
    run: ({ job, type, body }) => actions.addNotes({ jobId: job ? job.id : null, date: todayISO(), entries: [{ type, body }] }),
    preview: ({ job, type, body }) => `Add a ${type} note${job ? ` to ${job.jobNumber}` : ' (shop-wide)'}: "${body}".`
  },

  create_blocker: {
    description: 'Report a blocker on a job.',
    params: { required: ['jobNumber', 'issue'], optional: ['severity', 'department'] },
    permission: 'blocker.report',
    resolve: (p, s) => withJob(s, p, job => ok({
      job, issue: String(p.issue), department: p.department || '',
      severity: ['Critical', 'High', 'Medium', 'Low'].includes(p.severity) ? p.severity : 'Medium'
    })),
    run: r => actions.reportBlocker({ jobId: r.job.id, issue: r.issue, department: r.department, severity: r.severity }),
    preview: r => `Report a ${r.severity} blocker on ${r.job.jobNumber}: "${r.issue}".`
  },

  resolve_blocker: {
    description: 'Mark a job\'s blocker resolved.',
    params: { required: ['jobNumber'], optional: ['issue'] },
    permission: 'blocker.manage',
    resolve: (p, s) => withJob(s, p, job => {
      const open = s.blockers.filter(b => b.jobId === job.id && b.status !== 'Resolved');
      const blocker = p.issue ? open.find(b => lc(b.issue).includes(lc(p.issue))) : open[0];
      return blocker ? ok({ blocker }) : fail(`No open blocker on ${job.jobNumber}${p.issue ? ` matching "${p.issue}"` : ''}.`);
    }),
    run: ({ blocker }) => actions.setBlockerStatus(blocker, 'Resolved'),
    preview: ({ blocker }) => `Resolve the blocker on ${blocker.jobNumber}: "${blocker.issue}".`
  }
};

export const TOOL_NAMES = Object.keys(TOOLS);

/** The permission a tool needs for these particular parameters. */
export const permissionFor = (tool, params) =>
  typeof tool.permission === 'function' ? tool.permission(params) : tool.permission;
