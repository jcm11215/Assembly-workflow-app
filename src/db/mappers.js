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
    billOfMaterials: row._bom ?? [],
    hasBlueprintImage: !!row._hasImage,
    blueprintThumbnail: row._thumbnail ?? null,
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

/* ---------------- job errors ---------------- */

/**
 * A logged engineering/purchasing error. `reworkHours` stays null rather
 * than 0 when nobody recorded it: "we didn't measure" and "it cost
 * nothing" are different answers, and averaging them together would
 * quietly understate what errors cost.
 */
export function rowToJobError(row){
  return {
    id: row.id,
    jobId: row.job_id,
    jobNumber: row.job_number || '',        // joined
    department: row.department || 'other',
    category: row.category || 'other',
    description: row.description || '',
    foundAtStage: row.found_at_stage || 'unknown',
    reworkHours: row.rework_hours != null ? Number(row.rework_hours) : null,
    causedDelay: !!row.caused_delay,
    scrapped: !!row.scrapped,
    status: row.status || 'Open',
    correction: row.correction || '',
    blockerId: row.blocker_id || null,
    reportedBy: row.reported_by_name || '',
    reportedAt: row.reported_at || '',
    dateReported: (row.reported_at || '').slice(0, 10),
    correctedAt: row.corrected_at || null
  };
}

export function jobErrorToRow(e, jobId){
  const hours = Number(e.reworkHours);
  return {
    job_id: jobId ?? e.jobId,
    department: e.department || 'other',
    category: e.category || 'other',
    description: e.description || '',
    found_at_stage: e.foundAtStage || 'unknown',
    // '' from an untouched number field is "not recorded", not zero.
    rework_hours: (e.reworkHours === '' || e.reworkHours == null || !isFinite(hours)) ? null : hours,
    caused_delay: !!e.causedDelay,
    scrapped: !!e.scrapped,
    status: e.status || 'Open',
    correction: e.correction || null,
    blocker_id: e.blockerId || null
    // corrected_at is stamped by a DB trigger, never sent from here --
    // it has to agree with status or the row's CHECK rejects it.
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
    id: row.id || null,
    item: row.item,
    item_as_drawn: row.item_as_drawn || '',
    specification: row.specification || '',
    quantity: row.quantity ?? null,
    stage: row.stage || 'other',
    installation_location: row.installation_location || 'unknown',
    source_page: row.source_page ?? null,
    source_callout: row.source_callout || '',
    extraction_method: row.extraction_method || 'inferred',
    confidence: row.confidence != null ? Number(row.confidence) : null,
    sortOrder: row.sort_order ?? 0,
    // The drawing's item/find number, and its part number where the
    // parts table carries one. The item number is the join key the scan
    // matches balloons on; both are also how an assembler cross-checks a
    // part against the paper drawing.
    balloon: row.balloon || null,
    part_number: row.part_number || '',
    position: (row.position_x != null && row.position_y != null)
      ? { x: Number(row.position_x), y: Number(row.position_y) } : null
  };
}

export function componentToRow(c, blueprintId){
  return {
    blueprint_id: blueprintId,
    item: c.item || 'Unspecified item',
    item_as_drawn: c.item_as_drawn || null,
    specification: c.specification || '',
    quantity: c.quantity ?? null,
    stage: c.stage || 'other',
    installation_location: c.installation_location || 'unknown',
    source_page: c.source_page ?? null,
    source_callout: c.source_callout || null,
    extraction_method: c.extraction_method || 'inferred',
    confidence: c.confidence ?? null,
    sort_order: c.sortOrder ?? 0,
    balloon: c.balloon || null,
    part_number: c.part_number || null,
    position_x: c.position ? c.position.x : null,
    position_y: c.position ? c.position.y : null
  };
}
