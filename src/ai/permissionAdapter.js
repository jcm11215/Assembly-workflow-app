/**
 * Bridges toolRegistry's declared permission requirement to the
 * existing role system (auth/permissions.js). Adds one thing that
 * generic role checks don't cover: for assembler-scoped actions, the
 * job must actually be assigned to the acting user -- the same rule
 * RLS enforces server-side (jobs_update_assigned policy), checked here
 * too so the AI gets a clear rejection instead of a wasted round trip.
 */
import {
  currentRole, isLeadOrAdmin, isSignedInRole, isAdmin,
  canAssignJobs, canManageBlockers, canApproveBlueprints, canManageUsers
} from '../auth/permissions.js';
import { AUTH_ENABLED, currentActorId } from '../auth/authService.js';

export const PERMISSION = {
  ANY_SIGNED_IN: 'any_signed_in',
  ASSIGNED_OR_LEAD: 'assigned_or_lead',   // assembler: only their own assigned job
  LEAD_OR_ADMIN: 'lead_or_admin',
  ADMIN_ONLY: 'admin_only',
  PROGRESS_ONLY_OR_LEAD: 'progress_only_or_lead'   // update_job's field-scoped rule
};

/**
 * `resolved` carries whatever the action already resolved (e.g. the job
 * object), so the assignment check can compare against it. Returns
 * {allowed, reason} -- never throws, so callers can show the reason in
 * the review card rather than a stack trace.
 */
export function checkActionPermission(requirement, resolved){
  switch(requirement){
    case PERMISSION.ANY_SIGNED_IN:
      return isSignedInRole()
        ? { allowed:true }
        : { allowed:false, reason:'Sign in required.' };

    case PERMISSION.ASSIGNED_OR_LEAD: {
      if(isLeadOrAdmin()) return { allowed:true };
      if(currentRole() !== 'assembler') return { allowed:false, reason:'Sign in required.' };
      const job = resolved && resolved.job;
      if(!job) return { allowed:false, reason:'Job not found.' };
      // Legacy mode has no real actor id to compare -- fall back to
      // allowing it, matching every other action's legacy-mode behavior
      // (Phase 5: AUTH_ENABLED=false means "everyone can do everything").
      if(!AUTH_ENABLED) return { allowed:true };
      const mine = job.assignedTo && job.assignedTo === currentActorId();
      return mine
        ? { allowed:true }
        : { allowed:false, reason:`This job is not assigned to you. Ask a lead to reassign it or make this change.` };
    }

    case PERMISSION.PROGRESS_ONLY_OR_LEAD: {
      if(isLeadOrAdmin()) return { allowed:true };
      if(currentRole() !== 'assembler') return { allowed:false, reason:'Sign in required.' };
      const fields = (resolved && resolved.changedFields) || [];
      const onlyProgress = fields.every(f => f === 'percentComplete');
      if(!onlyProgress){
        return { allowed:false, reason:`Assemblers can only update progress -- ${fields.filter(f=>f!=='percentComplete').join(', ')} requires a lead.` };
      }
      return checkActionPermission(PERMISSION.ASSIGNED_OR_LEAD, resolved);
    }

    case PERMISSION.LEAD_OR_ADMIN:
      return isLeadOrAdmin() ? { allowed:true } : { allowed:false, reason:'This action requires a lead or admin.' };

    case PERMISSION.ADMIN_ONLY:
      return isAdmin() ? { allowed:true } : { allowed:false, reason:'This action requires an admin.' };

    default:
      return { allowed:false, reason:`Unknown permission requirement: ${requirement}` };
  }
}

// Re-exported so toolRegistry.js has one import surface for both the
// requirement constants and the underlying role predicates it may want
// for descriptive text (e.g. "as a lead, you can...").
export { canAssignJobs, canManageBlockers, canApproveBlueprints, canManageUsers, isLeadOrAdmin, isAdmin };
