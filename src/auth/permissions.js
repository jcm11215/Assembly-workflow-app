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

/**
 * Two tiers of assembler, because experience is the thing that decides
 * who may sign work off:
 *   assembler_a  experienced -- full assembly work, including sign-off
 *   assembler_b  trainee     -- same work, no sign-off into QC/Complete
 * 'assembler' is the pre-tier role, treated as experienced. 'lead' still
 * exists for older rows; the owner is an admin, so nobody is assigned it.
 */
export const ASSEMBLER_ROLES = ['assembler', 'assembler_a', 'assembler_b'];

/** Offered in the admin Team screen, in this order. */
export const ASSIGNABLE_ROLES = ['assembler_b', 'assembler_a', 'admin'];

const ROLE_META = {
  admin: {
    label: 'Admin',
    tag: 'role-admin',
    blurb: 'Runs the shop app: everything an experienced assembler can do, plus the team, the access code, editing and deleting any job, and the admin screens.'
  },
  lead: {
    label: 'Lead',
    tag: 'role-lead',
    blurb: 'Assigns and edits any job, resolves blockers, approves blueprints.'
  },
  assembler_a: {
    label: 'Assembler A',
    tag: 'role-a',
    blurb: 'Experienced. Works any job assigned to them, ticks off checklists, raises blockers, writes notes, and can sign a job through QC and Complete.'
  },
  assembler_b: {
    label: 'Assembler B',
    tag: 'role-b',
    blurb: 'Trainee. Same day-to-day work as Assembler A, but cannot sign a job into QC or Complete -- an experienced assembler or the lead does that.'
  },
  assembler: {
    label: 'Assembler (old)',
    tag: 'role-a',
    blurb: 'The single assembler role used before A/B tiers. Treated as Assembler A.'
  }
};

export function roleLabel(role){ return (ROLE_META[role] || {}).label || role || 'No role'; }
export function roleBlurb(role){ return (ROLE_META[role] || {}).blurb || ''; }
export function roleTagClass(role){ return (ROLE_META[role] || {}).tag || 'role-b'; }

export function currentRole(){
  if(!AUTH_ENABLED) return 'lead';   // legacy: unrestricted, same as today
  const p = getCachedProfile();
  return p ? p.role : null;          // null = signed in but no profile yet, or signed out
}

export function isAssembler(){ return ASSEMBLER_ROLES.includes(currentRole()); }
export function isTrainee(){ return currentRole() === 'assembler_b'; }
export function isLead(){ return currentRole() === 'lead'; }
export function isAdmin(){ return currentRole() === 'admin'; }
export function isLeadOrAdmin(){ return isLead() || isAdmin(); }
export function isSignedInRole(){ return !!currentRole(); }

/** Moving a job into a sign-off stage (QC, Complete) -- trainees may not. */
export function canSignOff(){ return !isTrainee(); }

/** Any authenticated role may attempt a stage move -- per-job scoping
 *  (assigned_to) and the checklist gate are enforced elsewhere (jobs/
 *  transitions.js client-side, the DB trigger server-side). */
export function canMoveStages(){ return isSignedInRole(); }

export function canAssignJobs(){ return isLeadOrAdmin(); }
export function canManageBlockers(){ return isLeadOrAdmin(); }
export function canApproveBlueprints(){ return isLeadOrAdmin(); }
export function canManageUsers(){ return isAdmin(); }

/**
 * Logging an error is deliberately open to everyone signed in -- an error
 * log the floor cannot write to is an empty one, and the person who hit
 * the problem is the one who knows what happened. Closing one out is a
 * lead's call, and deleting one an admin's, so a record cannot be quietly
 * walked back by whoever it reflects on. Mirrors the RLS on job_errors.
 */
export function canLogErrors(){ return isSignedInRole(); }
export function canCloseErrors(){ return isLeadOrAdmin(); }
export function canDeleteErrors(){ return isAdmin(); }
