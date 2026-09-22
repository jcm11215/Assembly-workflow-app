/**
 * GET /api/state -- everything the app shows, in one request, at start-up
 * and after a reconnect. GET /api/events -- the live update stream.
 */
import { listTeam, listJobs, listBlockers, listNotes, listErrors, listTasks, listCompletions } from '../records.mjs';
import { completionWindow } from '../../shared/tasks.js';
import { todayISO } from '../../shared/dates.js';
import { openStream } from '../live.mjs';
import { getSetting } from '../db.mjs';
import { aiSummary } from '../ai.mjs';

export default function register(r){

  r.get('/api/state', ctx => {
    const db = ctx.db;
    const tasks = listTasks(db);
    const window = completionWindow(tasks, todayISO());
    return {
      me: { id: ctx.user.id, login: ctx.user.login, fullName: ctx.user.fullName, role: ctx.user.role },
      team: listTeam(db).map(({ id, fullName, role, active }) => ({ id, fullName, role, active })),
      jobs: listJobs(db),
      blockers: listBlockers(db),
      notes: listNotes(db),
      errors: listErrors(db),
      tasks,
      completions: listCompletions(db, window.from, window.to),
      ai: aiSummary(getSetting(db, 'ai', {})),
      serverToday: todayISO()
    };
  });

  r.get('/api/events', ctx => {
    openStream(ctx.req, ctx.res, ctx.user);
  });
}
