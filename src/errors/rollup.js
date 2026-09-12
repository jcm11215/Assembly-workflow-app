/**
 * The cross-job maths for the error log.
 *
 * Pure functions over a list of errors, kept apart from the rendering so
 * the counting can be tested directly -- it is the part that has to be
 * right. A rollup that quietly double-counts, or averages "nobody timed
 * it" in as zero, would send the shop after the wrong department.
 */
import { ERROR_DEPARTMENTS, errorCategoryLabel, errorDepartment } from '../models/errorMeta.js';
import { STAGES } from '../jobs/procedure.js';

/**
 * Totals for a set of errors.
 *
 * `reworkHours` sums only the errors somebody actually timed, and
 * `timedCount` says how many that was, so a total of "6 h" can be read
 * honestly as "6 h across the 3 of 11 that were timed" rather than as
 * the cost of all eleven.
 */
export function errorTotals(list){
  const errors = list || [];
  let reworkHours = 0, timedCount = 0, delayed = 0, scrapped = 0, open = 0;
  for(const e of errors){
    if(e.reworkHours != null && isFinite(e.reworkHours)){ reworkHours += Number(e.reworkHours); timedCount++; }
    if(e.causedDelay) delayed++;
    if(e.scrapped) scrapped++;
    if(e.status !== 'Corrected') open++;
  }
  return {
    total: errors.length,
    open,
    corrected: errors.length - open,
    // Rounded to a quarter hour: the input step, so the sum reads the way
    // the entries did instead of as a float artefact.
    reworkHours: Math.round(reworkHours * 4) / 4,
    timedCount,
    delayed,
    scrapped,
    jobsAffected: new Set(errors.map(e => e.jobNumber).filter(Boolean)).size
  };
}

/** Per-department totals, in the vocabulary's own order so the table
 *  doesn't reshuffle itself as counts change. */
export function byDepartment(list){
  const errors = list || [];
  return ERROR_DEPARTMENTS.map(d => ({
    id: d.id,
    label: d.label,
    color: d.color,
    ...errorTotals(errors.filter(e => e.department === d.id))
  }));
}

/**
 * The categories people actually hit, commonest first -- the answer to
 * "what do we keep getting wrong". Categories with no errors are left
 * out entirely: a list of zeroes buries the three rows that matter.
 */
export function byCategory(list, limit){
  const counts = new Map();
  for(const e of (list || [])){
    const key = `${e.department}|${e.category}`;
    const row = counts.get(key) || {
      department: e.department, category: e.category,
      label: errorCategoryLabel(e.department, e.category),
      departmentLabel: errorDepartment(e.department).label,
      color: errorDepartment(e.department).color,
      count: 0, open: 0
    };
    row.count++;
    if(e.status !== 'Corrected') row.open++;
    counts.set(key, row);
  }
  const rows = [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return limit ? rows.slice(0, limit) : rows;
}

/**
 * Where errors get caught, in stage order.
 *
 * This is the one that pays for the whole feature: the same mistake
 * costs minutes at layout and a teardown at final assembly, so errors
 * piling up at the late stages says the checks are happening too late --
 * a different problem from making more mistakes.
 */
export function byStageCaught(list){
  const errors = list || [];
  const stages = STAGES.map(s => ({ id: s.id, label: s.label, count: 0 }));
  const unknown = { id: 'unknown', label: 'Not recorded', count: 0 };
  const byId = new Map(stages.map(s => [s.id, s]));
  for(const e of errors){
    const row = byId.get(e.foundAtStage) || unknown;
    row.count++;
  }
  const rows = stages.filter(s => s.count > 0);
  if(unknown.count) rows.push(unknown);
  return rows;
}

/** Jobs with the most errors on them, worst first. */
export function byJob(list, limit){
  const counts = new Map();
  for(const e of (list || [])){
    const key = e.jobNumber || '(job deleted)';
    const row = counts.get(key) || { jobNumber: key, count: 0, open: 0 };
    row.count++;
    if(e.status !== 'Corrected') row.open++;
    counts.set(key, row);
  }
  const rows = [...counts.values()].sort((a, b) => b.count - a.count || a.jobNumber.localeCompare(b.jobNumber));
  return limit ? rows.slice(0, limit) : rows;
}
