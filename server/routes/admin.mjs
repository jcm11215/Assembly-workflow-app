/**
 * Admin: the team (logins, roles, switching people off, resetting
 * passwords), shop access codes for self sign-up, and a health summary.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { badRequest, conflict, notFound } from '../http.mjs';
import { now } from '../db.mjs';
import { listTeam, toUser } from '../records.mjs';
import { hashPassword, passwordProblem, endAllSessions } from '../auth.mjs';
import { broadcast, disconnectUser, updateUser, connectionCount } from '../live.mjs';
import { ROLES, roleLabel } from '../../shared/roles.js';
import { newAccountFields, insertUser } from './session.mjs';
import { config, paths } from '../config.mjs';
import { listBackups } from '../backup.mjs';
import * as v from '../validate.mjs';

const pushTeamMember = (db, id) => {
  const u = toUser(db.get('select * from users where id = ?', id));
  broadcast('user', { id: u.id, fullName: u.fullName, role: u.role, active: u.active });
  return u;
};

function loadUser(db, id){
  const row = db.get('select * from users where id = ?', id);
  if(!row) throw notFound('That person');
  return row;
}

/** Refuses a change that would leave nobody able to run the app. */
function keepAnAdmin(db, userId, nextRole, nextActive){
  const row = loadUser(db, userId);
  const losingAdmin = row.role === 'admin' && row.active && (nextRole !== 'admin' || !nextActive);
  if(!losingAdmin) return;
  const { n } = db.get("select count(*) as n from users where role = 'admin' and active = 1 and id != ?", userId);
  if(n === 0) throw conflict('That would leave no active admin. Make someone else an admin first.', 'last_admin');
}

function dirSize(dir){
  let total = 0;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for(const e of entries){
    const p = path.join(dir, e.name);
    if(e.isDirectory()) total += dirSize(p);
    else { try { total += fs.statSync(p).size; } catch { /* vanished */ } }
  }
  return total;
}

