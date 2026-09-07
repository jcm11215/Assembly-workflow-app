/**
 * Stage transition validation -- the single source of truth for whether a
 * job may change stage. validateStageTransition() is PURE (no DOM, no
 * state mutation, no I/O) and reads only fields that exist as database
 * columns, so the identical rules transfer to a Postgres trigger.
 */


//    ================================================================
import { STAGES, stageChecklistProgress, stageLabel } from './procedure.js';

export const TRANSITION = {
  OK:            'OK',
  SAME_STAGE:    'SAME_STAGE',
  UNKNOWN_STAGE: 'UNKNOWN_STAGE',
  NO_JOB:        'NO_JOB',
  CHECKLIST_INCOMPLETE: 'CHECKLIST_INCOMPLETE',
  SKIPS_STAGES:  'SKIPS_STAGES',
  ROLE_DENIED:   'ROLE_DENIED'
};

// Forward moves require the CURRENT stage's checklist to be complete, and
// may only advance one stage at a time. Backward moves are always allowed
// (correcting a mistake must never be blocked). Both directions are
// validated here -- there is no unchecked path.

// Forward moves require the CURRENT stage's checklist to be complete, and
// may only advance one stage at a time. Backward moves are always allowed
// (correcting a mistake must never be blocked). Both directions are
// validated here -- there is no unchecked path.
export function validateStageTransition(job, toStageId, opts){
  opts = opts || {};
  if(!job) return { allowed:false, reason:'Job not found.', code:TRANSITION.NO_JOB };

  const fromIdx = STAGES.findIndex(s=>s.id===job.assemblyStatus);
  const toIdx   = STAGES.findIndex(s=>s.id===toStageId);
  if(toIdx < 0)   return { allowed:false, reason:`Unknown stage "${toStageId}".`, code:TRANSITION.UNKNOWN_STAGE };
  if(fromIdx < 0) return { allowed:false, reason:`Job is in an unknown stage.`, code:TRANSITION.UNKNOWN_STAGE };
  if(fromIdx === toIdx) return { allowed:false, reason:'Job is already in that stage.', code:TRANSITION.SAME_STAGE };

  // Backward / corrective moves: always permitted.
  if(toIdx < fromIdx) return { allowed:true, reason:null, code:TRANSITION.OK };

  // Forward moves may not skip stages.
  if(toIdx > fromIdx + 1){
    return {
      allowed:false,
      code:TRANSITION.SKIPS_STAGES,
      reason:`Cannot skip from ${stageLabel(job.assemblyStatus)} to ${stageLabel(toStageId)}. Advance one stage at a time.`
    };
  }

  // Forward by one: the current stage's checklist must be complete.
  const { done, total } = stageChecklistProgress(job, job.assemblyStatus);
  if(total > 0 && done < total){
    return {
      allowed:false,
      code:TRANSITION.CHECKLIST_INCOMPLETE,
      reason:`${stageLabel(job.assemblyStatus)} checklist is ${done}/${total} complete.`,
      progress:{ done, total }
    };
  }
  return { allowed:true, reason:null, code:TRANSITION.OK };
}

// The ONLY function permitted to mutate job.assemblyStatus. Every caller
// -- arrows, Advance button, Move... picker, drag-and-drop -- goes
// through here, and it refuses anything validateStageTransition() denies.
