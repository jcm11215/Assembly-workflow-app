/**
 * Global error capture: uncaught exceptions and unhandled promise
 * rejections. Purely observational -- catches and records, never
 * suppresses (both handlers let the error continue to the console as
 * it normally would; this only adds a durable trace alongside that).
 *
 * Kept in-memory (a capped ring buffer) plus a rate-limited, best-effort
 * write to activity_log for anything severe enough to be worth a
 * server-side trace. Rate-limited because a JS error that fires on
 * every render (a real failure mode -- a bad state shape hit on each
 * repaint) must never be allowed to flood the audit log.
 */
import { logActivity } from '../db/repository.js';

const MAX_ENTRIES = 200;
const ring = [];
const seenSignatures = new Map();   // signature -> last-logged timestamp
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;   // one server-side log per distinct error per 5 min

function signatureOf(message, stack){
  // First stack frame is usually enough to distinguish error sites
  // without being so specific that transient details (line numbers
  // after a hot-reload, random ids in a message) create false churn.
  const frame = (stack || '').split('\n')[1] || '';
  return `${String(message).slice(0,120)}::${frame.trim().slice(0,120)}`;
}

function record(entry){
  ring.push(entry);
  if(ring.length > MAX_ENTRIES) ring.shift();

  const sig = signatureOf(entry.message, entry.stack);
  const last = seenSignatures.get(sig) || 0;
  if(Date.now() - last < DEDUPE_WINDOW_MS) return;
  seenSignatures.set(sig, Date.now());

  // Fire-and-forget, matching every other audit write in this app --
  // a broken error reporter must never itself throw or block anything.
  logActivity(`Client error: ${entry.kind}`, {
    message: String(entry.message).slice(0,500),
    stack: entry.stack ? String(entry.stack).slice(0,1000) : null,
    url: entry.url || null,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null
  }).catch(()=>{});   // if logging the error itself fails, swallow -- do not cascade
}

function onError(event){
  record({
    kind:'uncaught exception',
    message: event.message || (event.error && event.error.message) || 'Unknown error',
    stack: event.error && event.error.stack,
    url: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : null,
    at: new Date().toISOString()
  });
}

function onUnhandledRejection(event){
  const reason = event.reason;
  record({
    kind:'unhandled promise rejection',
    message: (reason && reason.message) || String(reason) || 'Unknown rejection',
    stack: reason && reason.stack,
    at: new Date().toISOString()
  });
}

let installed = false;

/** Call once at boot. Idempotent -- safe to call more than once. */
export function initErrorHandlers(){
  if(installed) return;
  installed = true;
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onUnhandledRejection);
}

export function teardownErrorHandlers(){
  if(!installed) return;
  installed = false;
  window.removeEventListener('error', onError);
  window.removeEventListener('unhandledrejection', onUnhandledRejection);
}

/** Manual capture point for code that catches an error itself but still
 *  wants it in the trace (e.g. a repository call wrapped in try/catch
 *  that already shows the user a toast). */
export function reportError(kind, error, context){
  record({
    kind, message: (error && error.message) || String(error),
    stack: error && error.stack, at: new Date().toISOString(), ...context
  });
}

export function getErrorLog(){ return ring.slice().reverse(); }   // newest first
export function clearErrorLog(){ ring.length = 0; seenSignatures.clear(); }
