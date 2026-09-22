/**
 * Nightly database backups: a consistent copy of the SQLite file via
 * `VACUUM INTO`, which is safe while the app is running. The newest
 * BACKUP_KEEP copies are kept in data/backups/.
 *
 * Blueprint files (data/files/) are never rewritten once saved, so they
 * need no snapshot of their own -- copy that folder off the machine with
 * whatever you already use (rsync, a USB drive). See docs/OPERATIONS.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config, paths } from './config.mjs';
import { toISODate } from '../shared/dates.js';

export function backupNow(db, dir = paths.backups){
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(dir, `assembly-${stamp}.db`);
  db.raw.exec(`vacuum into '${file.replace(/'/g, "''")}'`);
  prune(dir);
  return file;
}

function prune(dir){
  const old = listBackups(dir).slice(config.backupKeep);
  for(const b of old){
    try { fs.unlinkSync(path.join(dir, b.name)); } catch { /* already gone */ }
  }
}

export function listBackups(dir = paths.backups){
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names
    .filter(n => /^assembly-.*\.db$/.test(n))
    .map(name => {
      const st = fs.statSync(path.join(dir, name));
      return { name, bytes: st.size, at: st.mtime.toISOString() };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** Checks hourly; takes one backup per day once the backup hour has
 *  passed. Hourly rather than a timer for 2am, so a server that was off
 *  overnight still backs up when it comes back. */
export function scheduleBackups(db){
  const tick = () => {
    const today = toISODate(new Date());
    const doneToday = listBackups().some(b => toISODate(new Date(b.at)) === today);
    if(!doneToday && new Date().getHours() >= config.backupHour){
      try { console.log(`backup written: ${backupNow(db)}`); }
      catch (e) { console.error('nightly backup failed', e); }
    }
  };
  tick();
  return setInterval(tick, 3600000);
}
