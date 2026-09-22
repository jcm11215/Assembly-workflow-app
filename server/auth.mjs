/**
 * Passwords, sessions and sign-in throttling.
 *
 * Sessions are opaque random tokens in an HttpOnly cookie. The database
 * holds only their SHA-256, so a copy of the database file cannot be
 * used to sign in as anyone. Passwords are scrypt-hashed.
 */
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { now } from './db.mjs';

const scrypt = promisify(scryptCb);

export const SESSION_COOKIE = 'awt_session';
export const MIN_PASSWORD = 8;

/* ---------------- passwords ---------------- */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export async function hashPassword(password){
  const salt = randomBytes(16);
  const key = await scrypt(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password, stored){
  if(!stored) return false;
  const [kind, N, r, p, saltB64, keyB64] = String(stored).split('$');
  if(kind !== 'scrypt') return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(String(password), Buffer.from(saltB64, 'base64'), expected.length,
    { N: Number(N), r: Number(r), p: Number(p) });
  return timingSafeEqual(actual, expected);
}

export function passwordProblem(password){
  if(typeof password !== 'string' || password.length < MIN_PASSWORD){
    return `The password must be at least ${MIN_PASSWORD} characters.`;
  }
  if(password.length > 200) return 'That password is too long.';
  return null;
}

/* ---------------- logins ---------------- */

/** A login is a username ("dreyes") or an email address, stored
 *  lower-case. Usernames: 3-30 of letters, digits, dot, dash, underscore. */
export function normalizeLogin(value){
  return String(value || '').trim().toLowerCase();
}

export function loginProblem(login){
  if(login.includes('@')){
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(login) ? null : 'That email address is not valid.';
  }
  return /^[a-z0-9][a-z0-9._-]{2,29}$/.test(login)
    ? null
    : 'A username is 3-30 characters: letters, numbers, dots, dashes or underscores.';
}

/* ---------------- sessions ---------------- */

const sha256 = s => createHash('sha256').update(s).digest('hex');
const DAY = 86400000;

export function createSession(db, userId, days){
  const token = randomBytes(32).toString('base64url');
  const t = Date.now();
  db.run('insert into sessions (token_hash, user_id, created_at, expires_at, last_seen_at) values (?, ?, ?, ?, ?)',
    sha256(token), userId, now(), t + days * DAY, t);
  return token;
}

/**
 * The signed-in user for a session token, or null. A session is
 * extended as it is used (at most once an hour, to keep writes rare),
 * so someone who opens the app every shift never gets signed out.
 */
export function userForSession(db, token, days){
  if(!token) return null;
  const hash = sha256(token);
  const row = db.get(
    `select s.expires_at, s.last_seen_at, u.id, u.login, u.full_name, u.role, u.active
       from sessions s join users u on u.id = s.user_id
      where s.token_hash = ?`, hash);
  if(!row) return null;
  const t = Date.now();
  if(row.expires_at < t || !row.active){
    db.run('delete from sessions where token_hash = ?', hash);
    return null;
  }
  if(t - row.last_seen_at > 3600000){
    db.run('update sessions set last_seen_at = ?, expires_at = ? where token_hash = ?', t, t + days * DAY, hash);
  }
  return { id: row.id, login: row.login, fullName: row.full_name, role: row.role };
}

export function endSession(db, token){
  if(token) db.run('delete from sessions where token_hash = ?', sha256(token));
}

export function endAllSessions(db, userId){
  db.run('delete from sessions where user_id = ?', userId);
}

export function pruneSessions(db){
  db.run('delete from sessions where expires_at < ?', Date.now());
}

/* ---------------- throttling ---------------- */

/**
 * Failed sign-ins per (login, address). Eight misses in fifteen minutes
 * locks that pair out for the rest of the window -- enough for a person
 * fumbling a password on a tablet, far too few for guessing.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;
const failures = new Map();

export function throttleKey(login, ip){ return `${login}|${ip}`; }

export function isThrottled(key){
  const f = failures.get(key);
  if(!f) return false;
  if(Date.now() - f.first > WINDOW_MS){ failures.delete(key); return false; }
  return f.count >= MAX_FAILURES;
}

export function recordFailure(key){
  const f = failures.get(key);
  if(!f || Date.now() - f.first > WINDOW_MS) failures.set(key, { first: Date.now(), count: 1 });
  else f.count++;
}

export function clearFailures(key){ failures.delete(key); }

/* ---------------- first-run setup ---------------- */

/**
 * Before anyone has an account, the first admin is created from the web
 * page with a one-time code printed in the server's log -- so being on
 * the tailnet first is not enough to claim the app.
 */
let setupCode = null;

export function setupCodeIfNeeded(db){
  const { n } = db.get('select count(*) as n from users');
  if(n > 0){ setupCode = null; return null; }
  if(!setupCode) setupCode = randomBytes(4).toString('hex').toUpperCase();
  return setupCode;
}

export function checkSetupCode(code){
  return !!setupCode && String(code || '').trim().toUpperCase() === setupCode;
}

export function clearSetupCode(){ setupCode = null; }
