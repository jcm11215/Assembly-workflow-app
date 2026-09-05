/** AI provider selection + per-provider key storage (browser-local). */

export function getApiKey(){ return (localStorage.getItem('awt_geminiKey') || '').trim(); }

export function setApiKey(key){ localStorage.setItem('awt_geminiKey', (key||'').trim()); }

export function getOpenRouterKey(){ return (localStorage.getItem('awt_openrouterKey') || '').trim(); }

export function setOpenRouterKey(key){ localStorage.setItem('awt_openrouterKey', (key||'').trim()); }

export function getOpenRouterModel(){ return (localStorage.getItem('awt_openrouterModel') || '').trim() || 'google/gemini-2.0-flash-001'; }

export function setOpenRouterModel(model){ localStorage.setItem('awt_openrouterModel', (model||'').trim()); }

export function getAiProvider(){ return localStorage.getItem('awt_aiProvider') || 'gemini'; }

export function setAiProvider(p){ localStorage.setItem('awt_aiProvider', p==='openrouter' ? 'openrouter' : 'gemini'); }

export function activeProviderHasKey(){
  return getAiProvider()==='openrouter' ? !!getOpenRouterKey() : !!getApiKey();
}
// Not a login -- just a display name so notes, blockers, and stage moves
// show who did what. No password, nothing to verify, easy to skip or change.
