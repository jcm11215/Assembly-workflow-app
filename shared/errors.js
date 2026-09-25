/**
 * The vocabulary for logged engineering and purchasing errors.
 *
 * An error is not a blocker. A blocker is about now -- something is
 * stopping a job. An error is a fact about a defect: which department
 * made it, which stage caught it, what it cost. Categories are a short
 * fixed list per department so "what do we keep getting wrong" can be
 * answered by counting rather than reading free text.
 */
import { STAGES } from './procedure.js';

export const ERROR_DEPARTMENTS = [
  { id: 'engineering', label: 'Engineering', color: '#e3873a', categories: [
    { id: 'wrong_dimension', label: 'Wrong dimension on the drawing' },
    { id: 'wrong_part_spec', label: 'Wrong part specified' },
    { id: 'missing_detail',  label: 'Missing or incomplete detail' },
    { id: 'stale_revision',  label: 'Superseded revision issued to the floor' },
    { id: 'wont_assemble',   label: "Parts don't fit as drawn" },
    { id: 'other',           label: 'Something else' }
  ]},
  { id: 'purchasing', label: 'Purchasing', color: '#3a86c8', categories: [
    { id: 'wrong_part',       label: 'Wrong part ordered' },
    { id: 'wrong_quantity',   label: 'Wrong quantity ordered' },
    { id: 'ordered_late',     label: 'Ordered too late' },
    { id: 'not_ordered',      label: 'Never ordered' },
    { id: 'wrong_substitute', label: 'Substituted a part that does not work' },
    { id: 'other',            label: 'Something else' }
  ]},
  { id: 'other', label: 'Other', color: '#98a1a9', categories: [
    { id: 'wrong_material', label: 'Wrong material received' },
    { id: 'damaged',        label: 'Part arrived damaged' },
    { id: 'other',          label: 'Something else' }
  ]}
];

export const department = id =>
  ERROR_DEPARTMENTS.find(d => d.id === id) || ERROR_DEPARTMENTS[ERROR_DEPARTMENTS.length - 1];

export function categoryLabel(departmentId, categoryId){
  const hit = department(departmentId).categories.find(c => c.id === categoryId);
  return hit ? hit.label : (categoryId || 'Unspecified');
}

export const isDepartment = id => ERROR_DEPARTMENTS.some(d => d.id === id);
export const isCategory = (departmentId, categoryId) =>
  isDepartment(departmentId) && department(departmentId).categories.some(c => c.id === categoryId);

/** What the error cost, in one short phrase ('' when nothing recordable). */
export function costSummary(e){
  const bits = [];
  if(e.reworkHours) bits.push(`${e.reworkHours} h rework`);
  if(e.scrapped) bits.push('material scrapped');
  if(e.causedDelay) bits.push('delayed the job');
  return bits.join(' · ');
}

/* ---------------- rollups across many errors ---------------- */

/** `reworkHours` sums only errors somebody timed; `timedCount` says how
 *  many that was, so "6 h" reads honestly as "across the 3 of 11 timed". */
export function totals(errors){
  let reworkHours = 0, timedCount = 0, delayed = 0, scrapped = 0, open = 0;
  for(const e of errors){
    if(e.reworkHours != null && Number.isFinite(Number(e.reworkHours))){
      reworkHours += Number(e.reworkHours);
      timedCount++;
    }
    if(e.causedDelay) delayed++;
    if(e.scrapped) scrapped++;
    if(e.status !== 'Corrected') open++;
  }
  return {
    total: errors.length,
    open,
    corrected: errors.length - open,
    reworkHours: Math.round(reworkHours * 4) / 4,
    timedCount, delayed, scrapped,
    jobsAffected: new Set(errors.map(e => e.jobId).filter(Boolean)).size
  };
}

export function byDepartment(errors){
  return ERROR_DEPARTMENTS.map(d => ({
    id: d.id, label: d.label, color: d.color,
    ...totals(errors.filter(e => e.department === d.id))
  }));
}

/** Categories actually hit, commonest first; empty ones left out. */
export function byCategory(errors, limit){
  const rows = new Map();
  for(const e of errors){
    const key = `${e.department}|${e.category}`;
    const row = rows.get(key) || {
      department: e.department, category: e.category,
      label: categoryLabel(e.department, e.category),
      departmentLabel: department(e.department).label,
      color: department(e.department).color,
      count: 0, open: 0
    };
    row.count++;
    if(e.status !== 'Corrected') row.open++;
    rows.set(key, row);
  }
  const sorted = [...rows.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return limit ? sorted.slice(0, limit) : sorted;
}

/** Where errors were caught, in stage order. The same mistake costs
 *  minutes at layout and a teardown at final assembly. */
export function byStageCaught(errors){
  const rows = STAGES.map(s => ({ id: s.id, label: s.label, count: 0 }));
  const unknown = { id: 'unknown', label: 'Not recorded', count: 0 };
  for(const e of errors){
    (rows.find(r => r.id === e.foundAtStage) || unknown).count++;
  }
  const out = rows.filter(r => r.count > 0);
  if(unknown.count) out.push(unknown);
  return out;
}

export function byJob(errors, limit){
  const rows = new Map();
  for(const e of errors){
    const key = e.jobId || 'deleted';
    const row = rows.get(key) || { jobId: e.jobId, jobNumber: e.jobNumber || '(job deleted)', count: 0, open: 0 };
    row.count++;
    if(e.status !== 'Corrected') row.open++;
    rows.set(key, row);
  }
  const sorted = [...rows.values()].sort((a, b) => b.count - a.count || a.jobNumber.localeCompare(b.jobNumber));
  return limit ? sorted.slice(0, limit) : sorted;
}
