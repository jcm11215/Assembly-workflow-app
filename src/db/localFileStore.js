/**
 * Blueprint file storage on the shop's own server, as an alternative to
 * Supabase Storage. Same shape as the `storage` object in
 * supabaseClient.js (upload/download/remove) so blueprintsRepo.js can
 * pick one or the other with a single branch, not two code paths.
 *
 * The server is the same one Local AI talks to (src/ai/providers.js) --
 * an address and access key configured in Settings, reachable over
 * Tailscale. This module knows nothing about chat; it only moves bytes.
 */
import { getLocalAiKey, getLocalAiUrl } from '../ai/keys.js';

/** Characters filenames and job-number folders are allowed to use on
 *  the server's filesystem. Mirrors the server's own `_safe_segment` --
 *  keeping both sides in agreement means a name the client builds is
 *  never rejected by the server for a rule the client didn't know about.
 *  Anything outside this set becomes '_'; runs of '_' collapse to one. */
export function sanitizeForPath(name, fallback = 'file'){
  let s = String(name || '')
    .replace(/[^A-Za-z0-9 ._()-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/\.\.+/g, '.')          // no ".." anywhere, even mid-name
    .replace(/^[.\s]+|[.\s]+$/g, '') // no leading/trailing dot or space
    .slice(0, 120);
  return s || fallback;
}

function apiBase(){
  const url = getLocalAiUrl();
  return url ? url.replace(/\/+$/, '') : '';
}

function authHeaders(extra){
  const key = getLocalAiKey();
  return { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(extra || {}) };
}

/** relPath is "job-folder/filename.ext" -- each segment percent-encoded
 *  on its own, so a space or parenthesis in a filename survives the
 *  request without the '/' between them being encoded away too. */
function fileUrl(base, relPath){
  const encoded = String(relPath).split('/').map(encodeURIComponent).join('/');
  return `${base}/api/blueprint-file/${encoded}`;
}

/** Raised on any non-2xx/404 response, so callers can tell "not found"
 *  (caught explicitly, returns null) from "something is actually wrong"
 *  (thrown, same as supabaseClient's storage.download/upload do). */
class LocalFileError extends Error {
  constructor(message, status){ super(message); this.name = 'LocalFileError'; this.status = status; }
}

export const localFileStore = {
  /** Upload raw bytes to `relPath` (e.g. "24-1050/drawing.pdf"), creating
   *  the job's folder on first use. Overwrites whatever was already at
   *  that exact path -- callers avoid collisions by building distinct
   *  names (see blueprintsRepo's version-suffixed filenames), the same
   *  way the Supabase path does with a timestamp. */
  async upload(relPath, blob, contentType = 'application/octet-stream'){
    const base = apiBase();
    if(!base) throw new LocalFileError('No local server address is saved.', 0);
    const res = await fetch(fileUrl(base, relPath), {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': contentType }),
      body: blob
    });
    if(!res.ok){
      const t = await res.text().catch(() => '');
      throw new LocalFileError(`Local storage upload failed: ${t || res.status}`, res.status);
    }
    return relPath;
  },

  /** Download an object as a Blob, or null if it does not exist (or no
   *  server is configured -- treated the same as "not found" here,
   *  since the caller's fallback, an empty viewer, is identical either
   *  way). */
  async download(relPath){
    const base = apiBase();
    if(!base) return null;
    const res = await fetch(fileUrl(base, relPath), {
      headers: authHeaders(), cache: 'no-store'
    });
    if(res.status === 404) return null;
    if(!res.ok) throw new LocalFileError(`Local storage download failed (${res.status})`, res.status);
    return res.blob();
  },

  async remove(relPath){
    const base = apiBase();
    if(!base) return false;
    const res = await fetch(fileUrl(base, relPath), {
      method: 'DELETE', headers: authHeaders()
    });
    return res.ok || res.status === 404;
  }
};