export default function register(r){

  r.get('/api/admin/users', ctx => {
    const hasPassword = new Set(ctx.db.all('select id from users where password_hash is not null').map(r => r.id));
    return { users: listTeam(ctx.db).map(u => ({ ...u, hasPassword: hasPassword.has(u.id) })) };
  }, { perm: 'team.manage' });

  r.post('/api/admin/users', async ctx => {
    const body = await ctx.json();
    const fields = newAccountFields(body);
    const role = v.oneOf(body.role || 'trainee', ROLES, 'Role');
    const user = await insertUser(ctx.db, { ...fields, role });
    ctx.log('Login created', { text: `${user.fullName} (${user.login}) as ${roleLabel(role)}` }, { type: 'user', id: user.id });
    pushTeamMember(ctx.db, user.id);
    ctx.status = 201;
    return { user };
  }, { perm: 'team.manage' });

  r.patch('/api/admin/users/:id', async ctx => {
    const row = loadUser(ctx.db, ctx.params.id);
    const body = await ctx.json();
    const role = 'role' in body ? v.oneOf(body.role, ROLES, 'Role') : row.role;
    const active = 'active' in body ? v.bool(body.active) : !!row.active;
    const fullName = 'fullName' in body ? v.text(body.fullName, 'Name', { required: true, max: 80 }) : row.full_name;
    keepAnAdmin(ctx.db, row.id, role, active);

    ctx.db.run('update users set role = ?, active = ?, full_name = ?, updated_at = ? where id = ?',
      role, active ? 1 : 0, fullName, now(), row.id);
    if(!active){
      endAllSessions(ctx.db, row.id);
      disconnectUser(row.id);
    }
    const changes = [];
    if(role !== row.role) changes.push(`role ${roleLabel(row.role)} → ${roleLabel(role)}`);
    if(active !== !!row.active) changes.push(active ? 'switched on' : 'switched off');
    if(fullName !== row.full_name) changes.push(`renamed to ${fullName}`);
    if(changes.length) ctx.log('Team member changed', { text: `${row.full_name}: ${changes.join(', ')}` }, { type: 'user', id: row.id });
    const user = pushTeamMember(ctx.db, row.id);
    updateUser({ id: user.id, role: user.role, fullName: user.fullName });
    return { user };
  }, { perm: 'team.manage' });

  /**
   * Deletes a login for good. Their past work stays: jobs, notes and the
   * activity log keep their name, but they are no longer linked to an
   * account. You cannot delete yourself or the last admin.
   */
  r.delete('/api/admin/users/:id', ctx => {
    const row = loadUser(ctx.db, ctx.params.id);
    if(row.id === ctx.user.id) throw conflict('You cannot delete your own login.', 'self');
    keepAnAdmin(ctx.db, row.id, 'none', false);
    endAllSessions(ctx.db, row.id);
    disconnectUser(row.id);
    ctx.db.run('delete from users where id = ?', row.id);
    ctx.log('Team member deleted', { text: `${row.full_name} (${row.login}) deleted` });
    broadcast('user-removed', { id: row.id });
  }, { perm: 'team.manage' });

  r.put('/api/admin/users/:id/password', async ctx => {
    const row = loadUser(ctx.db, ctx.params.id);
    const { password } = await ctx.json();
    const problem = passwordProblem(password);
    if(problem) throw badRequest(problem);
    ctx.db.run('update users set password_hash = ?, updated_at = ? where id = ?', await hashPassword(password), now(), row.id);
    if(row.id !== ctx.user.id) endAllSessions(ctx.db, row.id);
    ctx.log('Password reset', { text: `Set a new password for ${row.full_name}` }, { type: 'user', id: row.id });
  }, { perm: 'team.manage' });

  /* ---------------- access codes ---------------- */

  r.get('/api/admin/codes', ctx => ({
    codes: ctx.db.all('select * from signup_codes order by created_at desc')
      .map(c => ({ code: c.code, label: c.label, active: !!c.active, createdAt: c.created_at }))
  }), { perm: 'team.manage' });

  r.post('/api/admin/codes', async ctx => {
    const body = await ctx.json();
    const code = v.text(body.code, 'Code', { max: 40 }) ||
      // Unambiguous characters only: this gets read aloud and typed on phones.
      Array.from(randomBytes(8), b => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[b % 31]).join('');
    if(ctx.db.get('select 1 from signup_codes where code = ?', code)) throw conflict('That code already exists.');
    ctx.db.run('insert into signup_codes (code, label, active, created_at) values (?, ?, 1, ?)',
      code, v.text(body.label, 'Label', { max: 80 }), now());
    ctx.log('Access code created', { text: `New shop access code${body.label ? ` (${body.label})` : ''}` });
    ctx.status = 201;
    return { code };
  }, { perm: 'team.manage' });

  r.patch('/api/admin/codes/:code', async ctx => {
    const row = ctx.db.get('select * from signup_codes where code = ?', ctx.params.code);
    if(!row) throw notFound('That code');
    const active = v.bool((await ctx.json()).active);
    ctx.db.run('update signup_codes set active = ? where code = ?', active ? 1 : 0, row.code);
    ctx.log(active ? 'Access code turned on' : 'Access code turned off', { text: row.label || 'Shop access code' });
  }, { perm: 'team.manage' });

  /* ---------------- health ---------------- */

  r.get('/api/admin/health', ctx => {
    const count = sql => ctx.db.get(sql).n;
    let disk = null;
    try {
      const s = fs.statfsSync(config.dataDir);
      disk = { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize };
    } catch { /* not supported here */ }
    let dbBytes = 0;
    for(const suffix of ['', '-wal']){
      try { dbBytes += fs.statSync(paths.db + suffix).size; } catch { /* no such file */ }
    }
    const since = new Date(Date.now() - 15 * 60000).toISOString();
    return {
      startedAt: STARTED_AT,
      node: process.version,
      liveConnections: connectionCount(),
      activeRecently: ctx.db.all('select distinct actor_name from activity where at >= ? and actor_id is not null', since)
        .map(r => r.actor_name),
      counts: {
        users: count('select count(*) as n from users where active = 1'),
        jobs: count('select count(*) as n from jobs'),
        openJobs: count("select count(*) as n from jobs where stage != 'complete'"),
        blueprints: count('select count(*) as n from blueprints'),
        activity: count('select count(*) as n from activity')
      },
      storage: { databaseBytes: dbBytes, filesBytes: dirSize(ctx.filesDir), disk },
      backups: listBackups().slice(0, 5)
    };
  }, { perm: 'team.manage' });
}

const STARTED_AT = new Date().toISOString();
