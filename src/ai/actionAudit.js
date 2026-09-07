/**
 * Logs every AI-executed action through the SAME activity log every
 * human action uses (db/repository.js's logActivity -> activityRepo ->
 * activity_log, actor/timestamp stamped server-side by the Phase 2
 * trigger). The only addition is `action_source:'ai'` inside detail,
 * plus enough of the original request to answer "why did this happen"
 * later -- the natural-language prompt, the resolved parameters, and
 * the outcome.
 */
import { logActivity } from '../db/repository.js';

const ACTION_LABELS = {
  create_job: 'Job created',
  update_job: 'Job updated',
  assign_job: 'Job assigned',
  move_stage: 'Stage moved',
  advance_stage: 'Stage advanced',
  toggle_checklist: 'Checklist item toggled',
  create_note: 'Note added',
  create_blocker: 'Blocker reported',
  resolve_blocker: 'Blocker resolved',
  approve_blueprint: 'Blueprint approved',
  reject_blueprint: 'Blueprint rejected',
  generate_pull_list: 'Pull list generated',
  generate_shift_report: 'Shift report generated'
};

/** Keeps the log entry small and free of large blobs (specs, images). */
function summarizeParams(params){
  const out = {};
  Object.entries(params || {}).forEach(([k, v]) => {
    if(v == null) return;
    if(typeof v === 'object'){ out[k] = Array.isArray(v) ? `[${v.length} items]` : '[object]'; return; }
    out[k] = String(v).slice(0, 200);
  });
  return out;
}

/**
 * `step` is one entry from a workflowExecutor proposal (has .action,
 * .resolvedParams, and the job/blocker/etc it resolved against).
 * `outcome` is {ok, result, error}.
 */
export async function logAiAction(step, outcome, originatingPrompt){
  const label = ACTION_LABELS[step.action] || `AI action: ${step.action}`;
  const detail = {
    action_source: 'ai',
    tool: step.action,
    params: summarizeParams(step.resolvedParams),
    ok: !!outcome.ok,
    ...(outcome.ok ? {} : { error: (outcome.error && outcome.error.message) || 'failed' }),
    ...(originatingPrompt ? { prompt: String(originatingPrompt).slice(0, 300) } : {})
  };
  const entity = step.entity || null;   // {type:'job', id} etc, set by toolRegistry when resolvable
  return logActivity(
    outcome.ok ? label : `${label} (failed)`,
    detail,
    entity
  );
}
