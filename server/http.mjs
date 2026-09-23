/**
 * A small router and the request/response helpers every route uses.
 *
 * Handlers are `async (ctx) => result`. Returning a value sends it as
 * JSON; throwing an HttpError sends { error, code } with its status.
 * Anything else thrown is a bug: it is logged and answered with a 500
 * that says nothing about the internals.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message, code = null, extra = null){
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const badRequest = (msg, code = 'bad_request') => new HttpError(400, msg, code);
export const forbidden = (msg = 'You do not have permission to do that.') => new HttpError(403, msg, 'forbidden');
export const notFound = (what = 'That') => new HttpError(404, `${what} was not found.`, 'not_found');
export const conflict = (msg, code = 'conflict', extra = null) => new HttpError(409, msg, code, extra);

/* ---------------- routing ---------------- */

export function createRouter(){
  const routes = [];

  function add(method, pattern, handler, opts = {}){
    const keys = [];
    const regex = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, regex, keys, handler, opts });
  }

  function match(method, pathname){
    let pathMatched = false;
    for(const r of routes){
      const m = r.regex.exec(pathname);
      if(!m) continue;
      pathMatched = true;
      if(r.method !== method) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }

  return {
    get: (p, h, o) => add('GET', p, h, o),
    post: (p, h, o) => add('POST', p, h, o),
    put: (p, h, o) => add('PUT', p, h, o),
    patch: (p, h, o) => add('PATCH', p, h, o),
    delete: (p, h, o) => add('DELETE', p, h, o),
    match
  };
}

/* ---------------- request bodies ---------------- */

const MB = 1024 * 1024;

export function readRaw(req, limit){
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if(declared > limit) return reject(new HttpError(413, 'That upload is too large.', 'too_large'));
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if(size > limit){
        reject(new HttpError(413, 'That upload is too large.', 'too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req, limit = 2 * MB){
  const type = String(req.headers['content-type'] || '');
  if(!type.startsWith('application/json')) throw badRequest('Expected a JSON body.');
  const buf = await readRaw(req, limit);
  if(!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); }
  catch { throw badRequest('The request body is not valid JSON.'); }
}

export { MB };

/* ---------------- cookies ---------------- */

export function parseCookies(req){
  const out = {};
  for(const part of String(req.headers.cookie || '').split(';')){
    const i = part.indexOf('=');
    if(i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** HTTPS as the browser saw it: `tailscale serve` terminates TLS and
 *  forwards plain HTTP to us with X-Forwarded-Proto set. */
export const isHttps = req => String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';

export function cookieHeader(name, value, { maxAgeSec, secure }){
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if(maxAgeSec != null) parts.push(`Max-Age=${maxAgeSec}`);
  if(secure) parts.push('Secure');
  return parts.join('; ');
}

/* ---------------- responses ---------------- */

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    // WebAssembly only (the OCR engine for scanned drawings), not eval.
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    "frame-src 'self' blob:",
    "object-src 'self' blob:",
    "connect-src 'self'",
    "font-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; ')
};

export function sendJson(res, status, body, headers = {}){
  const data = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(data);
}

export function sendError(res, err){
  if(err instanceof HttpError){
    sendJson(res, err.status, { error: err.message, code: err.code, ...(err.extra || {}) });
    return;
  }
  console.error(err);
  sendJson(res, 500, { error: 'Something went wrong on the server. Try again, and tell an admin if it keeps happening.', code: 'server_error' });
}

/* ---------------- static files ---------------- */

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.wasm': 'application/wasm'
};

/**
 * Serves a file from `root` if `urlPath` names one inside it. Returns
 * false when there is no such file, so the caller can try elsewhere.
 * Revalidated on every load (ETag), so a redeploy reaches every tablet
 * on its next page load without anyone clearing a cache.
 */
export function serveStatic(req, res, root, urlPath){
  let rel;
  try { rel = decodeURIComponent(urlPath); } catch { return false; }
  const file = path.resolve(root, '.' + path.posix.normalize('/' + rel));
  if(!file.startsWith(root + path.sep) && file !== root) return false;

  let stat;
  try { stat = fs.statSync(file); } catch { return false; }
  if(!stat.isFile()) return false;

  const etag = '"' + createHash('sha1').update(`${stat.size}-${stat.mtimeMs}`).digest('base64url') + '"';
  const headers = {
    ...SECURITY_HEADERS,
    'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    ETag: etag
  };
  if(req.headers['if-none-match'] === etag){
    res.writeHead(304, headers);
    res.end();
    return true;
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if(req.method === 'HEAD'){ res.end(); return true; }
  fs.createReadStream(file).pipe(res);
  return true;
}

export { SECURITY_HEADERS };
