/**
 * The vocabulary for logged engineering and purchasing errors.
 *
 * WHY THIS IS NOT A BLOCKER. A blocker is about now -- something is
 * stopping this job and needs unsticking, so its whole life is
 * Open -> Resolved. An error is a fact about a defect: which department
 * made it, what stage caught it, and what it cost to put right. Most
 * errors never block anything (a wrong dimension caught at layout is
 * twenty minutes), and the ones that do are worth recording separately
 * from the blocker they caused, because the point of an error log is the
 * pattern across jobs, not the one job's schedule.
 *
 * WHY CATEGORIES ARE FIXED AND DEPARTMENT-SCOPED. Free text is what the
 * blocker list already has, and free text cannot be counted: "wrong
 * bore", "bore size wrong" and "brg bore mismatch" are three rows and
 * one problem. A short fixed list per department keeps the form to a few
 * taps on a phone and makes "what do we get wrong most often" answerable
 * by counting rather than reading. "Other" carries the rest, with the
 * description doing the work.
 */

export const ERROR_DEPARTMENTS = [
  {
    id: 'engineering',
    label: 'Engineering',
    color: '#e3873a',
    categories: [
      { id: 'wrong_dimension',  label: 'Wrong dimension on the drawing' },
      { id: 'wrong_part_spec',  label: 'Wrong part specified' },
      { id: 'missing_detail',   label: 'Missing or incomplete detail' },
      { id: 'stale_revision',   label: 'Superseded revision issued to the floor' },
      { id: 'wont_assemble',    label: "Parts don't fit as drawn" },
      { id: 'other',            label: 'Something else' }
    ]
  },
  {
    id: 'purchasing',
    label: 'Purchasing',
    color: '#3a86c8',
    categories: [
      { id: 'wrong_part',       label: 'Wrong part ordered' },
      { id: 'wrong_quantity',   label: 'Wrong quantity ordered' },
      { id: 'ordered_late',     label: 'Ordered too late' },
      { id: 'not_ordered',      label: 'Never ordered' },
      { id: 'wrong_substitute', label: 'Substituted a part that does not work' },
      { id: 'other',            label: 'Something else' }
    ]
  },
  {
    id: 'other',
    label: 'Other',
    color: '#98a1a9',
    categories: [
      { id: 'wrong_material',   label: 'Wrong material received' },
      { id: 'damaged',          label: 'Part arrived damaged' },
      { id: 'other',            label: 'Something else' }
    ]
  }
];

export const ERROR_STATUSES = ['Open', 'Corrected'];

export const errorDepartment = id =>
  ERROR_DEPARTMENTS.find(d => d.id === id) || ERROR_DEPARTMENTS[ERROR_DEPARTMENTS.length - 1];

export const errorDepartmentLabel = id => errorDepartment(id).label;
export const errorDepartmentColor = id => errorDepartment(id).color;

/** The category's label, falling back to the stored id so an error
 *  logged under a category later removed still reads as something. */
export function errorCategoryLabel(departmentId, categoryId){
  const hit = errorDepartment(departmentId).categories.find(c => c.id === categoryId);
  return hit ? hit.label : (categoryId || 'Unspecified');
}

/** Valid ids, for rejecting anything a stale form or a hand-written row
 *  might carry -- the counting is only as good as the vocabulary. */
export const isErrorDepartment = id => ERROR_DEPARTMENTS.some(d => d.id === id);
export const isErrorCategory = (departmentId, categoryId) =>
  errorDepartment(departmentId).categories.some(c => c.id === categoryId);

/**
 * What the error cost, in one short phrase, or '' when it cost nothing
 * recordable. Rework hours and a missed ship date are the two things the
 * shop actually feels, so they lead.
 */
export function errorCostSummary(e){
  const bits = [];
  if(e.reworkHours) bits.push(`${e.reworkHours} h rework`);
  if(e.scrapped) bits.push('material scrapped');
  if(e.causedDelay) bits.push('delayed the job');
  return bits.join(' · ');
}
