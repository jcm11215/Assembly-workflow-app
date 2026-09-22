/** AI provider selection + per-provider key storage (browser-local). */
import { getSession } from '../auth/sessionStore.js';
import { getShopSetting, SHOP_KEYS } from '../db/shopSettings.js';

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

/** A choice made on this device wins; otherwise the shop's default (set
 *  once by an admin), so a new phone uses the local AI with nothing
 *  picked; otherwise OpenRouter, as before. */
export function getAiProvider(){
  const p = localStorage.getItem('awt_aiProvider');
  if(PROVIDERS.includes(p)) return p;
  const shop = getShopSetting(SHOP_KEYS.DEFAULT_AI_PROVIDER);
  return PROVIDERS.includes(shop) ? shop : 'openrouter';
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
 * address. Nothing here is typed in per device any more: the address is
 * a shop setting an admin enters once, and the credential is the
 * person's own tracker sign-in, which the server checks with Supabase.
 * Neither lives in the repo -- it's public, and the address would
 * advertise the server to anyone reading it.
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

/** The shop's server address, set once by an admin for every device.
 *  An address saved on this device before shop settings existed still
 *  works as a fallback, so nothing already set up stops working. */
export function getLocalAiUrl(){
  const shop = getShopSetting(SHOP_KEYS.LOCAL_SERVER_URL);
  return normalizeLocalAiUrl(shop || localStorage.getItem('awt_localAiUrl') || '');
}
export function setLocalAiUrl(url){ localStorage.setItem('awt_localAiUrl', normalizeLocalAiUrl(url)); }

/** A per-device access key -- legacy. Nothing asks for one any more;
 *  kept so a device that saved one keeps working until it's removed. */
export function getLocalAiKey(){ return (localStorage.getItem('awt_localAiKey') || '').trim(); }
export function setLocalAiKey(key){ localStorage.setItem('awt_localAiKey', (key || '').trim()); }

/**
 * What proves who's asking, sent as the Bearer token to the shop's
 * server: the person's own tracker sign-in. The server checks it with
 * Supabase, so being signed in IS the credential -- nothing to type on
 * each device, and deactivating someone's account cuts off their access
 * to the server too. A legacy per-device key is used only when there is
 * no session (auth disabled, or signed out).
 */
export function getLocalAiToken(){
  const s = getSession();
  return (s && s.access_token) || getLocalAiKey();
}

/** When the local AI can't be reached (desktop off, service down), use
 *  OpenRouter instead of failing the scan. On unless turned off; only
 *  possible when an OpenRouter key is saved too. */
export function getLocalAiFallback(){ return localStorage.getItem('awt_localAiFallback') !== 'off'; }
export function setLocalAiFallback(on){ localStorage.setItem('awt_localAiFallback', on ? 'on' : 'off'); }

/**
 * Whether new blueprint files go to the shop's own server instead of
 * Supabase Storage. Shop-wide, set by an admin: a per-device switch let
 * one tablet save to the cloud while another saved to the desktop, and
 * nobody could say where a given drawing was.
 */
export function getLocalBlueprintStorageEnabled(){
  return getShopSetting(SHOP_KEYS.BLUEPRINT_STORAGE) === 'local';
}

export function activeProviderHasKey(){
  const p = getAiProvider();
  if(p === 'local') return !!getLocalAiUrl() && !!getLocalAiToken();
  return p === 'openrouter' ? !!getOpenRouterKey() : !!getApiKey();
}

/** No shared default anymore, so "personal key" and "has a key at all"
 *  are now the same question -- kept as separate functions so Settings'
 *  existing copy doesn't need to change. */
export function hasPersonalApiKey(){ return !!getApiKey(); }
export function hasPersonalOpenRouterKey(){ return !!getOpenRouterKey(); }
// Not a login -- just a display name so notes, blockers, and stage moves
// show who did what. No password, nothing to verify, easy to skip or change.
