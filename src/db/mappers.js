/**
 * Row <-> UI-object mappers.
 *
 * The UI was written against the blob shape (camelCase, `assemblyStatus`,
 * a `checklist` map). The relational schema is snake_case with checklist
 * rows in a separate table. These mappers are the ONLY place that
 * difference is expressed, which is what lets Phase 3 swap persistence
 * without touching a single UI module.
 */

/* ---------------- jobs ---------------- */

/**
 * DB row -> the job object every UI module already expects.
 * `checklistRows` is the job's job_checklist rows (may be omitted).
 */
export function rowToJob(row, checklistRows){
  return {
    id: row.id,
    jobNumber: row.job_number,
    customer: row.customer || '',
    description: row.description || '',
    dueDate: row.due_date || '',
    priority: row.priority || 'Medium',
    assemblyStatus: row.stage || 'ready',
    percentComplete: row.percent_complete ?? 0,
    assignedAssembler: row.assigned_assembler_name || '',
    assignedTo: row.assigned_to || null,
    lastMovedBy: row.last_moved_by_name || '',

    // Optimistic concurrency -- carried on the object so a later write can
    // prove it was based on the version it read.
    version: row.version ?? 1,
    updatedAt: row.updated_at || null,

    checklist: checklistRowsToMap(checklistRows || []),

    // Blueprint-derived fields, hydrated from the blueprints table.
    spec: row._spec ?? null,
    validation: row._validation ?? null,
    geometry: row._geometry ?? null,
    billOfMaterials: row._bom ?? [],
    hasBlueprintImage: !!row._hasImage,
    blueprintExtractedAt: row._extractedAt || null,
    blueprintId: row._blueprintId || null,
    blueprintVersion: row._blueprintVersion ?? null,
    blueprintStatus: row._blueprintStatus ?? null,
    blueprintConfidence: row._blueprintConfidence ?? null,
    blueprintReviewUrgency: row._blueprintReviewUrgency ?? null,
    blueprintAutoApproved: !!row._blueprintAutoApproved
  };
}

/** UI job object -> a jobs-table row patch. Only real columns. */
export function jobToRow(job){
  const row = {
    job_number: job.jobNumber,
    customer: job.customer || '',
    description: job.description || '',
    due_date: job.dueDate || null,
    priority: job.priority || 'Medium',
    stage: job.assemblyStatus || 'ready',
    percent_complete: clampPct(job.percentComplete)
  };
  if(job.assignedTo !== undefined) row.assigned_to = job.assignedTo;
  return row;
}

function clampPct(v){
  const n = Number(v);
  if(!isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/* ---------------- checklist ---------------- */

/** job_checklist rows -> the `{"stepIndex-itemIndex": true}` map the UI reads. */
export function checklistRowsToMap(rows){
  const map = {};
  (rows || []).forEach(r => {
    if(r.done) map[`${r.step_index}-${r.item_index}`] = true;
  });
  return map;
}

/** '2-3' -> {step_index:2, item_index:3}; null if malformed. */
export function parseChecklistKey(key){
  const m = /^(\d+)-(\d+)$/.exec(String(key));
  if(!m) return null;
  return { step_index: Number(m[1]), item_index: Number(m[2]) };
}

/* ---------------- blockers ---------------- */

export function rowToBlocker(row){
  return {
    id: row.id,
    jobId: row.job_id,
    jobNumber: row.job_number || '',        // joined
    issueDescription: row.issue || '',
    responsibleDepartment: row.department || '',
    severity: row.severity || 'Medium',
    status: row.status || 'Open',
    reportedBy: row.reported_by_name || '',
    dateReported: (row.reported_at || '').slice(0, 10)
  };
}

export function blockerToRow(b, jobId){
  return {
    job_id: jobId ?? b.jobId,
    issue: b.issueDescription || '',
    department: b.responsibleDepartment || '',
    severity: b.severity || 'Medium',
    status: b.status || 'Open',
    reported_at: b.dateReported ? new Date(b.dateReported).toISOString() : new Date().toISOString()
  };
}

/* ---------------- notes ---------------- */

export function rowToNote(row){
  return {
    id: row.id,
    jobId: row.job_id,
    jobNumber: row.job_number || '',        // joined; '' means shop-wide
    noteType: row.note_type || 'Progress',
    notes: row.body || '',
    author: row.author_name || '',
    date: row.note_date || ''
  };
}

export function noteToRow(n, jobId){
  return {
    job_id: jobId ?? n.jobId ?? null,
    note_type: n.noteType || 'Progress',
    body: n.notes || '',
    note_date: n.date || new Date().toISOString().slice(0, 10)
  };
}

/* ---------------- activity ---------------- */

/** activity_log row -> the shape the Activity tab renders. */
export function rowToActivity(row){
  return {
    id: row.id,
    who: row.actor_name || 'Unknown',
    action: row.action || '',
    detail: typeof row.detail === 'string'
      ? row.detail
      : (row.detail && row.detail.text) || '',
    at: row.at
  };
}

/* ---------------- blueprint components ---------------- */

export function rowToComponent(row){
  return {
    item: row.item,
    specification: row.specification || '',
    quantity: row.quantity ?? null,
    stage: row.stage || 'other',
    installation_location: row.installation_location || 'unknown',
    source_page: row.source_page ?? null,
    source_callout: row.source_callout || '',
    extraction_method: row.extraction_method || 'inferred',
    confidence: row.confidence != null ? Number(row.confidence) : null
  };
}

export function componentToRow(c, blueprintId){
  return {
    blueprint_id: blueprintId,
    item: c.item || 'Unspecified item',
    specification: c.specification || '',
    quantity: c.quantity ?? null,
    stage: c.stage || 'other',
    installation_location: c.installation_location || 'unknown',
    source_page: c.source_page ?? null,
    source_callout: c.source_callout || null,
    extraction_method: c.extraction_method || 'inferred',
    confidence: c.confidence ?? null
  };
}
