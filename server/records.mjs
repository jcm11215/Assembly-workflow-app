/**
 * Reads records out of the database in the exact shape the app uses.
 *
 * The API returns these objects and live updates push the same objects,
 * so the browser never translates rows -- what it receives is what it
 * renders. Components keep the field names of the scan pipeline that
 * produces them (item_as_drawn, installation_location, ...), since that
 * is their vocabulary everywhere they are used.
 */

const bool = v => v === 1 || v === true;
const inList = ids => ids.map(() => '?').join(',');

/* ---------------- users ---------------- */

export const toUser = r => ({ id: r.id, login: r.login, fullName: r.full_name, role: r.role, active: bool(r.active) });

export function listTeam(db){
  return db.all('select id, login, full_name, role, active, created_at from users order by full_name collate nocase')
    .map(r => ({ ...toUser(r), createdAt: r.created_at }));
}

/* ---------------- jobs ---------------- */

const JOB_SQL = `
  select j.*, a.full_name as assigned_name, m.full_name as moved_by_name
    from jobs j
    left join users a on a.id = j.assigned_to
    left join users m on m.id = j.last_moved_by`;

export function toComponent(r){
  return {
    id: r.id,
    item: r.item,
    item_as_drawn: r.item_as_drawn,
    specification: r.specification,
    quantity: r.quantity,
    stage: r.stage,
    installation_location: r.installation_location,
    source_page: r.source_page,
    source_callout: r.source_callout,
    extraction_method: r.extraction_method,
    confidence: r.confidence,
    balloon: r.balloon,
    part_number: r.part_number,
    position: r.position_x != null && r.position_y != null ? { x: r.position_x, y: r.position_y } : null,
    sortOrder: r.sort_order
  };
}

export function toBlueprint(r, components){
  return {
    id: r.id,
    jobId: r.job_id,
    version: r.version,
    fileName: r.original_filename,
    mimeType: r.mime_type,
    hasFile: !!r.file_path,
    hasThumbnail: !!r.has_thumbnail,
    extractedAt: r.extracted_at,
    extractedByName: r.extracted_by_name || '',
    components
  };
}

/** The newest blueprint version for each of `jobIds`, with its parts. */
function latestBlueprints(db, jobIds){
  if(!jobIds.length) return new Map();
  const rows = db.all(`
    select b.id, b.job_id, b.version, b.file_path, b.original_filename, b.mime_type, b.extracted_at,
           b.thumbnail is not null as has_thumbnail, u.full_name as extracted_by_name
      from blueprints b left join users u on u.id = b.extracted_by
     where b.job_id in (${inList(jobIds)})
       and b.version = (select max(version) from blueprints x where x.job_id = b.job_id)`, ...jobIds);
  const parts = componentsFor(db, rows.map(r => r.id));
  return new Map(rows.map(r => [r.job_id, toBlueprint(r, parts.get(r.id) || [])]));
}

export function componentsFor(db, blueprintIds){
  const out = new Map();
  if(!blueprintIds.length) return out;
  for(const r of db.all(`select * from components where blueprint_id in (${inList(blueprintIds)})
                          order by sort_order, rowid`, ...blueprintIds)){
    if(!out.has(r.blueprint_id)) out.set(r.blueprint_id, []);
    out.get(r.blueprint_id).push(toComponent(r));
  }
  return out;
}

function checklistsFor(db, jobIds){
  const out = new Map();
  if(!jobIds.length) return out;
  for(const r of db.all(`select c.job_id, c.step, c.item, c.done_at, u.full_name
                           from checklist c left join users u on u.id = c.done_by
                          where c.job_id in (${inList(jobIds)})`, ...jobIds)){
    if(!out.has(r.job_id)) out.set(r.job_id, {});
    out.get(r.job_id)[`${r.step}-${r.item}`] = { by: r.full_name || '', at: r.done_at };
  }
  return out;
}

function toJob(r, checklist, blueprint){
  return {
    id: r.id,
    jobNumber: r.job_number,
    customer: r.customer,
    description: r.description,
    dueDate: r.due_date || '',
    priority: r.priority,
    stage: r.stage,
    percentComplete: r.percent_complete,
    assignedTo: r.assigned_to,
    assignedName: r.assigned_name || '',
    lastMovedByName: r.moved_by_name || '',
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    checklist: checklist || {},
    blueprint: blueprint || null
  };
}

function hydrateJobs(db, rows){
  const ids = rows.map(r => r.id);
  const checklists = checklistsFor(db, ids);
  const blueprints = latestBlueprints(db, ids);
  return rows.map(r => toJob(r, checklists.get(r.id), blueprints.get(r.id)));
}

export function listJobs(db){
  return hydrateJobs(db, db.all(`${JOB_SQL} order by j.due_date is null, j.due_date, j.job_number`));
}

export function getJob(db, id){
  const row = db.get(`${JOB_SQL} where j.id = ?`, id);
  return row ? hydrateJobs(db, [row])[0] : null;
}

