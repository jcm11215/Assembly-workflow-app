/**
 * Talks to the server. Every call is same-origin with the session cookie;
 * writes carry the X-Requested-With header the server requires.
 *
 * Failures throw ApiError with the server's own message, which is written
 * to be shown to the person as-is.
 */

export class ApiError extends Error {
  constructor(status, body){
    super((body && body.error) || (status ? `Request failed (${status})` : 'Could not reach the server. Check the connection.'));
    this.status = status;
    this.code = body && body.code;
    this.data = body || {};
  }
  get isStale(){ return this.code === 'stale'; }
  get isSignedOut(){ return this.status === 401 && this.code === 'signed_out'; }
}

let onSignedOut = () => {};
/** Called once at start-up: what to do when the session has ended. */
export function setSignedOutHandler(fn){ onSignedOut = fn; }

async function request(method, path, body, { contentType, signal } = {}){
  const headers = {};
  if(method !== 'GET') headers['X-Requested-With'] = 'awt';
  let payload;
  if(body instanceof Blob){
    payload = body;
    headers['Content-Type'] = contentType || body.type || 'application/octet-stream';
  } else if(body !== undefined){
    payload = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }

  let res;
  try {
    res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin', cache: 'no-store', signal });
  } catch (e) {
    if(e.name === 'AbortError') throw e;
    throw new ApiError(0, null);
  }
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json().catch(() => null) : null;
  if(!res.ok){
    const err = new ApiError(res.status, data);
    if(err.isSignedOut) onSignedOut();
    throw err;
  }
  return data;
}

export const api = {
  get: (path, opts) => request('GET', path, undefined, opts),
  post: (path, body, opts) => request('POST', path, body ?? {}, opts),
  put: (path, body, opts) => request('PUT', path, body ?? {}, opts),
  patch: (path, body, opts) => request('PATCH', path, body ?? {}, opts),
  del: (path, opts) => request('DELETE', path, undefined, opts)
};

/** Fetches a file the server stores (a blueprint) as a Blob. */
export async function fetchBlob(path){
  const res = await fetch(path, { credentials: 'same-origin' });
  if(!res.ok) throw new ApiError(res.status, null);
  return res.blob();
}
