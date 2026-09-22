/**
 * One-time move from the old Supabase project to this server.
 *
 *   SUPABASE_URL=https://<project>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service role key> \
 *   SUPABASE_ANON_KEY=<publishable key> \
 *   node server/import-supabase.mjs [--local-files <dir>] [--dry-run]
 *
 * Copies every table the app used, the logins, and the blueprint files
 * (from Supabase Storage, and -- with --local-files -- the folder the old
 * shop-server setting saved them to). Run it once, into an empty server;
 * it refuses to import on top of existing jobs.
 *
 * Passwords: Supabase never hands out password hashes, so imported
 * logins arrive without one. With SUPABASE_ANON_KEY set, each person's
 * first sign-in here is checked against the old project and, if right,
 * becomes their password here (see legacyAuth.mjs). Otherwise an admin
 * sets passwords with `node server/cli.mjs set-password <login>`.
 *
 * Roles: admin and lead become admin; assembler and assembler_a become
 * Assembler A; assembler_b becomes Assembler B (trainee).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { paths } from './config.mjs';
import { openDb, putSetting } from './db.mjs';
import { relativePathFor, writeFileAtomic } from './files.mjs';

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const LOCAL_FILES = argv.includes('--local-files') ? argv[argv.indexOf('--local-files') + 1] : null;
const URL_BASE = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
const warnings = [];
const warn = msg => { warnings.push(msg); console.warn(`  ! ${msg}`); };

/* ---------------- reading the old project ---------------- */

/** Every row of a table, a page at a time. A table the old project never
 *  created (an optional phase not run) reads as empty. */
async function table(name){
  const rows = [];
  const PAGE = 1000;
  for(let from = 0; ; from += PAGE){
    const res = await fetch(`${URL_BASE}/rest/v1/${name}?select=*`, {
      headers: { ...headers, Range: `${from}-${from + PAGE - 1}`, 'Range-Unit': 'items' }
    });
    if(res.status === 404 || res.status === 400){
      const body = await res.text();
      if(/does not exist|Could not find the table/i.test(body)){ warn(`table ${name} does not exist in the old project -- skipped`); return []; }
      throw new Error(`Reading ${name} failed (${res.status}): ${body}`);
    }
    if(!res.ok) throw new Error(`Reading ${name} failed (${res.status}): ${await res.text()}`);
    const page = await res.json();
    rows.push(...page);
    if(page.length < PAGE) return rows;
  }
}

async function authUsers(){
  const users = [];
  for(let page = 1; ; page++){
    const res = await fetch(`${URL_BASE}/auth/v1/admin/users?page=${page}&per_page=500`, { headers });
    if(!res.ok) throw new Error(`Reading logins failed (${res.status}): ${await res.text()}`);
    const body = await res.json();
    const list = Array.isArray(body) ? body : (body.users || []);
    users.push(...list);
    if(list.length < 500) return users;
  }
}

