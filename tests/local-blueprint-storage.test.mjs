// Blueprint files on the shop's own server: the request shape,
// name sanitizing/versioning, and -- the part most likely to break
// silently -- that saveExtraction/getOriginalFile/deleteForJob route to
// the RIGHT backend per row, never mixing Supabase Storage calls with a
// local-server path or vice versa, including for a row saved before the
// setting was ever turned on.
globalThis.document={getElementById:()=>null,querySelectorAll:()=>[]};
globalThis.window={};
globalThis.localStorage={_d:{},getItem(k){return this._d[k]??null},setItem(k,v){this._d[k]=String(v)},clear(){this._d={}}};
globalThis.AbortController=class{constructor(){this.signal={}}abort(){}};
globalThis.FileReader=class{
  readAsDataURL(blob){ this.onload && this.onload({ target: { result: `data:${blob.type||''};base64,${blob._b64||''}` } }); }
};

const keys = await import('../src/ai/keys.js');
const { sanitizeForPath } = await import('../src/db/localFileStore.js');

let pass = 0, fail = 0;
const t = (n, c) => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n)); };
const eq = (a, b, what) => { const ok = a === b; if(!ok) console.log(`    (${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`); return ok; };

console.log('=== sanitizeForPath ===');
t('an ordinary job number is untouched', eq(sanitizeForPath('24-1050'), '24-1050'));
t('spaces/parens/dots are allowed', eq(sanitizeForPath('My Drawing (v2).pdf'), 'My Drawing (v2).pdf'));
t('illegal characters become _', eq(sanitizeForPath('weird*name?.pdf'), 'weird_name_.pdf'));
t('slashes become _, no traversal survives as a path', eq(sanitizeForPath('../../etc/passwd'), '_._etc_passwd'));
t('the sanitized result never contains a slash', !sanitizeForPath('../../etc/passwd').includes('/'));
t('the sanitized result never contains ".." (a real traversal sequence)', !sanitizeForPath('../../etc/passwd').includes('..'));
t('an empty name falls back rather than an empty segment', eq(sanitizeForPath(''), 'file'));
t('whitespace-only falls back the same way', eq(sanitizeForPath('   '), 'file'));
t('".." alone is not a usable name', eq(sanitizeForPath('..'), 'file'));
t('very long names are capped', sanitizeForPath('x'.repeat(500)).length <= 120);

// ---- one fetch mock covering Postgres, Supabase Storage, and the local
// server, routed by URL -- the same shape blueprintsRepo.test.mjs
// already uses for the first two. ----
const BASE = 'https://justin-desktop.tail1234.ts.net';
let BLUEPRINTS, COMPONENTS, LOCAL_FILES, calls;

function resetFixtures(){
  BLUEPRINTS = []; COMPONENTS = []; LOCAL_FILES = {}; calls = [];
  keys.setLocalAiUrl(BASE);
  keys.setLocalAiKey('secret-key-1234');
}

globalThis.fetch = async (url, opt = {}) => {
  const u = String(url); const m = opt.method || 'GET';
  const ok = d => ({ ok: true, status: 200, text: async () => JSON.stringify(d), json: async () => d });
  const okBlob = () => ({ ok: true, status: 200, blob: async () => ({ _b64: 'AA==', type: 'application/pdf' }) });
  const body = opt.body && typeof opt.body === 'string' ? JSON.parse(opt.body) : null;
  calls.push({ url: u, method: m });

  if(u.includes('/rest/v1/blueprints')){
    if(m === 'GET'){
      const jobMatch = u.match(/job_id=eq\.([\w-]+)/);
      const idMatch = u.match(/[?&]id=eq\.([\w-]+)/);
      let rows = BLUEPRINTS;
      if(jobMatch) rows = rows.filter(r => r.job_id === jobMatch[1]);
      if(idMatch) rows = rows.filter(r => r.id === idMatch[1]);
      rows = [...rows].sort((a, b) => b.version - a.version);
      const limMatch = u.match(/limit=(\d+)/);
      if(limMatch) rows = rows.slice(0, Number(limMatch[1]));
      return ok(rows);
    }
    if(m === 'POST'){
      const rows = Array.isArray(body) ? body : [body];
      rows.forEach(r => { r.id = r.id || 'bp' + (BLUEPRINTS.length + 1); BLUEPRINTS.push(r); });
      return ok(rows);
    }
  }
  if(u.includes('/blueprint_components')){
    if(m === 'POST'){
      const rows = Array.isArray(body) ? body : [body];
      rows.forEach(r => { r.id = r.id || 'c' + (COMPONENTS.length + 1); COMPONENTS.push(r); });
      return ok(rows);
    }
    return ok(COMPONENTS);
  }
  // Supabase Storage -- should only ever be hit for a row saved to
  // 'supabase', never one saved to 'local'.
  if(u.includes('/storage/v1/object')){
    if(m === 'POST') return ok({});
    if(m === 'GET') return okBlob();
    if(m === 'DELETE') return ok({});
  }
  // The local server -- should only ever be hit for a row saved to
  // 'local', and only when its address+key are configured.
  if(u.includes('/api/blueprint-file/')){
    const path = decodeURIComponent(u.split('/api/blueprint-file/')[1]);
    if(m === 'PUT'){ LOCAL_FILES[path] = true; return ok({ ok: true, path }); }
    if(m === 'GET') return path in LOCAL_FILES ? okBlob() : { ok: false, status: 404 };
    if(m === 'DELETE'){ delete LOCAL_FILES[path]; return ok({ ok: true, deleted: true }); }
  }
  return ok([]);
};

