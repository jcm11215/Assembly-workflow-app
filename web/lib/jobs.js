/**
 * What the screens work out from jobs: due status, the dashboard's
 * filters and counts, and which jobs deserve attention first. Pure
 * functions of the data passed in.
 */
import { daysUntil, todayISO } from '../../shared/dates.js';

export function dueStatus(job, today = todayISO()){
  if(job.stage === 'complete') return 'complete';
  if(!job.dueDate) return 'ok';
  const d = daysUntil(job.dueDate, today);
  if(d < 0) return 'overdue';
  if(d <= 3) return 'soon';
  return 'ok';
}

export const DUE_LABEL = { overdue: 'Overdue', soon: 'Due soon', ok: 'On schedule', complete: 'Complete' };

/** Job ids with an unresolved blocker. */
export function blockedJobIds(blockers){
  return new Set(blockers.filter(b => b.status !== 'Resolved').map(b => b.jobId));
}

const open = j => j.stage !== 'complete';
const dueWithin = (j, days, today) => open(j) && j.dueDate && daysUntil(j.dueDate, today) >= 0 && daysUntil(j.dueDate, today) <= days;

/** The Jobs screen's filters. The Home screen's tiles open the matching one. */
export function jobFilters(blockers, today = todayISO()){
  const blocked = blockedJobIds(blockers);
  return [
    { id: 'open',       label: 'Open',          test: open },
    { id: 'overdue',    label: 'Overdue',       test: j => dueStatus(j, today) === 'overdue' },
    { id: 'soon',       label: 'Due soon',      test: j => dueStatus(j, today) === 'soon' },
    { id: 'week',       label: 'Due this week', test: j => dueWithin(j, 7, today) },
    { id: 'blocked',    label: 'Blocked',       test: j => blocked.has(j.id) },
    { id: 'ready',      label: 'Not started',   test: j => j.stage === 'ready' },
    { id: 'inprogress', label: 'In progress',   test: j => j.stage !== 'ready' && open(j) },
    { id: 'complete',   label: 'Complete',      test: j => j.stage === 'complete' },
    { id: 'all',        label: 'All',           test: () => true }
  ];
}

export function metrics(jobs, blockers, today = todayISO()){
  return {
    open: jobs.filter(open).length,
    inProgress: jobs.filter(j => j.stage !== 'ready' && open(j)).length,
    ready: jobs.filter(j => j.stage === 'ready').length,
    blocked: blockedJobIds(blockers).size,
    dueThisWeek: jobs.filter(j => dueWithin(j, 7, today)).length,
    overdue: jobs.filter(j => dueStatus(j, today) === 'overdue').length
  };
}

/**
 * Open jobs, most urgent first: overdue weighs most, then blocked, then
 * due soon, then priority.
 */
export function focusOrder(jobs, blockers, today = todayISO()){
  const blocked = blockedJobIds(blockers);
  return jobs.filter(open).map(job => {
    let score = 0;
    if(job.dueDate){
      const d = daysUntil(job.dueDate, today);
      if(d < 0) score += 500 + Math.min(-d, 30) * 10;
      else if(d <= 3) score += 200 - d * 20;
      else if(d <= 7) score += 80 - d * 5;
    }
    score += { High: 120, Medium: 60, Low: 20 }[job.priority] || 0;
    if(blocked.has(job.id)) score += 250;
    return { job, score };
  }).sort((a, b) => b.score - a.score).map(x => x.job);
}

export function matchesSearch(job, q){
  if(!q) return true;
  const needle = q.trim().toLowerCase();
  return [job.jobNumber, job.customer, job.description, job.assignedName]
    .some(v => String(v || '').toLowerCase().includes(needle));
}
