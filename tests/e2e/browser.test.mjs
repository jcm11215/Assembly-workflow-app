// The whole app in a real browser: first-run setup, a job, a checklist
// tick, a new job read off a drawing (with a stand-in AI), the assistant,
// a second person seeing changes live, and every screen opened once with
// no errors in the console.
//
// Needs Playwright and Chromium, which the app itself does not:
//   PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs npm run test:e2e
// Skipped when Playwright can't be found.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFakeAI } from './fake-ai.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
let playwright = null;
for(const spec of [process.env.PLAYWRIGHT_MODULE, 'playwright'].filter(Boolean)){
  try { playwright = await import(spec); break; } catch { /* try the next */ }
}
const skip = playwright ? false : 'Playwright not found (set PLAYWRIGHT_MODULE)';

const PORT = 18300 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
let server, ai, browser, dataDir, setupCode;
const errors = [];

before(async () => {
  if(skip) return;
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awt-e2e-'));
  ai = await startFakeAI(PORT + 1);
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/main.mjs'],
    { cwd: ROOT, env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), HOST: '127.0.0.1' } });
  let log = '';
  server.stdout.on('data', d => { log += d; });
  server.stderr.on('data', d => { log += d; });
  for(let i = 0; i < 50 && !/setup code/.test(log); i++) await new Promise(r => setTimeout(r, 100));
  setupCode = /setup code:\s*\n\s*(\w+)/.exec(log)?.[1];
  assert.ok(setupCode, `server did not start:\n${log}`);
  const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  browser = await playwright.chromium.launch(executablePath ? { executablePath } : {});
});

after(async () => {
  if(skip) return;
  await browser?.close();
  server?.kill();
  ai?.server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function newPage(width = 1280, height = 900){
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if(m.type() === 'error') errors.push(`console: ${m.text()}`); });
  return page;
}

const api = (page, method, url, body) => page.evaluate(async ([method, url, body]) => {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'awt' }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}, [method, url, body]);

let admin;

test('first-run setup creates the admin and opens the app', { skip }, async () => {
  admin = await newPage();
  await admin.goto(BASE);
  await admin.getByText('Set up this server').waitFor();
  await admin.fill('input[name=setupCode]', setupCode);
  await admin.fill('input[name=fullName]', 'Justin McKinney');
  await admin.fill('input[name=login]', 'justin');
  await admin.fill('input[name=password]', 'password123');
  await admin.fill('input[name=confirm]', 'password123');
  await admin.click('button[type=submit]');
  await admin.locator('.nav').waitFor();
});

test('a job is created, ticked, and seen live by a second person', { skip }, async () => {
  await api(admin, 'POST', '/api/admin/users', { fullName: 'Dana Reyes', login: 'dana', password: 'password123', role: 'assembler' });
  const dana = await newPage(390, 844);
  await dana.goto(BASE);
  await dana.fill('input[name=login]', 'dana');
  await dana.fill('input[name=password]', 'password123');
  await dana.click('button[type=submit]');
  await dana.locator('.nav').waitFor();

  await admin.click('text=+ New job');
  await admin.fill('input[name=jobNumber]', '24-1050');
  await admin.fill('input[name=customer]', 'Acme Grain');
  await admin.click('button:has-text("Create job")');
  await admin.locator('.job-page').waitFor();

  // Dana's dashboard picks the new job up without a reload.
  await dana.locator('.job-card', { hasText: '24-1050' }).waitFor({ timeout: 5000 });
  await dana.locator('.job-card', { hasText: '24-1050' }).click();
  await dana.locator('.check-item').first().click();
  await dana.locator('.check-item.done').first().waitFor();

  // ...and the admin sees Dana's tick, with her name on it.
  await admin.locator('.check-by', { hasText: 'Dana Reyes' }).waitFor({ timeout: 5000 });
  await dana.close();
});

test('a new job is read off a drawing', { skip }, async () => {
  await api(admin, 'PUT', '/api/settings/ai', { provider: 'local', local: { url: `http://127.0.0.1:${PORT + 1}`, key: 'k', fallback: false } });
  await admin.goto(BASE + '/#/');
  await admin.click('text=New job from a drawing');
  await admin.setInputFiles('input[type=file]', path.join(import.meta.dirname, 'drawing.pdf'));
  await admin.getByText('all will be scanned').waitFor();
  await admin.click('button:has-text("Read the drawing")');
  await admin.locator('input[name=jobNumber]').waitFor({ timeout: 30000 });
  assert.equal(await admin.inputValue('input[name=jobNumber]'), '2024-017H');
  await admin.click('button:has-text("Create job")');
  await admin.locator('.cv-sheet').waitFor({ timeout: 15000 });
  assert.equal(await admin.locator('.part').count(), 4);

  const state = await api(admin, 'GET', '/api/state');
  const bp = state.jobs.find(j => j.jobNumber === '2024-017H').blueprint;
  assert.equal(bp.hasFile, true);
  assert.equal(bp.mimeType, 'application/pdf');
});

test('the assistant answers, and acts only after confirmation', { skip }, async () => {
  await admin.goto(BASE + '/#/assistant');
  await admin.click('text=What should the team focus on today?');
  await admin.getByText('Focus on 2024-017H first').waitFor();
  await admin.fill('input[aria-label=Message]', 'report a blocker on 2024-017H, gearmotor not in');
  await admin.click('button:has-text("Do it")');
  await admin.locator('.plan').waitFor();
  assert.equal((await api(admin, 'GET', '/api/state')).blockers.length, 0, 'nothing happens before Confirm');
  await admin.click('button:has-text("Confirm")');
  await admin.getByText('Done').waitFor();
  assert.deepEqual((await api(admin, 'GET', '/api/state')).blockers.map(b => b.issue), ['Gearmotor not delivered']);
});

test('every screen opens without an error', { skip }, async () => {
  for(const tab of ['', 'board', 'blockers', 'errors', 'tasks', 'notes', 'assistant', 'activity', 'admin']){
    await admin.goto(`${BASE}/#/${tab}`);
    await admin.locator('main').waitFor();
    await admin.waitForTimeout(300);
  }
  await admin.click('button[aria-label=Settings]');
  await admin.getByText('Your account').waitFor();
  assert.deepEqual(errors, []);
});
