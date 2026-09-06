/**
 * Session storage + pub/sub.
 *
 * Pure data layer -- knows nothing about how to obtain or refresh a
 * session, only how to hold one and notify listeners when it changes.
 * authService.js owns the actual network calls; keeping this file
 * dependency-free is what avoids a authService <-> sessionStore cycle.
 */
const KEY = 'awt_session';
let listeners = [];

export function getSession(){
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/** Pass null to clear. Always notifies, even on clear -- that IS a state change. */
export function setSession(session){
  if(session) localStorage.setItem(KEY, JSON.stringify(session));
  else localStorage.removeItem(KEY);
  notify(session);
}

export function clearSession(){ setSession(null); }

export function getUser(){
  const s = getSession();
  return s ? s.user : null;
}

export function getAccessToken(){
  const s = getSession();
  return s ? s.access_token : null;
}

/** 30s safety margin so a request in flight doesn't race the expiry. */
export function isExpired(session){
  session = session || getSession();
  if(!session || !session.expires_at) return true;
  return Date.now() >= (session.expires_at * 1000) - 30000;
}

export function subscribe(fn){
  listeners.push(fn);
  return () => { listeners = listeners.filter(f => f !== fn); };
}

function notify(session){
  listeners.forEach(fn => {
    try { fn(session); } catch (e) { console.error('session listener failed', e); }
  });
}
