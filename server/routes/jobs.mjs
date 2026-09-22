/**
 * Jobs: create, edit, delete, stage moves and checklist ticks.
 *
 * Edits carry the version the editor was looking at. If someone else has
 * changed the job since, the edit is refused with the current job rather
 * than silently overwriting their change.
 */
import { badRequest, conflict, forbidden, notFound } from '../http.mjs';
import { uuid, now } from '../db.mjs';
import { getJob } from '../records.mjs';
import { broadcast } from '../live.mjs';
import { can } from '../../shared/roles.js';
import { checkStageMove, stageLabel, STAGE_DEFAULT_PERCENT, parseChecklistKey, checklistItemLabel } from '../../shared/procedure.js';
import * as v from '../validate.mjs';
import { deleteJobFiles } from '../files.mjs';

const PRIORITIES = ['High', 'Medium', 'Low'];

/** Fields only an admin may set, and how each is checked. */
const MANAGED_FIELDS = {
  jobNumber:   (db, x) => v.text(x, 'Job number', { required: true, max: 40 }),
  customer:    (db, x) => v.text(x, 'Customer', { max: 120 }),
  description: (db, x) => v.text(x, 'Description', { max: 2000 }),
  dueDate:     (db, x) => v.optionalDate(x, 'Due date'),
  priority:    (db, x) => v.oneOf(x, PRIORITIES, 'Priority'),
  assignedTo:  (db, x) => v.optionalUser(db, x)
};
const COLUMN = {
  jobNumber: 'job_number', customer: 'customer', description: 'description', dueDate: 'due_date',
  priority: 'priority', assignedTo: 'assigned_to', percentComplete: 'percent_complete'
};

export function pushJob(db, id){
  const job = getJob(db, id);
  if(job) broadcast('job', job);
  return job;
}

function loadJob(db, id){
  const job = getJob(db, id);
  if(!job) throw notFound('That job');
  return job;
}

function duplicateNumber(db, jobNumber, exceptId = null){
  const row = db.get('select id from jobs where job_number = ?', jobNumber);
  return row && row.id !== exceptId;
}

