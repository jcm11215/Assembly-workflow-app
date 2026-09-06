/** Derived job data: due status, filters, metrics, focus ranking. Pure. */


import { state } from '../state/store.js';
import { daysUntil } from '../utils/date.js';

export function dueStatus(job){
  if(job.assemblyStatus === 'complete') return 'complete';
  const du = daysUntil(job.dueDate);
  if(du < 0) return 'overdue';
  if(du <= 3) return 'soon';
  return 'ok';
}

export function dueStatusLabel(s){
  return {overdue:'Overdue', soon:'Due Soon', ok:'On Schedule', complete:'Complete'}[s];
}

export function openBlockerJobSet(){
  return new Set(state.blockers.filter(b=>b.status!=='Resolved').map(b=>b.jobNumber));
}

/* Filters shown as chips on the Dashboard -- also the target of tapping
   a metric card, so the two systems stay in sync (1 tap from a metric
   straight to the matching filtered list). */

//    straight to the matching filtered list).
export function getJobFilters(){
  const blockedSet = openBlockerJobSet();
  return [
    {id:'all', label:'All', test:()=>true},
    {id:'overdue', label:'Overdue', test:j=>dueStatus(j)==='overdue'},
    {id:'soon', label:'Due Soon', test:j=>dueStatus(j)==='soon'},
    {id:'week', label:'Due This Week', test:j=> j.assemblyStatus!=='complete' && daysUntil(j.dueDate)>=0 && daysUntil(j.dueDate)<=7},
    {id:'blocked', label:'Blocked', test:j=> blockedSet.has(j.jobNumber)},
    {id:'ready', label:'Ready', test:j=> j.assemblyStatus==='ready'},
    {id:'inprogress', label:'In Progress', test:j=> j.assemblyStatus!=='ready' && j.assemblyStatus!=='complete'},
    {id:'ok', label:'On Schedule', test:j=>dueStatus(j)==='ok'},
    {id:'complete', label:'Complete', test:j=>dueStatus(j)==='complete'}
  ];
}

export const BLOCKER_FILTERS = [
  {id:'active', label:'Active', test:b=>b.status!=='Resolved'},
  {id:'open', label:'Open', test:b=>b.status==='Open'},
  {id:'inprogress', label:'In Progress', test:b=>b.status==='In Progress'},
  {id:'resolved', label:'Resolved', test:b=>b.status==='Resolved'},
  {id:'all', label:'All', test:()=>true}
];

/* ---------------- Seed data (first run only) ---------------- */

/* ---------------- Metrics ---------------- */
export function computeMetrics(){
  const jobs = state.jobs;
  const inProgress = jobs.filter(j=>j.assemblyStatus!=='ready' && j.assemblyStatus!=='complete').length;
  const readyCount = jobs.filter(j=>j.assemblyStatus==='ready').length;
  const blockedCount = openBlockerJobSet().size;
  const dueThisWeek = jobs.filter(j=>{
    if(j.assemblyStatus==='complete') return false;
    const du = daysUntil(j.dueDate);
    return du >= 0 && du <= 7;
  }).length;
  const overdue = jobs.filter(j=> j.assemblyStatus!=='complete' && daysUntil(j.dueDate) < 0).length;
  return {inProgress, readyCount, blockedCount, dueThisWeek, overdue};
}

/* ================= DASHBOARD ================= */
export function computeFocusJobs(){
  const blockedSet = openBlockerJobSet();
  const scored = state.jobs.filter(j=>j.assemblyStatus!=='complete').map(j=>{
    const du = daysUntil(j.dueDate);
    let score = 0;
    if(du<0) score += 500 + Math.min(Math.abs(du),30)*10;
    else if(du<=3) score += 200 - du*20;
    else if(du<=7) score += 80 - du*5;
    score += {High:120, Medium:60, Low:20}[j.priority] || 0;
    if(blockedSet.has(j.jobNumber)) score += 250;
    return {job:j, score};
  }).sort((a,b)=>b.score-a.score);
  return scored;
}
