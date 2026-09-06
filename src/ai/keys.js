/** AI provider selection + per-provider key storage (browser-local). */

/**
 * Pre-configured shop-wide default keys, so nobody has to enter one to
 * use the app. Per-device overrides in Settings still take priority --
 * these are only the fallback.
 *
 * REPO IS PUBLIC. These are exposed to anyone with the URL, by deliberate
 * choice (convenience over per-device setup). Mitigations in place:
 *   - Gemini key: API-restricted to Generative Language API only
 *     (Google Cloud Console -> Credentials -> this key -> API restrictions)
 *   - OpenRouter key: hard credit limit set on the key itself
 *     (openrouter.ai/settings/keys)
 * Expect these to occasionally get scraped and rate-limited/revoked or
 * hit their cap -- that's the accepted tradeoff, not a malfunction. If
 * a key stops working: generate a new one, apply the same two
 * restrictions above, and replace the value below.
 */
const DEFAULT_GEMINI_KEY = 'AQ.Ab8RN6LiM6Tfaux5l4bHgkGVadRcZhNXCDbSY7qyYuUEFhxrVA';
const DEFAULT_OPENROUTER_KEY = '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';

export function getApiKey(){
  return (localStorage.getItem('awt_geminiKey') || '').trim() || DEFAULT_GEMINI_KEY;
}

export function setApiKey(key){ localStorage.setItem('awt_geminiKey', (key||'').trim()); }

export function getOpenRouterKey(){
  return (localStorage.getItem('awt_openrouterKey') || '').trim() || DEFAULT_OPENROUTER_KEY;
}

export function setOpenRouterKey(key){ localStorage.setItem('awt_openrouterKey', (key||'').trim()); }

export function getOpenRouterModel(){ return (localStorage.getItem('awt_openrouterModel') || '').trim() || 'openrouter/free'; }

export function setOpenRouterModel(model){ localStorage.setItem('awt_openrouterModel', (model||'').trim()); }

export function getAiProvider(){ return localStorage.getItem('awt_aiProvider') || 'gemini'; }

export function setAiProvider(p){ localStorage.setItem('awt_aiProvider', p==='openrouter' ? 'openrouter' : 'gemini'); }

export function activeProviderHasKey(){
  return getAiProvider()==='openrouter' ? !!getOpenRouterKey() : !!getApiKey();
}

/** True only if THIS device has its own key saved, distinct from
 *  falling back to the shop default -- lets Settings say which one is
 *  actually in use instead of showing the shop key as if it were
 *  personal. */
export function hasPersonalApiKey(){ return !!(localStorage.getItem('awt_geminiKey') || '').trim(); }
export function hasPersonalOpenRouterKey(){ return !!(localStorage.getItem('awt_openrouterKey') || '').trim(); }
// Not a login -- just a display name so notes, blockers, and stage moves
// show who did what. No password, nothing to verify, easy to skip or change.
