/**
 * Runs the real server against an in-memory database on a spare port,
 * with a small client per signed-in person (each keeps its own cookie).
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../../server/db.mjs';
import { createApp } from '../../server/app.mjs';
import { insertUser } from '../../server/routes/session.mjs';
import { closeAll } from '../../server/live.mjs';

export async function startServer(){
  const db = openDb(':memory:');
  const filesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awt-files-'));
  const server = http.createServer(createApp({ db, filesDir }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;

  async function user(login, role, fullName = login){
    const password = 'correct horse battery';
    await insertUser(db, { login, fullName, password, role });
    const c = client(url);
    await c.post('/api/session', { login, password });
    return c;
  }

  return {
    url, db, filesDir, user,
    client: () => client(url),
    async close(){
      closeAll();
      server.closeAllConnections();
      await new Promise(r => server.close(r));
      db.close();
      fs.rmSync(filesDir, { recursive: true, force: true });
    }
  };
}

export function client(base){
  let cookie = '';
  async function call(method, p, body, headers = {}){
    const isRaw = body instanceof Uint8Array;
    const res = await fetch(base + p, {
      method,
      headers: {
        ...(body !== undefined && !isRaw ? { 'Content-Type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'X-Requested-With': 'awt' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers
      },
      body: body === undefined ? undefined : isRaw ? body : JSON.stringify(body)
    });
    const set = res.headers.get('set-cookie');
    if(set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  }
  return {
    get: (p, h) => call('GET', p, undefined, h),
    post: (p, b, h) => call('POST', p, b, h),
    put: (p, b, h) => call('PUT', p, b, h),
    patch: (p, b, h) => call('PATCH', p, b, h),
    delete: (p, h) => call('DELETE', p, undefined, h),
    raw: call,
    cookie: () => cookie
  };
}
