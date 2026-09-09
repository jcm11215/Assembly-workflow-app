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
export function getAiProvider(){ return localStorage.getItem('awt_aiProvider') || 'openrouter'; }

export function setAiProvider(p){ localStorage.setItem('awt_aiProvider', p==='openrouter' ? 'openrouter' : 'gemini'); }

export function activeProviderHasKey(){
  return getAiProvider()==='openrouter' ? !!getOpenRouterKey() : !!getApiKey();
}

/** No shared default anymore, so "personal key" and "has a key at all"
 *  are now the same question -- kept as separate functions so Settings'
 *  existing copy doesn't need to change. */
export function hasPersonalApiKey(){ return !!getApiKey(); }
export function hasPersonalOpenRouterKey(){ return !!getOpenRouterKey(); }
// Not a login -- just a display name so notes, blockers, and stage moves
// show who did what. No password, nothing to verify, easy to skip or change.
