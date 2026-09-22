/**
 * Starts the Assembly Workflow server:
 *
 *   node server/main.mjs
 *
 * Settings come from the environment -- see config.mjs and
 * deploy/assembly-workflow.service.
 */
import http from 'node:http';
import fs from 'node:fs';
import { config, paths } from './config.mjs';
import { openDb } from './db.mjs';
import { createApp } from './app.mjs';
import { pruneSessions, setupCodeIfNeeded } from './auth.mjs';
import { scheduleBackups } from './backup.mjs';
import { closeAll } from './live.mjs';

const [major, minor] = process.versions.node.split('.').map(Number);
if(major < 22 || (major === 22 && minor < 13)){
  console.error(`Node.js 22.13 or newer is required (this is ${process.version}).`);
  process.exit(1);
}

fs.mkdirSync(paths.files, { recursive: true });
const db = openDb(paths.db);
const handler = createApp({ db, filesDir: paths.files });
const server = http.createServer(handler);

server.listen(config.port, config.host, () => {
  console.log(`Assembly Workflow listening on http://${config.host}:${config.port} (data: ${config.dataDir})`);
  const code = setupCodeIfNeeded(db);
  if(code){
    console.log('');
    console.log('  No accounts yet. Open the app and create the first admin with this setup code:');
    console.log(`      ${code}`);
    console.log('  (or run: node server/cli.mjs create-admin)');
    console.log('');
  }
});

const timers = [
  scheduleBackups(db),
  setInterval(() => pruneSessions(db), 6 * 3600000)
];

function shutdown(signal){
  console.log(`${signal} received, shutting down`);
  timers.forEach(clearInterval);
  closeAll();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  // Don't hang on a slow client.
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