export default function register(r){

  r.post('/api/jobs', async ctx => {
    const body = await ctx.json();
    const f = {};
    for(const [k, check] of Object.entries(MANAGED_FIELDS)) f[k] = check(ctx.db, body[k] ?? (k === 'priority' ? 'Medium' : null));
    if(duplicateNumber(ctx.db, f.jobNumber)) throw conflict(`Job number "${f.jobNumber}" already exists.`, 'duplicate');
    const id = uuid();
    const t = now();
    ctx.db.run(`insert into jobs (id, job_number, customer, description, due_date, priority, stage, percent_complete,
                                  assigned_to, created_by, version, created_at, updated_at)
                values (?, ?, ?, ?, ?, ?, 'ready', 0, ?, ?, 1, ?, ?)`,
      id, f.jobNumber, f.customer, f.description, f.dueDate, f.priority, f.assignedTo, ctx.user.id, t, t);
    ctx.log('Job created', { text: `${f.jobNumber}${f.customer ? ` (${f.customer})` : ''}`, jobNumber: f.jobNumber }, { type: 'job', id });
    ctx.status = 201;
    return { job: pushJob(ctx.db, id) };
  }, { perm: 'job.manage' });

  r.patch('/api/jobs/:id', async ctx => {
    const body = await ctx.json();
    const job = loadJob(ctx.db, ctx.params.id);
    if(body.version !== job.version){
      throw conflict(`${job.jobNumber} was changed by someone else. Here is the latest -- redo your change if it still applies.`,
        'stale', { job });
    }

    const sets = {};
    for(const [k, check] of Object.entries(MANAGED_FIELDS)){
      if(!(k in body)) continue;
      if(!can(ctx.user.role, 'job.manage')) throw forbidden('Only an admin can change job details.');
      sets[k] = check(ctx.db, body[k]);
    }
    if('percentComplete' in body){
      ctx.require('job.work');
      sets.percentComplete = v.integer(body.percentComplete, 'Percent complete', { min: 0, max: 100 });
    }
    const keys = Object.keys(sets);
    if(!keys.length) throw badRequest('Nothing to change.');
    if('jobNumber' in sets && duplicateNumber(ctx.db, sets.jobNumber, job.id)){
      throw conflict(`Job number "${sets.jobNumber}" already exists.`, 'duplicate');
    }

    ctx.db.run(`update jobs set ${keys.map(k => `${COLUMN[k]} = ?`).join(', ')}, version = version + 1, updated_at = ?
                where id = ? and version = ?`,
      ...keys.map(k => sets[k]), now(), job.id, job.version);

    const changed = keys.filter(k => String(sets[k] ?? '') !== String(job[k] ?? ''));
    if(changed.length){
      ctx.log(keys.length === 1 && keys[0] === 'percentComplete' ? 'Progress updated' : 'Job edited', {
        text: `${sets.jobNumber || job.jobNumber}: ${changed.map(k => k === 'percentComplete' ? `${sets[k]}%` : k).join(', ')}`,
        jobNumber: job.jobNumber, fields: changed
      }, { type: 'job', id: job.id });
    }
    return { job: pushJob(ctx.db, job.id) };
  });

  r.delete('/api/jobs/:id', async ctx => {
    const job = loadJob(ctx.db, ctx.params.id);
    const files = ctx.db.all('select file_path from blueprints where job_id = ? and file_path is not null', job.id);
    ctx.db.run('delete from jobs where id = ?', job.id);
    await deleteJobFiles(ctx.filesDir, files.map(f => f.file_path));
    ctx.log('Job deleted', { text: `${job.jobNumber}${job.customer ? ` (${job.customer})` : ''}`, jobNumber: job.jobNumber },
      { type: 'job', id: job.id });
    // Its blockers, notes, errors and tasks went with it.
    broadcast('job-removed', { id: job.id });
  }, { perm: 'job.manage' });

  /**
   * Stage move. `from` is the stage the person saw; if the job has moved
   * since, they are shown where it is now instead of a move that no
   * longer means what they intended.
   */
  r.post('/api/jobs/:id/stage', async ctx => {
    const body = await ctx.json();
    const job = loadJob(ctx.db, ctx.params.id);
    if(body.from && body.from !== job.stage){
      throw conflict(`${job.jobNumber} is already in ${stageLabel(job.stage)} -- someone moved it.`, 'stale', { job });
    }
    const verdict = checkStageMove(job, body.to, ctx.user.role);
    if(!verdict.ok) throw badRequest(verdict.reason, verdict.code);

    const pct = STAGE_DEFAULT_PERCENT[body.to];
    ctx.db.run(`update jobs set stage = ?, percent_complete = ?, last_moved_by = ?, version = version + 1, updated_at = ?
                where id = ?`, body.to, pct, ctx.user.id, now(), job.id);
    ctx.log('Stage moved', {
      text: `${job.jobNumber}: ${stageLabel(job.stage)} → ${stageLabel(body.to)}`,
      jobNumber: job.jobNumber, from: job.stage, to: body.to
    }, { type: 'job', id: job.id });
    return { job: pushJob(ctx.db, job.id) };
  }, { perm: 'job.work' });

  r.put('/api/jobs/:id/checklist/:key', async ctx => {
    const body = await ctx.json();
    const job = loadJob(ctx.db, ctx.params.id);
    const key = parseChecklistKey(ctx.params.key);
    if(!key) throw badRequest('Unknown checklist item.');
    const done = v.bool(body.done);
    if(done){
      ctx.db.run(`insert into checklist (job_id, step, item, done_by, done_at) values (?, ?, ?, ?, ?)
                  on conflict(job_id, step, item) do nothing`, job.id, key.step, key.item, ctx.user.id, now());
    } else {
      ctx.db.run('delete from checklist where job_id = ? and step = ? and item = ?', job.id, key.step, key.item);
    }
    ctx.log(done ? 'Checklist item done' : 'Checklist item un-done', {
      text: `${job.jobNumber}: ${checklistItemLabel(ctx.params.key)}`, jobNumber: job.jobNumber, item: ctx.params.key
    }, { type: 'job', id: job.id });
    return { job: pushJob(ctx.db, job.id) };
  }, { perm: 'job.work' });
}
