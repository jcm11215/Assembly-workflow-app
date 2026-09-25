// The one-time Supabase import, against a stand-in Supabase that serves
// the old tables, logins and stored files the way the real one does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { openDb } from '../../server/db.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const U = { boss: '00000000-0000-0000-0000-000000000001', dana: '00000000-0000-0000-0000-000000000002', tim: '00000000-0000-0000-0000-000000000003' };
const J1 = '10000000-0000-0000-0000-000000000001';
const BP = '20000000-0000-0000-0000-000000000001';

const TABLES = {
  profiles: [
    { id: U.boss, full_name: 'Justin McKinney', role: 'admin', active: true },
    { id: U.dana, full_name: 'Dana Reyes', role: 'assembler_a', active: true },
    { id: U.tim, full_name: 'Tim Brown', role: 'assembler_b', active: false }
  ],
  jobs: [{ id: J1, job_number: '24-1050', customer: 'Acme', description: 'Screw conveyor', due_date: '2026-10-01', priority: 'High',
           stage: 'layout', percent_complete: 15, assigned_to: U.dana, created_by: U.boss, last_moved_by: U.dana, version: 3,
           created_at: '2026-09-01T12:00:00+00:00', updated_at: '2026-09-10T08:30:00.123456+00:00' }],
  job_checklist: [
    { job_id: J1, step_index: 0, item_index: 0, done: true, done_by: U.dana, done_at: '2026-09-02T10:00:00+00:00' },
    { job_id: J1, step_index: 0, item_index: 1, done: false, done_by: null, done_at: null }
  ],
  blockers: [{ id: '30000000-0000-0000-0000-000000000001', job_id: J1, issue: 'No gearbox', department: 'Purchasing', severity: 'High',
               status: 'Open', reported_by: U.tim, reported_at: '2026-09-05T15:00:00+00:00', resolved_at: null }],
  notes: [{ id: '40000000-0000-0000-0000-000000000001', job_id: null, note_type: 'Issue', body: 'Crane down', author: U.dana,
            note_date: '2026-09-06', created_at: '2026-09-06T09:00:00+00:00' }],
  job_errors: [{ id: '50000000-0000-0000-0000-000000000001', job_id: J1, department: 'engineering', category: 'wrong_dimension',
                 description: 'Bore wrong', found_at_stage: 'layout', rework_hours: '1.50', caused_delay: true, scrapped: false,
                 status: 'Open', correction: null, blocker_id: null, reported_by: U.dana, reported_at: '2026-09-07T11:00:00+00:00', corrected_at: null }],
  blueprints: [{ id: BP, job_id: J1, version: 1, storage_path: `${J1}/1757000000000.pdf`, storage_backend: 'supabase',
                 original_filename: 'GA.pdf', original_mime_type: 'application/pdf', thumbnail_base64: Buffer.from('thumb').toString('base64'),
                 extracted_by: U.boss, extracted_at: '2026-09-01T13:00:00+00:00' }],
  blueprint_components: [{ id: '60000000-0000-0000-0000-000000000001', blueprint_id: BP, item: 'Motor', item_as_drawn: 'GEARMOTOR',
                           specification: '5HP', quantity: 1, stage: 'drive', installation_location: 'drive_end', source_page: 1,
                           source_callout: '', extraction_method: 'bom_table', confidence: '0.90', sort_order: 0, balloon: '3',
                           part_number: 'GM-5', position_x: '0.86000', position_y: '0.42000' }],
  activity_log: [{ id: 1, actor: U.dana, actor_name: 'Dana Reyes', action: 'Stage moved', entity_type: 'job', entity_id: J1,
                   detail: { text: '24-1050: Ready -> Layout' }, at: '2026-09-03T09:00:00+00:00' }],
  signup_codes: [{ code: 'SHOP2026', label: 'Floor', active: true, created_at: '2026-08-01T00:00:00+00:00' }]
  // shop_tasks and shop_task_completions were never created on this project.
};

const LOGINS = [
  { id: U.boss, email: 'justin@iscmfg.com', created_at: '2026-08-01T00:00:00Z' },
  { id: U.dana, email: 'dana@assembly.local', created_at: '2026-08-02T00:00:00Z', last_sign_in_at: '2026-09-10T07:30:00Z' },
  { id: U.tim, email: 'tim@assembly.local', created_at: '2026-08-03T00:00:00Z' }
];

