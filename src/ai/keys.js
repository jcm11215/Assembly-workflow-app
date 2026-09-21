/** AI provider selection + per-provider key storage (browser-local). */

/**
 * AI provider selection + per-provider key storage (browser-local).
 *
 * No shared/default keys. Two were tried here previously (one Gemini,
 * one OpenRouter) and both were disabled within days -- this repo is
 * public, and both providers run automated leaked-key detection that
 * kills exposed keys on sight. Since only one person actually scans
 * blueprints, a shared key was never necessary: each device's key is
 * entered once in Settings and stored in that browser's localStorage
 * only, which never touches the repo and can't be scraped this way.
 */

export function getApiKey(){
  return (localStorage.getItem('awt_geminiKey') || '').trim();
}

export function setApiKey(key){ localStorage.setItem('awt_geminiKey', (key||'').trim()); }

/**
 * Which Gemini model reads the drawings.
 *
 * Stored rather than hardcoded because a model can be perfectly valid
 * and still refuse to work: "this model is currently experiencing high
 * demand" is a property of the hour, not of the key, and the only way
 * out is to use a different one. The default is the newest flash model;
 * Settings lists what this particular key can actually see.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';

export function getGeminiModel(){
  return (localStorage.getItem('awt_geminiModel') || '').trim() || DEFAULT_GEMINI_MODEL;
}

export function setGeminiModel(model){
  localStorage.setItem('awt_geminiModel', (model || '').trim());
}

export function getOpenRouterKey(){
  return (localStorage.getItem('awt_openrouterKey') || '').trim();
}

export function setOpenRouterKey(key){ localStorage.setItem('awt_openrouterKey', (key||'').trim()); }

export function getOpenRouterModel(){ return (localStorage.getItem('awt_openrouterModel') || '').trim() || 'openrouter/free'; }

export function setOpenRouterModel(model){ localStorage.setItem('awt_openrouterModel', (model||'').trim()); }

// Defaults to OpenRouter: Gemini's AQ.-format keys are currently rejected
// by Google's own API for this account (confirmed directly against
// Google's endpoint, no app involved -- see ARCHITECTURE.md/commit notes
// if this needs revisiting later).
const PROVIDERS = ['gemini', 'openrouter', 'local'];

export function getAiProvider(){
  const p = localStorage.getItem('awt_aiProvider');
  return PROVIDERS.includes(p) ? p : 'openrouter';
}

export function setAiProvider(p){
  localStorage.setItem('awt_aiProvider', PROVIDERS.includes(p) ? p : 'gemini');
}

/** How a provider is named in messages. */
export function providerLabel(p){
  const which = p || getAiProvider();
  return which === 'openrouter' ? 'OpenRouter' : which === 'local' ? 'the local AI' : 'Google Gemini';
}

/* ---------------- Local AI (the shop's own server) ----------------
 *
 * The desktop running the local AI, reached at its Tailscale https
 * address. Same rule as the cloud keys: the address and the access key
 * are typed in once per device and live only in this browser -- the repo
 * is public, and the access key is what stands between the internet and
 * every drawing on that server.
 */

/** Tidies a pasted address: adds https://, drops a trailing slash or a
 *  pasted-in API path, so "host/v1/chat/completions" and "host/" both
 *  become the base address the app adds paths to. */
export function normalizeLocalAiUrl(url){
  let u = String(url || '').trim();
  if(!u) return '';
  if(!/^https?:\/\//i.test(u)) u = 'https://' + u;
  u = u.replace(/\/+$/, '').replace(/\/v1(\/chat\/completions|\/models)?$/i, '').replace(/\/+$/, '');
  return u;
}

/**
 * Why an address can't work from here, or null.
 *
 * The tracker is served over https, and browsers refuse plain-http
 * requests from an https page ("mixed content") without saying much --
 * the LAN address that works in the desktop's own browser fails here
 * with nothing but "Failed to fetch". Said up front instead.
 */
export function localAiUrlProblem(url){
  const u = normalizeLocalAiUrl(url);
  if(!u) return 'No address entered.';
  let parsed;
  try { parsed = new URL(u); } catch { return `"${url}" isn't a web address.`; }
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(parsed.hostname);
  if(parsed.protocol === 'http:' && !local){
    return 'This page is served over https, so the browser blocks plain http:// addresses. ' +
           'Use the server\'s https address -- the Tailscale one ending in .ts.net.';
  }
  return null;
}

export function getLocalAiUrl(){ return normalizeLocalAiUrl(localStorage.getItem('awt_localAiUrl') || ''); }
export function setLocalAiUrl(url){ localStorage.setItem('awt_localAiUrl', normalizeLocalAiUrl(url)); }

export function getLocalAiKey(){ return (localStorage.getItem('awt_localAiKey') || '').trim(); }
export function setLocalAiKey(key){ localStorage.setItem('awt_localAiKey', (key || '').trim()); }

/** When the local AI can't be reached (desktop off, service down), use
 *  OpenRouter instead of failing the scan. On unless turned off; only
 *  possible when an OpenRouter key is saved too. */
export function getLocalAiFallback(){ return localStorage.getItem('awt_localAiFallback') !== 'off'; }
export function setLocalAiFallback(on){ localStorage.setItem('awt_localAiFallback', on ? 'on' : 'off'); }

/**
 * Store uploaded blueprint files on the shop's own server instead of in
 * Supabase Storage -- same address and access key as Local AI above,
 * since it is the same machine, but a separate switch: someone may want
 * Gemini or OpenRouter doing the reading while files still land on a
 * server they own, or the reverse. Off by default, and only meaningful
 * once an address and key are saved.
 */
export function getLocalBlueprintStorageEnabled(){
  return localStorage.getItem('awt_localBlueprintStorage') === 'on';
}
export function setLocalBlueprintStorageEnabled(on){
  localStorage.setItem('awt_localBlueprintStorage', on ? 'on' : 'off');
}

export function activeProviderHasKey(){
  const p = getAiProvider();
  if(p === 'local') return !!getLocalAiUrl() && !!getLocalAiKey();
  return p === 'openrouter' ? !!getOpenRouterKey() : !!getApiKey();
}

/** No shared default anymore, so "personal key" and "has a key at all"
 *  are now the same question -- kept as separate functions so Settings'
 *  existing copy doesn't need to change. */
export function hasPersonalApiKey(){ return !!getApiKey(); }
export function hasPersonalOpenRouterKey(){ return !!getOpenRouterKey(); }
// Not a login -- just a display name so notes, blockers, and stage moves
// show who did what. No password, nothing to verify, easy to skip or change.
