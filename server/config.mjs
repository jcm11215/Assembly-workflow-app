/**
 * Everything configurable, read once from the environment. The systemd
 * unit (deploy/assembly-workflow.service) sets these; the defaults suit
 * running it by hand from the repo.
 */
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

export const config = {
  root,
  // Loopback by default: `tailscale serve` is what exposes it to the
  // tailnet, with HTTPS and a *.ts.net name. Set HOST=0.0.0.0 only if
  // you mean to serve it on every interface.
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 8080),
  dataDir: path.resolve(process.env.DATA_DIR || path.join(root, 'data')),
  webDir: path.join(root, 'web'),
  sharedDir: path.join(root, 'shared'),
  sessionDays: Number(process.env.SESSION_DAYS || 30),
  backupKeep: Number(process.env.BACKUP_KEEP || 14),
  // Hour of the day (server local time) the nightly backup runs.
  backupHour: Number(process.env.BACKUP_HOUR || 2)
};

export const paths = {
  db: path.join(config.dataDir, 'assembly.db'),
  files: path.join(config.dataDir, 'files'),
  backups: path.join(config.dataDir, 'backups')
};
