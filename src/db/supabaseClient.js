/**
 * Supabase client + low-level PostgREST helpers.
 *
 * Everything below is plain fetch against PostgREST -- no SDK dependency,
 * so the app stays a zero-build ES-module deployment. Auth is layered in
 * later (Phase 5) by swapping getAuthHeaders() alone; every repository
 * already routes through it.
 */
import { SUPABASE_URL, SUPABASE_ANON_KEY, supabaseReady } from './config.js';

export { supabaseReady, SUPABASE_URL, SUPABASE_ANON_KEY };

/** Raised when a request is rejected by PostgREST. Carries status + PG code. */
export class DbError extends Error {
  constructor(message, status, code, details){
    super(message);
    this.name = 'DbError';
    this.status = status;
    this.code = code;          // Postgres SQLSTATE, e.g. '23505', 'P0001'
    this.details = details;
  }
  /** Unique violation -- e.g. duplicate job_number. */
  get isConflict(){ return this.code === '23505'; }
  /** Raised by our CHECK constraints and RAISE EXCEPTION in triggers. */
  get isRuleViolation(){ return this.code === 'P0001' || this.code === '23514'; }
  get isPermission(){ return this.status === 401 || this.status === 403 || this.code === '42501'; }
}

/**
 * Phase 5 replaces the anon-key header with the user's JWT. Kept as a
 * single function so that change touches one place.
 */
export function getAuthHeaders(){
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`
  };
}

/**
 * Current authenticated user id. Supplied via injection, not a direct
 * import of authService.js -- authService already depends on this module
 * (via profileService), so importing it back here would be circular.
 * app.js wires setCurrentUserIdProvider(authService.currentActorId) once
 * at boot, the same seam pattern app/bus.js uses for render.
 */
let userIdProvider = () => null;
export function setCurrentUserIdProvider(fn){ userIdProvider = fn; }
export function currentUserId(){ return userIdProvider(); }

async function request(path, { method = 'GET', body, prefer, signal } = {}){
  if(!supabaseReady()) throw new DbError('Supabase is not configured.', 0, null);
  const headers = {
    ...getAuthHeaders(),
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };
  if(prefer) headers.Prefer = prefer;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    cache: 'no-store',
    signal,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await res.text();
  let payload = null;
  if(text){
    try { payload = JSON.parse(text); } catch { payload = text; }
  }

  if(!res.ok){
    const msg = (payload && payload.message) || `Request failed (${res.status})`;
    throw new DbError(msg, res.status, payload && payload.code, payload && payload.details);
  }
  return payload;
}

export const db = {
  /** SELECT. `query` is a PostgREST query string, e.g. 'select=*&order=at.desc'. */
  select: (table, query = 'select=*') => request(`${table}?${query}`),

  /** INSERT. Returns inserted rows by default. */
  insert: (table, rows, { returning = true } = {}) =>
    request(table, {
      method: 'POST',
      body: Array.isArray(rows) ? rows : [rows],
      prefer: returning ? 'return=representation' : 'return=minimal'
    }),

  /** UPSERT on a conflict target. */
  upsert: (table, rows, onConflict, { returning = true } = {}) =>
    request(`${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      body: Array.isArray(rows) ? rows : [rows],
      prefer: `resolution=merge-duplicates,${returning ? 'return=representation' : 'return=minimal'}`
    }),

  /** UPDATE matching `filter` (a PostgREST filter string). */
  update: (table, filter, patch, { returning = true } = {}) =>
    request(`${table}?${filter}`, {
      method: 'PATCH',
      body: patch,
      prefer: returning ? 'return=representation' : 'return=minimal'
    }),

  /** DELETE matching `filter`. */
  remove: (table, filter) =>
    request(`${table}?${filter}`, { method: 'DELETE', prefer: 'return=minimal' })
};

/* ---------------- Supabase Storage (blueprint images) ---------------- */
export const BLUEPRINT_BUCKET = 'blueprints';

export const storage = {
  /** Upload raw bytes. `upsert` overwrites an existing object at that path. */
  async upload(bucket, path, blob, contentType = 'image/jpeg'){
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': contentType, 'x-upsert': 'true' },
      body: blob
    });
    if(!res.ok){
      const t = await res.text();
      throw new DbError(`Storage upload failed: ${t || res.status}`, res.status, null);
    }
    return path;
  },

  /** Download an object as a Blob, or null if it does not exist. */
  async download(bucket, path){
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
      headers: getAuthHeaders(),
      cache: 'no-store'
    });
    if(res.status === 404) return null;
    if(!res.ok) throw new DbError(`Storage download failed (${res.status})`, res.status, null);
    return res.blob();
  },

  async remove(bucket, path){
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    return res.ok || res.status === 404;
  }
};

/* ---------------- base64 <-> Blob (images travel as base64 in the UI) ---------------- */
export function base64ToBlob(b64, type = 'image/jpeg'){
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export function blobToBase64(blob){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('Could not read blob'));
    r.readAsDataURL(blob);
  });
}