function fakeSupabase(){
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      if(req.headers.authorization !== 'Bearer service-key'){ res.writeHead(401); res.end('{}'); return; }
      const url = new URL(req.url, 'http://x');
      const send = (status, body, type = 'application/json') => { res.writeHead(status, { 'Content-Type': type }); res.end(type === 'application/json' ? JSON.stringify(body) : body); };
      if(url.pathname === '/auth/v1/admin/users') return send(200, { users: url.searchParams.get('page') === '1' ? LOGINS : [] });
      if(url.pathname.startsWith('/storage/v1/object/blueprints/')) {
        return decodeURIComponent(url.pathname).endsWith(TABLES.blueprints[0].storage_path) ? send(200, '%PDF-fake', 'application/pdf') : send(400, { error: 'not found' });
      }
      const name = url.pathname.replace('/rest/v1/', '');
      if(!(name in TABLES)) return send(404, { message: `relation "public.${name}" does not exist` });
      const [from] = String(req.headers.range || '0-999').split('-').map(Number);
      send(200, from === 0 ? TABLES[name] : []);
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

function runImport(env){
  return new Promise(resolve => {
    const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/import-supabase.mjs'], { cwd: ROOT, env: { ...process.env, ...env } });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
    p.on('close', code => resolve({ code, out }));
  });
}

test('the old project is copied across, files and all', async () => {
  const supa = await fakeSupabase();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awt-import-'));
  const env = { DATA_DIR: dataDir, SUPABASE_URL: `http://127.0.0.1:${supa.address().port}`, SUPABASE_SERVICE_ROLE_KEY: 'service-key', SUPABASE_ANON_KEY: 'anon' };
  try {
    const run = await runImport(env);
    assert.equal(run.code, 0, run.out);
    assert.match(run.out, /shop_tasks does not exist/);

    const db = openDb(path.join(dataDir, 'assembly.db'));
    const users = db.all('select login, full_name, role, active, password_hash, legacy_email from users order by login');
    assert.deepEqual(users.map(u => [u.login, u.role, u.active]), [
      ['dana', 'assembler', 1], ['justin@iscmfg.com', 'admin', 1], ['tim', 'trainee', 0]
    ]);
    assert.ok(users.every(u => u.password_hash === null));
    assert.equal(users[0].legacy_email, 'dana@assembly.local');

    const job = db.get('select * from jobs');
    assert.equal(job.stage, 'layout');
    assert.equal(job.assigned_to, U.dana);
    assert.equal(job.updated_at, '2026-09-10T08:30:00.123Z');
    assert.equal(db.all('select * from checklist').length, 1, 'only ticked items come across');
    assert.equal(db.get('select reported_on from blockers').reported_on, '2026-09-05');
    assert.equal(db.get('select rework_hours from job_errors').rework_hours, 1.5);
    assert.equal(db.get('select type from notes').type, 'Issue');

    const bp = db.get('select * from blueprints');
    assert.equal(bp.file_path, '24-1050/GA.pdf');
    assert.equal(fs.readFileSync(path.join(dataDir, 'files', bp.file_path), 'utf8'), '%PDF-fake');
    assert.equal(Buffer.from(bp.thumbnail).toString(), 'thumb');
    const part = db.get('select * from components');
    assert.equal(part.position_x, 0.86);
    assert.equal(part.confidence, 0.9);

    assert.equal(db.get("select actor_id from activity where action = 'Stage moved'").actor_id, U.dana);
    const signIn = db.get("select * from activity where action = 'Signed in'");
    assert.equal(signIn.actor_id, U.dana);
    assert.equal(signIn.at, '2026-09-10T07:30:00.000Z');
    assert.equal(db.get('select code from signup_codes').code, 'SHOP2026');
    assert.deepEqual(JSON.parse(db.get("select value from settings where key = 'legacyAuth'").value).anonKey, 'anon');
    db.close();

    const again = await runImport(env);
    assert.notEqual(again.code, 0, 'a second import into a server with jobs is refused');
    assert.match(again.out, /already has jobs/);
  } finally {
    supa.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('an imported login takes its old password on first sign-in, once', async () => {
  const { startServer } = await import('./harness.mjs');
  const { putSetting } = await import('../../server/db.mjs');
  let checks = 0;
  const oldAuth = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    checks++;
    const { email, password } = JSON.parse(body);
    const ok = req.headers.apikey === 'anon' && email === 'dana@assembly.local' && password === 'old password 1';
    res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  await new Promise(r => oldAuth.listen(0, '127.0.0.1', r));
  const srv = await startServer();
  try {
    srv.db.run(`insert into users (id, login, full_name, role, active, password_hash, legacy_email, created_at, updated_at)
                values ('u-d', 'dana', 'Dana', 'assembler', 1, null, 'dana@assembly.local', 'x', 'x')`);
    putSetting(srv.db, 'legacyAuth', { url: `http://127.0.0.1:${oldAuth.address().port}`, anonKey: 'anon' });
    const c = srv.client();
    assert.equal((await c.post('/api/session', { login: 'dana', password: 'wrong' })).status, 401);
    assert.equal((await c.post('/api/session', { login: 'dana', password: 'old password 1' })).status, 200);
    assert.ok(srv.db.get("select password_hash from users where id = 'u-d'").password_hash);
    const before = checks;
    assert.equal((await srv.client().post('/api/session', { login: 'dana', password: 'old password 1' })).status, 200);
    assert.equal(checks, before, 'after the first sign-in the old project is never asked again');
  } finally {
    await srv.close();
    oldAuth.close();
  }
});
