/**
 * Supabase Auth. Plain fetch against the GoTrue REST API -- no SDK, same
 * zero-build approach as the rest of the app.
 *
 * Also the seam between old and new identity: currentActorId() and
 * currentActorName() are what every repository and UI form should call
 * from now on, instead of reaching into auth/identity.js directly. Which
 * source they read from is decided by AUTH_ENABLED alone, so flipping
 * that one flag is the entire migration.
 */
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../db/config.js';
import { getSession, setSession, clearSession, getUser, isExpired, subscribe } from './sessionStore.js';
import { ensureProfile, getCachedProfile, clearCachedProfile } from './profileService.js';
import { getUserName } from './identity.js';   // legacy fallback only, while AUTH_ENABLED is false

/**
 * Transitional switch. false = legacy device-local identity, unchanged
 * from Phase 0-4. true = Supabase Auth is required to use the app.
 * This is a deploy-time setting: flip it once real accounts exist for
 * the team, then republish. It is intentionally not a runtime toggle in
 * Settings -- half-authenticated is not a state worth supporting.
 */
export const AUTH_ENABLED = true;

const AUTH_URL = `${SUPABASE_URL}/auth/v1`;

function authHeaders(extra){
  return { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json', ...(extra || {}) };
}

function toSession(tok){
  if(!tok || !tok.access_token) return null;
  return {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expires_at: tok.expires_at || (Math.floor(Date.now() / 1000) + (tok.expires_in || 3600)),
    user: tok.user || null
  };
}

let refreshTimer = null;
function scheduleRefresh(session){
  clearTimeout(refreshTimer);
  if(!session || !session.expires_at) return;
  // Refresh a minute early so requests never race an expiring token.
  const delay = Math.max(5000, (session.expires_at * 1000) - Date.now() - 60000);
  refreshTimer = setTimeout(() => {
    refreshSession().catch(e => console.error('background token refresh failed', e));
  }, delay);
}

/* ---------------- core auth actions ---------------- */

export async function signIn(email, password){
  const res = await fetch(`${AUTH_URL}/token?grant_type=password`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ email, password })
  });
  const data = await res.json().catch(() => ({}));
  if(!res.ok) throw new Error(data.error_description || data.msg || 'Sign in failed');

  const session = toSession(data);
  setSession(session);
  scheduleRefresh(session);
  await ensureProfile(session.user);
  return session;
}

export async function signOut(){
  const token = getSession() && getSession().access_token;
  clearTimeout(refreshTimer);
  try {
    if(token){
      await fetch(`${AUTH_URL}/logout`, {
        method: 'POST', headers: authHeaders({ Authorization: `Bearer ${token}` })
      });
    }
  } catch (e) {
    console.error('sign-out request failed (clearing local session anyway)', e);
  }
  clearSession();
  clearCachedProfile();
}

export async function refreshSession(){
  const s = getSession();
  if(!s || !s.refresh_token) return null;
  const res = await fetch(`${AUTH_URL}/token?grant_type=refresh_token`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ refresh_token: s.refresh_token })
  });
  const data = await res.json().catch(() => ({}));
  if(!res.ok){
    // Dead refresh token: clear rather than loop -- force a real re-login.
    clearSession();
    clearCachedProfile();
    throw new Error(data.error_description || 'Session expired -- please sign in again.');
  }
  const session = toSession(data);
  setSession(session);
  scheduleRefresh(session);
  return session;
}

/** Called once at boot. Restores a valid session, refreshes a stale one, or returns null. */
export async function restoreSession(){
  const s = getSession();
  if(!s) return null;
  if(!isExpired(s)){
    scheduleRefresh(s);
    if(!getCachedProfile()) await ensureProfile(s.user).catch(() => null);
    return s;
  }
  try { return await refreshSession(); }
  catch { return null; }
}

/** fn(session|null) -- called on sign-in, sign-out, and refresh. */
export function onAuthStateChange(fn){ return subscribe(fn); }

export function currentUser(){ return getUser(); }
export function isSignedIn(){ return !!getUser(); }

/* ---------------- password reset ---------------- */

export async function requestPasswordReset(email){
  const res = await fetch(`${AUTH_URL}/recover`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ email })
  });
  if(!res.ok){
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error_description || 'Could not send the reset email.');
  }
  return true;
}

/** Called on the page Supabase's reset-link redirect lands on. */
export async function updatePassword(newPassword){
  const token = getSession() && getSession().access_token;
  if(!token) throw new Error('No active recovery session.');
  const res = await fetch(`${AUTH_URL}/user`, {
    method: 'PUT',
    headers: authHeaders({ Authorization: `Bearer ${token}` }),
    body: JSON.stringify({ password: newPassword })
  });
  if(!res.ok){
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error_description || data.msg || 'Could not update the password.');
  }
  return true;
}

/* ---------------- identity bridge ----------------
 * The single place that decides "who is acting right now", so every
 * repository and form reads from here instead of choosing a source
 * themselves. */

export function currentActorId(){
  if(!AUTH_ENABLED) return null;          // legacy mode: no auth.uid() to give
  const u = currentUser();
  return u ? u.id : null;
}

export function currentActorName(){
  if(!AUTH_ENABLED) return getUserName() || 'Unknown';
  const p = getCachedProfile();
  if(p && p.full_name) return p.full_name;
  const u = currentUser();
  return u ? (u.email || 'Signed-in user') : 'Unknown';
}
