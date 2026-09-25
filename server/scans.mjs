/**
 * Blueprint scans, run by the server so one carries on whatever the
 * device that started it does -- a phone locked, the app closed, the
 * screen left.
 *
 * The device does the quick part: renders the pages, reads their text,
 * finds the parts table (web/scan/pdf.js, pipeline.js contentFor). It
 * sends those prepared pages and the original file here in one upload,
 * and the slow part -- the AI reading the sheets -- runs on the server
 * with the same code (web/scan/pipeline.js readDrawing), calling the AI
 * directly.
 *
 * One scan runs at a time: they share the one GPU. Progress and the
 * result go to the person who started it over the live stream. A re-scan
 * of a job saves itself as the job's newest blueprint; a new job from a
 * drawing waits, done, until someone reviews it and creates the job.
 * Scans a restart interrupted start again when the server is back.
 *
 * A test scan (`test_key_id`, the Scan testing screen) reads a drawing
 * that has an answer key, is scored against it (calibration.mjs), and
 * saves nothing to the job.
 */
import fs from 'node:fs';
import path from 'node:path';
import { uuid, now, getSetting } from './db.mjs';
import { callAI } from './ai.mjs';
import { broadcast } from './live.mjs';
import { logActivity } from './app.mjs';
import { createBlueprint } from './routes/blueprints.mjs';
import { readDrawing, scanSummary, diagnosticsWorthLogging } from '../web/scan/pipeline.js';
import { pushKey, recordTest } from './calibration.mjs';

/** Finished scans are cleared away after this long. */
const KEEP_MS = 7 * 24 * 3600 * 1000;

/** db -> whether its runner is going. One per database, so tests that
 *  run several servers in one process don't wait on each other. */
const runners = new WeakMap();

const dirOf = filesDir => path.join(filesDir, 'scans');
const pagesFile = (filesDir, id) => path.join(dirOf(filesDir), `${id}.pages.json`);
const originalFile = (filesDir, id) => path.join(dirOf(filesDir), `${id}.file`);

function userOf(db, id){
  const u = id && db.get('select id, full_name, role, login from users where id = ?', id);
  return u ? { id: u.id, fullName: u.full_name, role: u.role, login: u.login } : null;
}

/** A scan as the app sees it. The parts travel only while it waits to
 *  become a new job; the job page has them after that. */
export function toScan(r, db){
  const job = r.job_id ? db.get('select job_number from jobs where id = ?', r.job_id) : null;
  let result = null;
  if(r.result){ try { result = JSON.parse(r.result); } catch { result = null; } }
  return {
    id: r.id, jobId: r.job_id,
    jobNumber: job ? job.job_number : (result && result.titleBlock && result.titleBlock.jobNumber) || '',
    forNewJob: !!r.include_job_fields,
    status: r.status, progress: r.progress, fileName: r.file_name || '', error: r.error || '', dismissed: !!r.dismissed,
    blueprintId: r.blueprint_id, createdAt: r.created_at, updatedAt: r.updated_at,
    partsFound: result ? result.components.length : null,
    summary: result ? result.summary : '',
    ...(r.status === 'done' && !r.job_id && result ? { result: { titleBlock: result.titleBlock, components: result.components, scanner: result.scanner } } : {})
  };
}

/** The scans a person hasn't put away, newest first. */
export function listScans(db, userId){
  return db.all('select * from scans where created_by = ? and dismissed = 0 and test_key_id is null order by created_at desc limit 20', userId)
    .map(r => toScan(r, db));
}

function push(db, id){
  const r = db.get('select * from scans where id = ?', id);
  if(!r) return;
  // A test scan's progress shows on its answer key, not in the banner.
  if(r.test_key_id) pushKey(db, r.test_key_id);
  else broadcast('scan', toScan(r, db), u => u.id === r.created_by);
}

function set(db, id, fields){
  const keys = Object.keys(fields);
  db.run(`update scans set ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = ? where id = ?`, ...keys.map(k => fields[k]), now(), id);
  push(db, id);
}

