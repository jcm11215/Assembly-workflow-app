/**
 * Role-based permission helpers.
 *
 * Synchronous by design (reads the profile cache, no network) so the UI
 * can call these freely while rendering. These are advisory only in
 * Phase 5 -- the actual enforcement is the RLS policies and triggers
 * from Phase 2/6, which apply regardless of what this file returns.
 * Nothing here is wired into gating existing buttons yet; Phase 5's
 * brief is identity, not UI restriction, so today's workflows are
 * unchanged. These exist for the UI work that uses them later.
 *
 * In legacy mode (AUTH_ENABLED=false) every check resolves to "yes",
 * matching current behavior where anyone can do anything.
 */
import { AUTH_ENABLED } from './authService.js';
import { getCachedProfile } from './profileService.js';

export function currentRole(){
  if(!AUTH_ENABLED) return 'lead';   // legacy: unrestricted, same as today
  const p = getCachedProfile();
  return p ? p.role : null;          // null = signed in but no profile yet, or signed out
}

export function isAssembler(){ return currentRole() === 'assembler'; }
export function isLead(){ return currentRole() === 'lead'; }
export function isAdmin(){ return currentRole() === 'admin'; }
export function isLeadOrAdmin(){ return isLead() || isAdmin(); }
export function isSignedInRole(){ return !!currentRole(); }

/** Any authenticated role may attempt a stage move -- per-job scoping
 *  (assigned_to) and the checklist gate are enforced elsewhere (jobs/
 *  transitions.js client-side, the DB trigger server-side). */
export function canMoveStages(){ return isSignedInRole(); }

export function canAssignJobs(){ return isLeadOrAdmin(); }
export function canManageBlockers(){ return isLeadOrAdmin(); }
export function canApproveBlueprints(){ return isLeadOrAdmin(); }
export function canManageUsers(){ return isAdmin(); }
