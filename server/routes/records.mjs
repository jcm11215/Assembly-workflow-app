/**
 * Blockers, notes and logged errors -- the records people attach to jobs.
 */
import { badRequest, notFound } from '../http.mjs';
import { uuid, now } from '../db.mjs';
import { getBlocker, getNote, getError } from '../records.mjs';
import { broadcast } from '../live.mjs';
import { isCategory, isDepartment } from '../../shared/errors.js';
import { STAGE_IDS } from '../../shared/procedure.js';
import { todayISO } from '../../shared/dates.js';
import * as v from '../validate.mjs';

const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];
const BLOCKER_STATUSES = ['Open', 'In Progress', 'Resolved'];
const NOTE_TYPES = ['Progress', 'Issue', 'NextSteps'];

export default function register(r){

  /* ---------------- blockers ---------------- */

  r.post('/api/blockers', async ctx => {
    const body = await ctx.json();
    const job = v.job(ctx.db, body.jobId);
    const issue = v.text(body.issue, 'The issue', { required: true, max: 2000 });
    const department = v.text(body.department, 'Department', { max: 80 });
    const severity = v.oneOf(body.severity || 'Medium', SEVERITIES, 'Severity');
    const reportedOn = v.optionalDate(body.reportedOn, 'Date reported') || todayISO();
    const id = uuid();
    const t = now();
    ctx.db.run(`insert into blockers (id, job_id, issue, department, severity, status, reported_by, reported_on, created_at)
                values (?, ?, ?, ?, ?, 'Open', ?, ?, ?)`, id, job.id, issue, department, severity, ctx.user.id, reportedOn, t);
    ctx.log('Blocker reported', { text: `${job.job_number}: ${severity} -- ${issue}`, jobNumber: job.job_number },
      { type: 'blocker', id });
    const blocker = getBlocker(ctx.db, id);
    broadcast('blocker', blocker);
    ctx.status = 201;
    return { blocker };
  }, { perm: 'blocker.report' });

  r.patch('/api/blockers/:id', async ctx => {
    const blocker = getBlocker(ctx.db, ctx.params.id);
    if(!blocker) throw notFound('That blocker');
    const body = await ctx.json();
    const status = v.oneOf(body.status, BLOCKER_STATUSES, 'Status');
    if(status === blocker.status) return { blocker };
    const resolved = status === 'Resolved';
    ctx.db.run('update blockers set status = ?, resolved_by = ?, resolved_at = ? where id = ?',
      status, resolved ? ctx.user.id : null, resolved ? now() : null, blocker.id);
    ctx.log(resolved ? 'Blocker resolved' : 'Blocker status changed',
      { text: `${blocker.jobNumber}: ${status} -- ${blocker.issue}`, jobNumber: blocker.jobNumber }, { type: 'blocker', id: blocker.id });
    const updated = getBlocker(ctx.db, blocker.id);
    broadcast('blocker', updated);
    return { blocker: updated };
  }, { perm: 'blocker.manage' });

  r.delete('/api/blockers/:id', ctx => {
    const blocker = getBlocker(ctx.db, ctx.params.id);
    if(!blocker) throw notFound('That blocker');
    const linkedErrors = ctx.db.all('select id from job_errors where blocker_id = ?', blocker.id);
    ctx.db.run('delete from blockers where id = ?', blocker.id);
    ctx.log('Blocker deleted', { text: `${blocker.jobNumber}: ${blocker.issue}`, jobNumber: blocker.jobNumber },
      { type: 'blocker', id: blocker.id });
    broadcast('blocker-removed', { id: blocker.id });
    // An error the blocker was linked to stays -- the error still
    // happened -- and is pushed again now that the link is gone.
    for(const { id } of linkedErrors) broadcast('job-error', getError(ctx.db, id));
  }, { perm: 'blocker.manage' });

  /* ---------------- notes ---------------- */

  /** One form, up to three notes: progress, issues, next steps. */
  r.post('/api/notes', async ctx => {
    const body = await ctx.json();
    const job = body.jobId ? v.job(ctx.db, body.jobId) : null;
    const date = v.optionalDate(body.date, 'Date') || todayISO();
    const entries = (Array.isArray(body.entries) ? body.entries : [])
      .map(e => ({ type: v.oneOf(e.type, NOTE_TYPES, 'Note type'), body: v.text(e.body, 'The note', { max: 5000 }) }))
      .filter(e => e.body);
    if(!entries.length) throw badRequest('Write at least one note.');

    const t = now();
    const ids = ctx.db.tx(() => entries.map(e => {
      const id = uuid();
      ctx.db.run('insert into notes (id, job_id, type, body, author, note_date, created_at) values (?, ?, ?, ?, ?, ?, ?)',
        id, job ? job.id : null, e.type, e.body, ctx.user.id, date, t);
      return id;
    }));
    const notes = ids.map(id => getNote(ctx.db, id));
    notes.forEach(n => broadcast('note', n));
    ctx.log('Note added', {
      text: `${job ? job.job_number : 'Shop-wide'}: ${entries.map(e => e.type).join(', ')}`,
      jobNumber: job ? job.job_number : null
    }, job ? { type: 'job', id: job.id } : null);
    ctx.status = 201;
    return { notes };
  }, { perm: 'note.write' });

  r.delete('/api/notes/:id', ctx => {
    const note = getNote(ctx.db, ctx.params.id);
    if(!note) throw notFound('That note');
    ctx.db.run('delete from notes where id = ?', note.id);
    ctx.log('Note deleted', { text: `${note.jobNumber || 'Shop-wide'}: ${note.body.slice(0, 80)}` }, { type: 'note', id: note.id });
    broadcast('note-removed', { id: note.id });
  }, { perm: 'note.delete' });

  /* ---------------- logged errors ---------------- */

  r.post('/api/errors', async ctx => {
    const body = await ctx.json();
    const job = v.job(ctx.db, body.jobId);
    if(!isDepartment(body.department)) throw badRequest('Pick the department that made the error.');
    if(!isCategory(body.department, body.category)) throw badRequest('Pick what kind of error it was.');
    const description = v.text(body.description, 'What happened', { required: true, max: 4000 });
    const foundAtStage = STAGE_IDS.includes(body.foundAtStage) ? body.foundAtStage : 'unknown';
    const reworkHours = v.optionalNumber(body.reworkHours, 'Rework hours', { min: 0, max: 10000 });
    let blockerId = null;
    if(body.blockerId){
      const b = ctx.db.get('select id from blockers where id = ? and job_id = ?', String(body.blockerId), job.id);
      if(!b) throw badRequest('That blocker is not on this job.');
      blockerId = b.id;
    }
    const id = uuid();
    ctx.db.run(`insert into job_errors (id, job_id, department, category, description, found_at_stage, rework_hours,
                  caused_delay, scrapped, status, blocker_id, reported_by, reported_at)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Open', ?, ?, ?)`,
      id, job.id, body.department, body.category, description, foundAtStage, reworkHours,
      v.bool(body.causedDelay) ? 1 : 0, v.bool(body.scrapped) ? 1 : 0, blockerId, ctx.user.id, now());
    const error = getError(ctx.db, id);
    ctx.log('Error logged', { text: `${job.job_number}: ${description}`, jobNumber: job.job_number, department: body.department },
      { type: 'error', id });
    broadcast('job-error', error);
    ctx.status = 201;
    return { error };
  }, { perm: 'error.log' });

  r.patch('/api/errors/:id', async ctx => {
    const error = getError(ctx.db, ctx.params.id);
    if(!error) throw notFound('That error');
    const body = await ctx.json();
    const status = v.oneOf(body.status, ['Open', 'Corrected'], 'Status');
    const correction = 'correction' in body ? v.text(body.correction, 'The correction', { max: 4000 }) : error.correction;
    ctx.db.run('update job_errors set status = ?, correction = ?, corrected_at = ? where id = ?',
      status, correction || null, status === 'Corrected' ? (error.correctedAt || now()) : null, error.id);
    ctx.log(status === 'Corrected' ? 'Error marked corrected' : 'Error reopened',
      { text: `${error.jobNumber}: ${error.description}`, jobNumber: error.jobNumber }, { type: 'error', id: error.id });
    const updated = getError(ctx.db, error.id);
    broadcast('job-error', updated);
    return { error: updated };
  }, { perm: 'error.close' });

  r.delete('/api/errors/:id', ctx => {
    const error = getError(ctx.db, ctx.params.id);
    if(!error) throw notFound('That error');
    ctx.db.run('delete from job_errors where id = ?', error.id);
    ctx.log('Error deleted', { text: `${error.jobNumber}: ${error.description}`, jobNumber: error.jobNumber }, { type: 'error', id: error.id });
    broadcast('job-error-removed', { id: error.id });
  }, { perm: 'error.delete' });
}