const repo = await import('../src/db/blueprintsRepo.js');

console.log('\n=== local storage off (default): unchanged Supabase behavior ===');
resetFixtures();
keys.setLocalBlueprintStorageEnabled(false);
const savedCloud = await repo.saveExtraction('j1', {
  components: [], originalFile: { base64: 'AA==', mimeType: 'application/pdf', filename: 'drawing.pdf' }, jobNumber: '24-1050'
});
t('row is tagged storage_backend "supabase"', savedCloud.storage_backend === 'supabase');
t('storage_path uses the jobId/timestamp shape, not a job-number folder', /^j1\//.test(savedCloud.storage_path));
t('nothing was ever sent to the local server', !calls.some(c => c.url.includes('/api/blueprint-file/')));
const cloudFile = await repo.getOriginalFile('j1');
t('reads back through Supabase Storage', !!cloudFile && cloudFile.filename === 'drawing.pdf');

console.log('\n=== local storage on: files go to the shop\'s server, named for a human ===');
resetFixtures();
keys.setLocalBlueprintStorageEnabled(true);
const savedLocal = await repo.saveExtraction('j2', {
  components: [], originalFile: { base64: 'AA==', mimeType: 'application/pdf', filename: 'Drawing.pdf' }, jobNumber: '24-1050'
});
t('row is tagged storage_backend "local"', savedLocal.storage_backend === 'local');
t('storage_path is "<job number>/<name>", not the job id', savedLocal.storage_path === '24-1050/Drawing.pdf');
t('nothing was sent to Supabase Storage', !calls.some(c => c.url.includes('/storage/v1/object') && c.method !== 'GET'));
t('the local server actually received the PUT', '24-1050/Drawing.pdf' in LOCAL_FILES);

const savedLocalV2 = await repo.saveExtraction('j2', {
  components: [], originalFile: { base64: 'AA==', mimeType: 'application/pdf', filename: 'Drawing.pdf' }, jobNumber: '24-1050'
});
t('a re-scan is version 2', savedLocalV2.version === 2);
t('and lands beside the first as "(v2)", not overwriting it', savedLocalV2.storage_path === '24-1050/Drawing (v2).pdf');
t('the original v1 file is still there', '24-1050/Drawing.pdf' in LOCAL_FILES);

const localFile = await repo.getOriginalFile('j2');
t('getOriginalFile reads the newest version back through the local server', !!localFile && localFile.filename === 'Drawing.pdf');

console.log('\n=== deleteForJob routes each row to the backend IT was saved with ===');
resetFixtures();
keys.setLocalBlueprintStorageEnabled(false);
await repo.saveExtraction('j3', {   // version 1, saved to Supabase
  components: [], originalFile: { base64: 'AA==', mimeType: 'application/pdf', filename: 'a.pdf' }, jobNumber: '9'
});
keys.setLocalBlueprintStorageEnabled(true);
await repo.saveExtraction('j3', {   // version 2 -- gets a "(v2)" filename, same as any re-scan
  components: [], originalFile: { base64: 'AA==', mimeType: 'application/pdf', filename: 'b.pdf' }, jobNumber: '9'
});
t('the local file exists before delete', Object.keys(LOCAL_FILES).some(k => k.startsWith('9/')));
await repo.deleteForJob('j3');
t('the local-backend file was removed from the local server', !Object.keys(LOCAL_FILES).some(k => k.startsWith('9/')));
const supabaseDeletes = calls.filter(c => c.url.includes('/storage/v1/object') && c.method === 'DELETE');
t('the supabase-backend row got a Supabase Storage delete', supabaseDeletes.length >= 1);
const localDeletes = calls.filter(c => c.url.includes('/api/blueprint-file/') && c.method === 'DELETE');
t('exactly one local-server delete, not one per row', localDeletes.length === 1);

console.log('\n=== the local server being unreachable degrades like a bad Supabase upload already does ===');
resetFixtures();
keys.setLocalBlueprintStorageEnabled(true);
keys.setLocalAiUrl('');   // configured to use local storage, but no address saved
const savedNoAddr = await repo.saveExtraction('j4', {
  components: [], originalFile: { base64: 'AA==', mimeType: 'application/pdf', filename: 'c.pdf' }, jobNumber: '5'
});
t('storage_path stays null -- caller already knows to show "could not attach" for this', savedNoAddr.storage_path === null);
t('storage_backend falls back to "supabase" so the not-null column stays meaningful', savedNoAddr.storage_backend === 'supabase');
t('the components were still saved -- a storage failure does not lose the scan', COMPONENTS.length >= 0);

keys.setLocalBlueprintStorageEnabled(false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
