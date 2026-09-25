/**
 * The Home dashboard's numbers. One set of filters is shared by every
 * number, chart and list on the page; clicking a bar or a number sets
 * one of them.
 *
 * Each chart is counted with every filter except its own, so a chart
 * keeps showing all its bars -- the chosen one highlighted -- while
 * everything else narrows to that choice. Pure functions of the data
 * passed in.
 */
import { STAGES } from '../../shared/procedure.js';
import { daysUntil, todayISO, shiftDays, toISODate, dayOfWeek } from '../../shared/dates.js';
import { blockedJobIds, focusOrder } from './jobs.js';

export const NO_FILTERS = Object.freeze({ lead: '', priority: '', stage: '', due: '', blocked: false });

/** The lead filter's value for jobs nobody leads. */
export const UNASSIGNED = '-';

/** When an open job is due, as the timeline groups it. */
export const DUE_BUCKETS = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'd7', label: 'Next 7 days' },
  { id: 'd14', label: '8–14 days' },
  { id: 'd30', label: '15–30 days' },
  { id: 'later', label: 'Later' },
  { id: 'none', label: 'No date' }
];

/** The due status every chart splits its bars by. */
export const DUE_SERIES = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'soon', label: 'Due in 7 days' },
  { id: 'later', label: 'Later or no date' }
];

/** Short stage names for chart labels; the full name is in the tooltip. */
const SHORT_STAGE = { ready: 'Ready', layout: 'Layout', bearings: 'Bearings', drive: 'Drive', final: 'Final assembly', testing: 'Testing', qc: 'QC' };

export function dueBucket(job, today = todayISO()){
  if(!job.dueDate) return 'none';
  const d = daysUntil(job.dueDate, today);
  if(d < 0) return 'overdue';
  if(d <= 7) return 'd7';
  if(d <= 14) return 'd14';
  if(d <= 30) return 'd30';
  return 'later';
}

const seriesOf = bucket => (bucket === 'overdue' ? 'overdue' : bucket === 'd7' ? 'soon' : 'later');
const leadOf = job => job.assignedTo || UNASSIGNED;
const emptySplit = () => ({ overdue: 0, soon: 0, later: 0 });

function matches(job, f, blocked, today, skip){
  if(skip !== 'lead' && f.lead && leadOf(job) !== f.lead) return false;
  if(skip !== 'priority' && f.priority && job.priority !== f.priority) return false;
  if(skip !== 'stage' && f.stage && job.stage !== f.stage) return false;
  if(skip !== 'due' && f.due && dueBucket(job, today) !== f.due) return false;
  if(skip !== 'blocked' && f.blocked && !blocked.has(job.id)) return false;
  return true;
}

/** Monday of the week `iso` falls in. */
const weekStart = iso => shiftDays(iso, -((dayOfWeek(iso) + 6) % 7));

/**
 * Everything the dashboard draws, for these filters.
 *
 *   jobs       the open jobs in view, most urgent first
 *   tiles      the headline counts (each ignoring its own filter)
 *   stages     open jobs per stage, split by due status
 *   leads      open jobs per lead, split by due status (busiest first)
 *   due        open jobs per due bucket
 *   completed  jobs finished in each of the last `weeks` weeks (lead
 *              and priority filters only: finished jobs have no stage
 *              or due status left to filter by)
 *   leadOptions  everyone who leads an open job, for the lead filter
 */
export function dashboard(jobs, blockers, f = NO_FILTERS, today = todayISO(), { weeks = 8 } = {}){
  const blocked = blockedJobIds(blockers);
  const open = jobs.filter(j => j.stage !== 'complete');
  const where = skip => open.filter(j => matches(j, f, blocked, today, skip));
  const inView = where(null);

  const withoutDue = where('due');
  const tiles = {
    open: inView.length,
    soon: withoutDue.filter(j => dueBucket(j, today) === 'd7').length,
    overdue: withoutDue.filter(j => dueBucket(j, today) === 'overdue').length,
    blocked: where('blocked').filter(j => blocked.has(j.id)).length
  };

  const stageJobs = where('stage');
  const stages = STAGES.filter(s => s.id !== 'complete').map(s => {
    const split = emptySplit();
    for(const j of stageJobs) if(j.stage === s.id) split[seriesOf(dueBucket(j, today))]++;
    return { id: s.id, label: SHORT_STAGE[s.id] || s.label, fullLabel: s.label, values: split, total: split.overdue + split.soon + split.later };
  });

  const byLead = new Map();
  for(const j of where('lead')){
    const id = leadOf(j);
    if(!byLead.has(id)) byLead.set(id, { id, label: id === UNASSIGNED ? 'Unassigned' : j.assignedName || 'Someone', values: emptySplit(), total: 0 });
    const row = byLead.get(id);
    row.values[seriesOf(dueBucket(j, today))]++;
    row.total++;
  }
  const leads = [...byLead.values()].sort((a, b) =>
    (a.id === UNASSIGNED) - (b.id === UNASSIGNED) || b.total - a.total || a.label.localeCompare(b.label));

  const dueJobs = where('due');
  const due = DUE_BUCKETS.map(b => ({ ...b, value: dueJobs.filter(j => dueBucket(j, today) === b.id).length }));

  const thisWeek = weekStart(today);
  const done = jobs.filter(j => j.stage === 'complete' && j.completedAt
    && (!f.lead || leadOf(j) === f.lead) && (!f.priority || j.priority === f.priority));
  const completed = [];
  for(let i = weeks - 1; i >= 0; i--){
    const start = shiftDays(thisWeek, -7 * i);
    const end = shiftDays(start, 7);
    const value = done.filter(j => {
      const day = toISODate(new Date(j.completedAt));
      return day >= start && day < end;
    }).length;
    completed.push({ id: start, label: i === 0 ? 'This week' : shortDate(start), value, current: i === 0 });
  }

  const leadOptions = new Map();
  for(const j of open) leadOptions.set(leadOf(j), leadOf(j) === UNASSIGNED ? 'Unassigned' : j.assignedName || 'Someone');

  return {
    jobs: focusOrder(inView, blockers, today),
    tiles, stages, leads, due, completed,
    leadOptions: [...leadOptions].map(([id, label]) => ({ id, label }))
      .sort((a, b) => (a.id === UNASSIGNED) - (b.id === UNASSIGNED) || a.label.localeCompare(b.label))
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDate(iso){
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/** The filters in words, for the chips above the charts. */
export function describeFilters(f, leadOptions = []){
  const out = [];
  if(f.stage) out.push({ key: 'stage', label: `Stage: ${(STAGES.find(s => s.id === f.stage) || {}).label || f.stage}` });
  if(f.due) out.push({ key: 'due', label: `Due: ${(DUE_BUCKETS.find(b => b.id === f.due) || {}).label || f.due}` });
  if(f.blocked) out.push({ key: 'blocked', label: 'Blocked' });
  if(f.lead) out.push({ key: 'lead', label: `Lead: ${(leadOptions.find(o => o.id === f.lead) || {}).label || 'Someone'}` });
  if(f.priority) out.push({ key: 'priority', label: `${f.priority} priority` });
  return out;
}