/** Queues a scan whose pages and file have arrived, and returns it. */
export function startScan(db, filesDir, user, { jobId = null, includeJobFields = false, fileName = null, mimeType = null, thumbnail = null, blocks, fileBytes = null, testKeyId = null }){
  const id = uuid();
  fs.mkdirSync(dirOf(filesDir), { recursive: true });
  fs.writeFileSync(pagesFile(filesDir, id), JSON.stringify(blocks));
  if(fileBytes && fileBytes.length && !testKeyId) fs.writeFileSync(originalFile(filesDir, id), fileBytes);
  const t = now();
  try {
    db.run(`insert into scans (id, job_id, created_by, status, progress, include_job_fields, file_name, mime_type, thumbnail, test_key_id, created_at, updated_at)
            values (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, jobId, user.id, 'Waiting its turn…', includeJobFields ? 1 : 0, fileName, mimeType, thumbnail, testKeyId, t, t);
  } catch (err) {
    cleanUp(filesDir, id);
    throw err;
  }
  kick(db, filesDir);
  return toScan(db.get('select * from scans where id = ?', id), db);
}

/** Runs queued scans, oldest first, one at a time. */
export function kick(db, filesDir){
  if(runners.get(db)) return;
  runners.set(db, true);
  (async () => {
    try {
      for(;;){
        const next = db.get(`select * from scans where status = 'queued' order by created_at limit 1`);
        if(!next) break;
        await runOne(db, filesDir, next);
      }
    } finally {
      runners.set(db, false);
    }
  })().catch(e => console.error('scan runner stopped', e));
}

/** Put away, or stopped, since it was queued. */
const stopped = (db, id) => {
  const r = db.get('select status, dismissed from scans where id = ?', id);
  return !r || !!r.dismissed || r.status === 'cancelled';
};

/** A failure as the person who started the scan should read it. */
function explain(err){
  const msg = String((err && err.message) || err || '');
  if(err && err.unreachable) return `The local AI isn't answering. Check that Ollama is running on the server. (${msg})`;
  return msg || 'The AI request failed.';
}

async function runOne(db, filesDir, scan){
  const user = userOf(db, scan.created_by);
  set(db, scan.id, { status: 'running', progress: 'Starting…', error: null });
  let blocks;
  try { blocks = JSON.parse(fs.readFileSync(pagesFile(filesDir, scan.id), 'utf8')); }
  catch {
    set(db, scan.id, { status: 'failed', progress: '', error: 'The prepared pages were lost. Start the scan again from the drawing.' });
    return;
  }

  const learned = new Map(db.all('select key, item, location from part_names').map(p => [p.key, { item: p.item, location: p.location }]));
  let last = 0;
  const onStatus = text => {
    // Several updates a second help nobody.
    if(Date.now() - last < 800) return;
    last = Date.now();
    set(db, scan.id, { progress: String(text).slice(0, 200) });
  };
  // Each question checks first whether the scan was stopped, so stopping
  // one waits at most for the question already with the AI.
  const ask = async (system, content) => {
    if(stopped(db, scan.id)) throw Object.assign(new Error('The scan was stopped.'), { stopped: true });
    return callAI(getSetting(db, 'ai', {}), system, content);
  };

  let result;
  try {
    result = await readDrawing(blocks, { includeJobFields: !!scan.include_job_fields, learned, onStatus, ask });
  } catch (err) {
    if(stopped(db, scan.id)){ finishStopped(db, filesDir, scan.id); return; }
    const message = explain(err);
    if(scan.test_key_id){
      set(db, scan.id, { status: 'failed', progress: '', error: message, dismissed: 1 });
      cleanUp(filesDir, scan.id);
      recordTest(db, scan.test_key_id, { error: message });
      return;
    }
    set(db, scan.id, { status: 'failed', progress: '', error: message });
    logActivity(db, user, 'Blueprint scan failed', { text: `${jobLabel(db, scan)}: ${message}` }, scan.job_id ? { type: 'job', id: scan.job_id } : null);
    return;
  }
  if(stopped(db, scan.id)){ finishStopped(db, filesDir, scan.id); return; }

  const summary = scanSummary(result.components, result.diagnostics);
  if(scan.test_key_id){
    set(db, scan.id, { status: 'done', progress: '', dismissed: 1,
      result: JSON.stringify({ components: result.components, titleBlock: result.titleBlock, summary, scanner: result.scanner }) });
    cleanUp(filesDir, scan.id);
    recordTest(db, scan.test_key_id, { components: result.components, summary });
    return;
  }
  for(const k of result.diagnostics.learnedKeys) db.run('update part_names set used_count = used_count + 1 where key = ?', k);
  if(diagnosticsWorthLogging(result.components, result.diagnostics)){
    logActivity(db, user, 'Blueprint scan diagnostics', { text: `${jobLabel(db, scan)}: ${summary}`, ...result.diagnostics },
      scan.job_id ? { type: 'job', id: scan.job_id } : null);
  }
  const stored = JSON.stringify({ components: result.components, titleBlock: result.titleBlock, summary, scanner: result.scanner });

  if(scan.job_id){
    try {
      await saveToJob(db, filesDir, user, { ...scan, result: stored }, scan.job_id);
      set(db, scan.id, { status: 'saved', progress: '', result: stored });
    } catch (err) {
      set(db, scan.id, { status: 'failed', progress: '', error: `The drawing was read, but saving it failed: ${err.message}`, result: stored });
    }
    return;
  }
  set(db, scan.id, { status: 'done', progress: '', result: stored });
  // Only the original file is needed now, for when the job is created.
  fs.rmSync(pagesFile(filesDir, scan.id), { force: true });
}

function finishStopped(db, filesDir, id){
  set(db, id, { status: 'cancelled', progress: '' });
  cleanUp(filesDir, id);
}

const jobLabel = (db, scan) => (scan.job_id
  ? (db.get('select job_number from jobs where id = ?', scan.job_id) || {}).job_number || 'A job'
  : 'New job');

/** Saves a read scan as the job's newest blueprint, with its file.
 *  Returns the job as pushed to everyone. */
async function saveToJob(db, filesDir, user, scan, jobId){
  const job = db.get('select * from jobs where id = ?', jobId);
  if(!job) throw new Error('that job no longer exists');
  const { components, scanner } = JSON.parse(scan.result);
  let fileBytes = null;
  try { fileBytes = fs.readFileSync(originalFile(filesDir, scan.id)); } catch { /* saved without it */ }
  const updated = await createBlueprint(db, filesDir, user || { id: null }, job, {
    components, thumbnail: scan.thumbnail ? Buffer.from(scan.thumbnail) : null,
    fileName: scan.file_name, mimeType: scan.mime_type, fileBytes, scanner
  }, (action, detail, entity) => logActivity(db, user, action, detail, entity));
  db.run('update scans set blueprint_id = ?, job_id = ? where id = ?', updated.blueprint ? updated.blueprint.id : null, jobId, scan.id);
  cleanUp(filesDir, scan.id);
  return updated;
}

/** A finished new-job scan, saved to the job someone just created from
 *  it. Returns the job. */
export async function attachToJob(db, filesDir, user, scanId, jobId){
  const scan = db.get('select * from scans where id = ?', scanId);
  if(!scan || scan.status !== 'done' || scan.job_id) throw new Error('That scan is not waiting for a job.');
  const job = await saveToJob(db, filesDir, user, scan, jobId);
  set(db, scanId, { status: 'saved', dismissed: 1 });
  return job;
}

/** Runs a failed scan again. Readings that worked are remembered, so
 *  only what failed is asked again. */
export function retry(db, filesDir, id){
  const r = db.get('select status from scans where id = ?', id);
  if(!r || r.status !== 'failed') throw new Error('Only a scan that failed can be tried again.');
  if(!fs.existsSync(pagesFile(filesDir, id))) throw new Error('The prepared pages are gone; start the scan again from the drawing.');
  set(db, id, { status: 'queued', progress: 'Waiting its turn…', error: null, dismissed: 0 });
  kick(db, filesDir);
}

/** Put away. A scan still waiting is stopped at once; one running stops
 *  after the question it is on. */
export function dismiss(db, filesDir, id){
  const r = db.get('select status from scans where id = ?', id);
  if(!r) return;
  if(r.status === 'queued'){
    set(db, id, { status: 'cancelled', dismissed: 1, progress: '' });
    cleanUp(filesDir, id);
  } else {
    set(db, id, { dismissed: 1, ...(r.status === 'running' ? { progress: 'Stopping…' } : {}) });
    if(r.status !== 'running') cleanUp(filesDir, id);
  }
}

function cleanUp(filesDir, id){
  fs.rmSync(pagesFile(filesDir, id), { force: true });
  fs.rmSync(originalFile(filesDir, id), { force: true });
}

/** Clears finished scans past their time, and any files no scan owns. */
export function pruneScans(db, filesDir){
  const old = new Date(Date.now() - KEEP_MS).toISOString();
  for(const r of db.all(`select id from scans where updated_at < ? and status in ('done','saved','failed','cancelled')`, old)){
    cleanUp(filesDir, r.id);
    db.run('delete from scans where id = ?', r.id);
  }
  let names = [];
  try { names = fs.readdirSync(dirOf(filesDir)); } catch { return; }
  for(const name of names){
    const id = name.split('.')[0];
    if(!db.get('select 1 from scans where id = ?', id)) fs.rmSync(path.join(dirOf(filesDir), name), { force: true });
  }
}

/** At start-up: scans a restart interrupted go back in the queue, old
 *  ones are cleared away, and the queue starts. */
export function resumeScans(db, filesDir){
  db.run(`update scans set status = 'queued', progress = 'Waiting its turn…' where status = 'running'`);
  pruneScans(db, filesDir);
  kick(db, filesDir);
}
