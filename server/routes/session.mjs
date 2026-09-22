/**
 * Signing in and out, self-service sign-up with the shop access code,
 * first-run setup of the first admin, and changing your own password.
 */
import { config } from '../config.mjs';
import { badRequest, conflict, HttpError } from '../http.mjs';
import { uuid, now, getSetting } from '../db.mjs';
import {
  hashPassword, verifyPassword, passwordProblem, normalizeLogin, loginProblem,
  createSession, endSession, endAllSessions,
  throttleKey, isThrottled, recordFailure, clearFailures,
  setupCodeIfNeeded, checkSetupCode, clearSetupCode
} from '../auth.mjs';
import { toUser } from '../records.mjs';
import { verifyLegacyPassword } from '../legacyAuth.mjs';
import { logActivity } from '../app.mjs';

const SESSION_SECONDS = () => config.sessionDays * 86400;

function startSession(ctx, userId){
  const token = createSession(ctx.db, userId, config.sessionDays);
  ctx.setSessionCookie(token, SESSION_SECONDS());
}

const publicUser = u => ({ id: u.id, login: u.login, fullName: u.fullName, role: u.role });

/** Validates the fields every new account needs; returns them cleaned. */
export function newAccountFields(body){
  const fullName = String(body.fullName || '').trim();
  const login = normalizeLogin(body.login);
  const password = body.password;
  if(!fullName) throw badRequest('Enter a name.');
  if(fullName.length > 80) throw badRequest('That name is too long.');
  const lp = loginProblem(login);
  if(lp) throw badRequest(lp);
  const pp = passwordProblem(password);
  if(pp) throw badRequest(pp);
  return { fullName, login, password };
}

/** Creates a user; 409 if the login is taken. Returns the new user. */
export async function insertUser(db, { fullName, login, password, role }){
  if(db.get('select 1 from users where login = ?', login)){
    throw conflict('That username or email is already taken.', 'login_taken');
  }
  const id = uuid();
  const t = now();
  db.run(`insert into users (id, login, full_name, role, active, password_hash, created_at, updated_at)
          values (?, ?, ?, ?, 1, ?, ?, ?)`, id, login, fullName, role, await hashPassword(password), t, t);
  return toUser(db.get('select * from users where id = ?', id));
}

export default function register(r){

  r.get('/api/session', ctx => ({
    user: ctx.user ? publicUser(ctx.user) : null,
    setupNeeded: !ctx.user && !!setupCodeIfNeeded(ctx.db)
  }), { public: true });

  r.post('/api/session', async ctx => {
    const body = await ctx.json();
    const login = normalizeLogin(body.login);
    const password = String(body.password || '');
    const key = throttleKey(login, ctx.clientIp());
    if(isThrottled(key)){
      throw new HttpError(429, 'Too many failed sign-ins. Wait 15 minutes and try again.', 'throttled');
    }

    const row = ctx.db.get('select * from users where login = ?', login);
    let ok = false;
    if(row && row.password_hash){
      ok = await verifyPassword(password, row.password_hash);
    } else if(row){
      // Imported from the old app, no password here yet. While the old
      // sign-in service is still configured, a correct old password is
      // accepted once and becomes this account's password.
      const legacy = getSetting(ctx.db, 'legacyAuth');
      if(legacy && await verifyLegacyPassword(legacy, row.legacy_email || row.login, password)){
        ctx.db.run('update users set password_hash = ?, updated_at = ? where id = ?', await hashPassword(password), now(), row.id);
        ok = true;
      } else if(!legacy){
        throw new HttpError(401, 'This account needs a new password. Ask an admin to set one for you.', 'no_password');
      }
    }

    if(!ok){
      recordFailure(key);
      throw new HttpError(401, 'That username or password is not right.', 'bad_login');
    }
    if(!row.active){
      throw new HttpError(403, 'This account is switched off. Check with your supervisor.', 'inactive');
    }
    clearFailures(key);
    startSession(ctx, row.id);
    return { user: publicUser(toUser(row)) };
  }, { public: true });

  r.delete('/api/session', ctx => {
    endSession(ctx.db, ctx.token);
    ctx.setSessionCookie('', 0);
  }, { public: true });

  r.post('/api/signup', async ctx => {
    const body = await ctx.json();
    const fields = newAccountFields(body);
    const code = String(body.accessCode || '').trim();
    const key = throttleKey('signup', ctx.clientIp());
    if(isThrottled(key)) throw new HttpError(429, 'Too many attempts. Wait 15 minutes and try again.', 'throttled');
    if(!code || !ctx.db.get('select 1 from signup_codes where code = ? and active = 1', code)){
      recordFailure(key);
      throw badRequest('That shop access code is not right. Ask your supervisor for the current one.', 'bad_code');
    }
    const user = await insertUser(ctx.db, { ...fields, role: 'trainee' });
    startSession(ctx, user.id);
    logActivity(ctx.db, user, 'Account created', { text: `${user.fullName} signed up as ${user.login}` }, { type: 'user', id: user.id });
    return { user: publicUser(user) };
  }, { public: true });

  r.post('/api/setup', async ctx => {
    const body = await ctx.json();
    if(!setupCodeIfNeeded(ctx.db)) throw conflict('This server is already set up. Sign in instead.', 'already_setup');
    const key = throttleKey('setup', ctx.clientIp());
    if(isThrottled(key)) throw new HttpError(429, 'Too many attempts. Wait 15 minutes and try again.', 'throttled');
    if(!checkSetupCode(body.setupCode)){
      recordFailure(key);
      throw badRequest('That setup code is not right. It is printed in the server log.', 'bad_setup_code');
    }
    const fields = newAccountFields(body);
    const user = await insertUser(ctx.db, { ...fields, role: 'admin' });
    clearSetupCode();
    startSession(ctx, user.id);
    logActivity(ctx.db, user, 'Server set up', { text: `${user.fullName} created the first admin account` }, { type: 'user', id: user.id });
    return { user: publicUser(user) };
  }, { public: true });

  r.post('/api/me/password', async ctx => {
    const body = await ctx.json();
    const row = ctx.db.get('select password_hash from users where id = ?', ctx.user.id);
    if(!(await verifyPassword(String(body.current || ''), row.password_hash))){
      throw badRequest('Your current password is not right.', 'bad_password');
    }
    const pp = passwordProblem(body.next);
    if(pp) throw badRequest(pp);
    ctx.db.run('update users set password_hash = ?, updated_at = ? where id = ?', await hashPassword(body.next), now(), ctx.user.id);
    // Sign out every other device, keep this one.
    endAllSessions(ctx.db, ctx.user.id);
    startSession(ctx, ctx.user.id);
    ctx.log('Password changed', { text: 'Changed their own password' }, { type: 'user', id: ctx.user.id });
  });
}