async function storageFile(storagePath){
  const encoded = storagePath.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(`${URL_BASE}/storage/v1/object/blueprints/${encoded}`, { headers });
  if(res.status === 404 || res.status === 400) return null;
  if(!res.ok) throw new Error(`Downloading ${storagePath} failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

async function localFile(storagePath){
  if(!LOCAL_FILES) return null;
  const abs = path.resolve(LOCAL_FILES, storagePath);
  if(!abs.startsWith(path.resolve(LOCAL_FILES) + path.sep)) return null;
  try { return await fs.readFile(abs); } catch { return null; }
}

/* ---------------- mapping ---------------- */

const ROLE = { admin: 'admin', lead: 'admin', assembler: 'assembler', assembler_a: 'assembler', assembler_b: 'trainee' };
const ts = v => (v ? new Date(v).toISOString() : null);
const dateOnly = v => (v ? String(v).slice(0, 10) : null);
const bool = v => (v ? 1 : 0);

/** "dana@assembly.local" -> "dana"; a real email stays an email. */
export function loginFor(email){
  const e = String(email || '').trim().toLowerCase();
  return e.endsWith('@assembly.local') ? e.slice(0, -'@assembly.local'.length) : e;
}

/* ---------------- the import ---------------- */

async function main(){
  if(!URL_BASE || !SERVICE_KEY){
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. See docs/MIGRATING.md.');
    process.exit(1);
  }
  const db = openDb(paths.db);
  if(db.get('select count(*) as n from jobs').n > 0 && !DRY_RUN){
    console.error('This server already has jobs. The import only runs into an empty server -- see docs/MIGRATING.md.');
    process.exit(1);
  }

  console.log(`Reading ${URL_BASE} …`);
  const [logins, profiles, jobs, checklist, blockers, notes, errors, tasks, completions, blueprints, components, activity, codes] =
    await Promise.all([authUsers(), table('profiles'), table('jobs'), table('job_checklist'), table('blockers'), table('notes'),
      table('job_errors'), table('shop_tasks'), table('shop_task_completions'), table('blueprints'),
      table('blueprint_components'), table('activity_log'), table('signup_codes')]);

  // People: a login joined to its profile. The login is the key -- a
  // profile with no login could never sign in, so it is not brought over.
  const profileById = new Map(profiles.map(p => [p.id, p]));
  const taken = new Set();
  const users = [];
  for(const u of logins){
    const p = profileById.get(u.id);
    let login = loginFor(u.email) || `user-${u.id.slice(0, 8)}`;
    while(taken.has(login)) login = `${login}-2`;
    taken.add(login);
    users.push({
      id: u.id, login, legacyEmail: String(u.email || '').toLowerCase(),
      fullName: (p && p.full_name) || (u.user_metadata && u.user_metadata.full_name) || login,
      role: ROLE[p && p.role] || 'trainee',
      active: p ? p.active !== false : true,
      createdAt: ts(u.created_at) || new Date().toISOString(),
      updatedAt: ts((p && p.updated_at) || u.updated_at) || new Date().toISOString()
    });
  }
  const userIds = new Set(users.map(u => u.id));
  const person = id => (id && userIds.has(id) ? id : null);
  const jobById = new Map(jobs.map(j => [j.id, j]));
  const jobIds = new Set(jobs.map(j => j.id));

  // Latest blueprint versions only need files for what is shown, but every
  // version's file is kept -- a re-scan never deleted the old one before.
  console.log('Fetching blueprint files …');
  const files = new Map();   // blueprint id -> { bytes, rel }
  for(const b of blueprints){
    if(!b.storage_path || !jobIds.has(b.job_id)) continue;
    const bytes = b.storage_backend === 'local' ? await localFile(b.storage_path) : await storageFile(b.storage_path);
    if(!bytes){
      warn(`${jobById.get(b.job_id).job_number} scan v${b.version}: file ${b.storage_path} not found` +
        (b.storage_backend === 'local' && !LOCAL_FILES ? ' (it was saved to the shop server -- pass --local-files <that folder>)' : ''));
      continue;
    }
    const mime = b.original_mime_type || 'application/octet-stream';
    files.set(b.id, { bytes, mime, rel: relativePathFor(jobById.get(b.job_id).job_number, b.original_filename || path.basename(b.storage_path), mime, b.version || 1) });
  }

  const summary = {
    logins: users.length, jobs: jobs.length, checklistTicks: checklist.filter(c => c.done && jobIds.has(c.job_id)).length,
    blockers: blockers.length, notes: notes.length, errors: errors.length, tasks: tasks.length, taskTicks: completions.length,
    scans: blueprints.filter(b => jobIds.has(b.job_id)).length, scanFiles: files.size, parts: components.length,
    activity: activity.length, accessCodes: codes.length
  };
  console.log('Found:', summary);
  if(DRY_RUN){ console.log('Dry run -- nothing written.'); db.close(); return; }

  for(const { bytes, rel } of files.values()) await writeFileAtomic(paths.files, rel, bytes);

  db.tx(() => {
    for(const u of users){
      db.run(`insert into users (id, login, full_name, role, active, password_hash, legacy_email, created_at, updated_at)
              values (?, ?, ?, ?, ?, null, ?, ?, ?)`, u.id, u.login, u.fullName, u.role, bool(u.active), u.legacyEmail, u.createdAt, u.updatedAt);
    }
    for(const j of jobs){
      db.run(`insert into jobs (id, job_number, customer, description, due_date, priority, stage, percent_complete, assigned_to,
                created_by, last_moved_by, version, rev, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        j.id, j.job_number, j.customer || '', j.description || '', dateOnly(j.due_date), j.priority || 'Medium', j.stage || 'ready',
        j.percent_complete || 0, person(j.assigned_to), person(j.created_by), person(j.last_moved_by), j.version || 1,
        ts(j.created_at), ts(j.updated_at || j.created_at));
    }
    for(const c of checklist){
      if(!c.done || !jobIds.has(c.job_id)) continue;
      db.run(`insert or ignore into checklist (job_id, step, item, done_by, done_at) values (?, ?, ?, ?, ?)`,
        c.job_id, c.step_index, c.item_index, person(c.done_by), ts(c.done_at) || new Date().toISOString());
    }
    for(const b of blockers){
      if(!jobIds.has(b.job_id)) continue;
      db.run(`insert into blockers (id, job_id, issue, department, severity, status, reported_by, reported_on, created_at, resolved_by, resolved_at)
              values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        b.id, b.job_id, b.issue, b.department || '', b.severity || 'Medium', b.status || 'Open', person(b.reported_by),
        dateOnly(b.reported_at) || dateOnly(new Date().toISOString()), ts(b.reported_at) || new Date().toISOString(),
        person(b.resolved_by), ts(b.resolved_at));
    }
    for(const n of notes){
      if(n.job_id && !jobIds.has(n.job_id)) continue;
      db.run(`insert into notes (id, job_id, type, body, author, note_date, created_at) values (?, ?, ?, ?, ?, ?, ?)`,
        n.id, n.job_id || null, n.note_type || 'Progress', n.body, person(n.author), dateOnly(n.note_date || n.created_at), ts(n.created_at));
    }
    const blockerIds = new Set(blockers.map(b => b.id));
    for(const e of errors){
      if(!jobIds.has(e.job_id)) continue;
      db.run(`insert into job_errors (id, job_id, department, category, description, found_at_stage, rework_hours, caused_delay, scrapped,
                status, correction, blocker_id, reported_by, reported_at, corrected_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        e.id, e.job_id, e.department, e.category || 'other', e.description, e.found_at_stage || 'unknown',
        e.rework_hours == null ? null : Number(e.rework_hours), bool(e.caused_delay), bool(e.scrapped), e.status || 'Open',
        e.correction || null, blockerIds.has(e.blocker_id) ? e.blocker_id : null, person(e.reported_by), ts(e.reported_at), ts(e.corrected_at));
    }
    const taskIds = new Set();
    for(const t of tasks){
      if(t.job_id && !jobIds.has(t.job_id)) continue;
      taskIds.add(t.id);
      db.run(`insert into tasks (id, title, details, job_id, assigned_to, recurrence, due_date, weekday, starts_on, active, created_by, created_at)
              values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        t.id, t.title, t.details || '', t.job_id || null, person(t.assigned_to), t.recurrence || 'none', dateOnly(t.due_date),
        t.weekday ?? null, dateOnly(t.starts_on), bool(t.active !== false), person(t.created_by), ts(t.created_at));
    }
    for(const c of completions){
      if(!taskIds.has(c.task_id)) continue;
      db.run(`insert or ignore into task_completions (task_id, due_on, done_by, done_at) values (?, ?, ?, ?)`,
        c.task_id, dateOnly(c.due_on), person(c.done_by), ts(c.done_at));
    }
    const bpIds = new Set();
    for(const b of blueprints){
      if(!jobIds.has(b.job_id)) continue;
      bpIds.add(b.id);
      const f = files.get(b.id);
      db.run(`insert into blueprints (id, job_id, version, file_path, original_filename, mime_type, thumbnail, extracted_by, extracted_at)
              values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        b.id, b.job_id, b.version || 1, f ? f.rel : null, b.original_filename || null, (f && f.mime) || b.original_mime_type || null,
        b.thumbnail_base64 ? Buffer.from(b.thumbnail_base64, 'base64') : null, person(b.extracted_by), ts(b.extracted_at));
    }
    for(const c of components){
      if(!bpIds.has(c.blueprint_id)) continue;
      db.run(`insert into components (id, blueprint_id, sort_order, item, item_as_drawn, specification, quantity, stage, installation_location,
                source_page, source_callout, extraction_method, confidence, balloon, part_number, position_x, position_y)
              values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        c.id, c.blueprint_id, c.sort_order || 0, c.item, c.item_as_drawn || '', c.specification || '',
        c.quantity == null ? null : Number(c.quantity), c.stage || 'other', c.installation_location || 'unknown',
        c.source_page ?? null, c.source_callout || '', c.extraction_method || 'inferred',
        c.confidence == null ? null : Number(c.confidence), c.balloon ?? null, c.part_number || '',
        c.position_x == null ? null : Number(c.position_x), c.position_y == null ? null : Number(c.position_y));
    }
    for(const a of [...activity].sort((x, y) => String(x.at).localeCompare(String(y.at)))){
      db.run(`insert into activity (actor_id, actor_name, action, entity_type, entity_id, detail, at) values (?, ?, ?, ?, ?, ?, ?)`,
        person(a.actor), a.actor_name || 'Unknown', a.action, a.entity_type || null, a.entity_id || null,
        JSON.stringify(a.detail && typeof a.detail === 'object' ? a.detail : { text: String(a.detail || '') }), ts(a.at));
    }
    for(const c of codes){
      db.run('insert or ignore into signup_codes (code, label, active, created_at) values (?, ?, ?, ?)',
        c.code, c.label || '', bool(c.active !== false), ts(c.created_at) || new Date().toISOString());
    }
    if(ANON_KEY) putSetting(db, 'legacyAuth', { url: URL_BASE, anonKey: ANON_KEY });
  });

  db.close();
  console.log('\nImported:', summary);
  console.log(ANON_KEY
    ? '\nPasswords: each person\'s first sign-in is checked against the old project and becomes their password here.'
    : '\nPasswords: none carried over. Set them with: node server/cli.mjs set-password <login>');
  console.log('AI keys were stored per device in the old app; an admin enters them once in Settings.');
  if(warnings.length) console.log(`\n${warnings.length} warning(s) above.`);
}

if(import.meta.url === `file://${process.argv[1]}`){
  main().catch(e => { console.error(`Import failed: ${e.message}`); process.exit(1); });
}
