/**
 * Device-local identity. Not authentication -- a display name used for
 * attribution. Phase 5 replaces this with Supabase Auth; every consumer
 * already imports from here so the swap is contained.
 */

// Not a login -- just a display name so notes, blockers, and stage moves
// show who did what. No password, nothing to verify, easy to skip or change.
export function getUserName(){ return (localStorage.getItem('awt_username') || '').trim(); }

export function setUserName(name){ localStorage.setItem('awt_username', (name||'').trim()); }