/* ---------------- blockers ---------------- */

const BLOCKER_SQL = `
  select b.*, j.job_number, r.full_name as reported_by_name, x.full_name as resolved_by_name
    from blockers b
    join jobs j on j.id = b.job_id
    left join users r on r.id = b.reported_by
    left join users x on x.id = b.resolved_by`;

const toBlocker = r => ({
  id: r.id,
  jobId: r.job_id,
  jobNumber: r.job_number,
  issue: r.issue,
  department: r.department,
  severity: r.severity,
  status: r.status,
  reportedBy: r.reported_by,
  reportedByName: r.reported_by_name || '',
  reportedOn: r.reported_on,
  createdAt: r.created_at,
  resolvedByName: r.resolved_by_name || '',
  resolvedAt: r.resolved_at
});

export const listBlockers = db => db.all(`${BLOCKER_SQL} order by b.created_at desc`).map(toBlocker);
export function getBlocker(db, id){
  const r = db.get(`${BLOCKER_SQL} where b.id = ?`, id);
  return r ? toBlocker(r) : null;
}

/* ---------------- notes ---------------- */

const NOTE_SQL = `
  select n.*, j.job_number, u.full_name as author_name
    from notes n
    left join jobs j on j.id = n.job_id
    left join users u on u.id = n.author`;

const toNote = r => ({
  id: r.id,
  jobId: r.job_id,
  jobNumber: r.job_number || '',
  type: r.type,
  body: r.body,
  date: r.note_date,
  authorId: r.author,
  authorName: r.author_name || '',
  createdAt: r.created_at
});

export const NOTES_LOADED = 500;
export const listNotes = db =>
  db.all(`${NOTE_SQL} order by n.note_date desc, n.created_at desc limit ${NOTES_LOADED}`).map(toNote);
export function getNote(db, id){
  const r = db.get(`${NOTE_SQL} where n.id = ?`, id);
  return r ? toNote(r) : null;
}

/* ---------------- errors ---------------- */

const ERROR_SQL = `
  select e.*, j.job_number, u.full_name as reported_by_name
    from job_errors e
    join jobs j on j.id = e.job_id
    left join users u on u.id = e.reported_by`;

const toError = r => ({
  id: r.id,
  jobId: r.job_id,
  jobNumber: r.job_number,
  department: r.department,
  category: r.category,
  description: r.description,
  foundAtStage: r.found_at_stage,
  reworkHours: r.rework_hours,
  causedDelay: bool(r.caused_delay),
  scrapped: bool(r.scrapped),
  status: r.status,
  correction: r.correction || '',
  blockerId: r.blocker_id,
  reportedByName: r.reported_by_name || '',
  reportedAt: r.reported_at,
  correctedAt: r.corrected_at
});

export const listErrors = db => db.all(`${ERROR_SQL} order by e.reported_at desc`).map(toError);
export function getError(db, id){
  const r = db.get(`${ERROR_SQL} where e.id = ?`, id);
  return r ? toError(r) : null;
}

/* ---------------- tasks ---------------- */

const TASK_SQL = `
  select t.*, j.job_number, u.full_name as assigned_name
    from tasks t
    left join jobs j on j.id = t.job_id
    left join users u on u.id = t.assigned_to`;

const toTask = r => ({
  id: r.id,
  title: r.title,
  details: r.details,
  jobId: r.job_id,
  jobNumber: r.job_number || '',
  assignedTo: r.assigned_to,
  assignedName: r.assigned_name || '',
  recurrence: r.recurrence,
  dueDate: r.due_date || '',
  weekday: r.weekday,
  startsOn: r.starts_on || '',
  active: bool(r.active),
  createdAt: r.created_at
});

export const listTasks = db => db.all(`${TASK_SQL} order by t.created_at desc`).map(toTask);
export function getTask(db, id){
  const r = db.get(`${TASK_SQL} where t.id = ?`, id);
  return r ? toTask(r) : null;
}

const toCompletion = r => ({
  taskId: r.task_id,
  dueOn: r.due_on,
  doneBy: r.done_by,
  doneByName: r.done_by_name || '',
  doneAt: r.done_at
});

export function listCompletions(db, from, to){
  return db.all(`select c.*, u.full_name as done_by_name
                   from task_completions c left join users u on u.id = c.done_by
                  where c.due_on between ? and ? order by c.due_on desc`, from, to).map(toCompletion);
}

export function getCompletion(db, taskId, dueOn){
  const r = db.get(`select c.*, u.full_name as done_by_name
                      from task_completions c left join users u on u.id = c.done_by
                     where c.task_id = ? and c.due_on = ?`, taskId, dueOn);
  return r ? toCompletion(r) : null;
}

/* ---------------- activity ---------------- */

export const toActivity = r => ({
  id: r.id,
  actorId: r.actor_id,
  actorName: r.actor_name,
  action: r.action,
  entityType: r.entity_type,
  entityId: r.entity_id,
  detail: JSON.parse(r.detail),
  at: r.at
});
