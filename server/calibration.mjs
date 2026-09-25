/**
 * Scan calibration (the Scan testing screen): answer keys, what the scan
 * learns from them, and the scores of test scans.
 *
 * Marking a job's parts list correct makes it that drawing's answer key.
 * The scan learns from the difference between what it found and the
 * checked list (shared/calibration.js lessonsFrom): the type and end of
 * every part it got wrong or missed, and to leave out what it kept that
 * isn't a part. A test scan reads the drawing again, is scored against
 * the key, and changes nothing on the job.
 */
import { uuid, now } from './db.mjs';
import { broadcast } from './live.mjs';
import { can } from '../shared/roles.js';
import { compareParts, lessonsFrom } from '../shared/calibration.js';
import { SCANNER } from '../web/scan/pipeline.js';

const HISTORY = 30;
const toAdmins = u => can(u.role, 'blueprint.manage');
const parse = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };

/** A list's parts in the shape the comparison reads. */
const asParts = list => (list || []).map(c => ({
  item: c.item, item_as_drawn: c.item_as_drawn, quantity: c.quantity,
  installation_location: c.installation_location, balloon: c.balloon
}));

/** A key as the Scan testing screen shows it. */
export function toKey(db, r){
  const job = db.get('select job_number, customer from jobs where id = ?', r.job_id) || {};
  const bp = r.blueprint_id
    ? db.get('select original_filename, mime_type, file_path from blueprints where id = ?', r.blueprint_id) : null;
  const run = db.get(`select id, status, progress from scans where test_key_id = ? and status in ('queued','running')
                      order by created_at desc limit 1`, r.id);
  const history = parse(r.history, []);
  const who = r.created_by ? db.get('select full_name from users where id = ?', r.created_by) : null;
  return {
    id: r.id, jobId: r.job_id, jobNumber: job.job_number || '', customer: job.customer || '',
    blueprintId: r.blueprint_id, fileName: bp ? bp.original_filename || '' : '', mimeType: bp ? bp.mime_type || '' : '',
    hasFile: !!(bp && bp.file_path),
    parts: parse(r.parts, []).length,
    firstScore: parse(r.first_score, null),
    history, last: history[history.length - 1] || null,
    running: run ? { scanId: run.id, status: run.status, progress: run.progress } : null,
    createdAt: r.created_at, updatedAt: r.updated_at, createdByName: who ? who.full_name : ''
  };
}

export function listKeys(db){
  return db.all(`select k.* from answer_keys k join jobs j on j.id = k.job_id order by j.job_number`).map(r => toKey(db, r));
}

export function pushKey(db, id){
  const r = db.get('select * from answer_keys where id = ?', id);
  if(r) broadcast('calibration', toKey(db, r), toAdmins);
}

/** Saves what a scan should learn: one part_names row per lesson. */
function learn(db, user, lessons){
  for(const l of lessons){
    db.run(`insert into part_names (key, drawn, item, location, updated_by, updated_at) values (?, ?, ?, ?, ?, ?)
            on conflict(key) do update set drawn = excluded.drawn, item = excluded.item, location = excluded.location,
              updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      l.key, l.drawn, l.item, l.location, user ? user.id : null, now());
  }
}

/**
 * The job's current parts list is right: it becomes the drawing's answer
 * key, and the scan learns from what it got wrong. Returns the key, how
 * the scan that made the list did against it (when a server scan made
 * it), and what was learned.
 */
export function markCorrect(db, user, blueprintId){
  const bp = db.get('select * from blueprints where id = ?', blueprintId);
  if(!bp) return null;
  const expected = asParts(db.all('select * from components where blueprint_id = ? order by sort_order', bp.id));
  const scan = db.get(`select result from scans where blueprint_id = ? and result is not null order by updated_at desc limit 1`, bp.id);
  const found = scan ? asParts((parse(scan.result, {}).components) || []) : null;
  const firstScore = found ? compareParts(expected, found) : null;
  const lessons = lessonsFrom(expected, found || []);
  const t = now();
  const existing = db.get('select id from answer_keys where job_id = ?', bp.job_id);
  const id = existing ? existing.id : uuid();
  db.tx(() => {
    learn(db, user, lessons);
    if(existing){
      // A new list is a new target: earlier scores were against the old one.
      db.run(`update answer_keys set blueprint_id = ?, parts = ?, first_score = ?, history = '[]', updated_at = ? where id = ?`,
        bp.id, JSON.stringify(expected), firstScore ? JSON.stringify(firstScore) : null, t, id);
    } else {
      db.run(`insert into answer_keys (id, job_id, blueprint_id, parts, first_score, created_by, created_at, updated_at)
              values (?, ?, ?, ?, ?, ?, ?, ?)`,
        id, bp.job_id, bp.id, JSON.stringify(expected), firstScore ? JSON.stringify(firstScore) : null, user ? user.id : null, t, t);
    }
  });
  pushKey(db, id);
  return { key: toKey(db, db.get('select * from answer_keys where id = ?', id)), firstScore, lessons };
}

/** A test scan finished: its score (or why it failed) goes on the key. */
export function recordTest(db, keyId, { components = null, error = null, summary = '' }){
  const r = db.get('select * from answer_keys where id = ?', keyId);
  if(!r) return;
  const entry = error
    ? { at: now(), error, scanner: SCANNER }
    : { at: now(), scanner: SCANNER, summary, ...compareParts(parse(r.parts, []), asParts(components)) };
  const history = [...parse(r.history, []), entry].slice(-HISTORY);
  db.run('update answer_keys set history = ?, updated_at = ? where id = ?', JSON.stringify(history), now(), keyId);
  pushKey(db, keyId);
}

/** Recent scans by anyone, for spotting what goes wrong. */
export function recentScans(db){
  return db.all(`select s.*, u.full_name as by_name, j.job_number from scans s
                   left join users u on u.id = s.created_by left join jobs j on j.id = s.job_id
                  where s.test_key_id is null order by s.created_at desc limit 25`).map(r => {
    const result = parse(r.result, null);
    return {
      id: r.id, status: r.status, byName: r.by_name || '', jobNumber: r.job_number || (result && result.titleBlock && result.titleBlock.jobNumber) || '',
      fileName: r.file_name || '', createdAt: r.created_at, error: r.error || '',
      partsFound: result ? result.components.length : null, summary: result ? result.summary : ''
    };
  });
}
