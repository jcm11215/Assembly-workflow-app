/**
 * Orchestrates the full action flow:
 *   parse -> resolve -> permission check -> validate -> [REVIEW] ->
 *   confirm -> execute -> audit log -> result
 *
 * Two-phase by design: proposeActions() does everything up to and
 * including validation and produces a human-readable preview, but
 * performs NO repository writes. Nothing executes until
 * confirmAndExecute() is called with that proposal's id -- this is the
 * "user confirms" requirement, not a UI nicety layered on top of it.
 */
import { uid } from '../utils/id.js';
import { parseUserIntent, ParseError } from './actionParser.js';
import { getTool } from './toolRegistry.js';
import { checkActionPermission } from './permissionAdapter.js';
import { logAiAction } from './actionAudit.js';

const proposals = new Map();   // proposalId -> { steps, prompt, createdAt }
const PROPOSAL_TTL_MS = 15 * 60 * 1000;   // stale proposals shouldn't execute against changed state

function sweepExpired(){
  const cutoff = Date.now() - PROPOSAL_TTL_MS;
  for(const [id, p] of proposals){ if(p.createdAt < cutoff) proposals.delete(id); }
}

/**
 * Phase 1: turn a request into a reviewable, NOT-YET-EXECUTED plan.
 * Every step already carries its resolved data, permission verdict, and
 * business-rule verdict -- the review card can show exactly what will
 * happen and why something is blocked, before anything runs.
 */
export async function proposeActions(userPrompt){
  sweepExpired();

  let parsed;
  try { parsed = await parseUserIntent(userPrompt); }
  catch (e) {
    if(e instanceof ParseError) return { ok:false, reason:'Could not understand that as an action.', detail:e.message };
    throw e;
  }

  if(parsed.unsupported.length && !parsed.actions.length){
    return { ok:false, reason: parsed.unsupported[0].reason || "That doesn't map to something I can do." };
  }
  if(parsed.errors.length && !parsed.actions.length){
    return { ok:false, reason:'Could not build a valid action from that request.', detail:parsed.errors.join(' ') };
  }

  const steps = [];
  for(const { action, params } of parsed.actions){
    const tool = getTool(action);
    const resolved = await tool.resolve(params);
    if(!resolved.ok){
      steps.push({ action, params, resolvedParams:params, blocked:true, reason:resolved.reason, preview:`${action}: ${resolved.reason}` });
      continue;
    }
    const { ok:_omit, ...resolvedData } = resolved;
    const permission = checkActionPermission(tool.permission, resolvedData);
    if(!permission.allowed){
      steps.push({ action, params, resolvedParams:params, resolvedData, blocked:true, reason:permission.reason,
                   preview: tool.preview({ params, ...resolvedData }) });
      continue;
    }
    const validation = tool.validate(resolvedData);
    if(!validation.ok){
      steps.push({ action, params, resolvedParams:params, resolvedData, blocked:true, reason:validation.reason,
                   preview: tool.preview({ params, ...resolvedData }) });
      continue;
    }
    steps.push({
      action, params, resolvedParams:params, resolvedData, blocked:false,
      mutates: tool.mutates,
      preview: tool.preview({ params, ...resolvedData })
    });
  }

  const proposalId = uid('act');
  proposals.set(proposalId, { steps, prompt:userPrompt, createdAt:Date.now() });

  return {
    ok: true,
    proposalId,
    steps: steps.map(s => ({ action:s.action, preview:s.preview, blocked:s.blocked, reason:s.reason||null, mutates:s.mutates })),
    unsupported: parsed.unsupported,
    allBlocked: steps.length>0 && steps.every(s=>s.blocked),
    anyBlocked: steps.some(s=>s.blocked)
  };
}

/**
 * Phase 2: execute a previously-proposed plan, step by step, in order.
 * Stops at the first failure -- a partially-applied multi-step action
 * (e.g. "start SC-4472" assigning and moving but not noting) is safer
 * than guessing whether to keep going, and the result reports exactly
 * how far it got.
 *
 * Permission and business-rule checks are re-run here, not trusted from
 * proposeActions() -- state (who's assigned, what's approved, whether a
 * checklist item got ticked by someone else) can change in the minutes
 * between proposing and confirming.
 */
export async function confirmAndExecute(proposalId){
  const proposal = proposals.get(proposalId);
  if(!proposal) return { ok:false, reason:'This proposal has expired or was already handled. Ask again.' };
  proposals.delete(proposalId);   // one-shot: a proposal can't be replayed

  const results = [];
  for(const step of proposal.steps){
    if(step.blocked){
      results.push({ action:step.action, ok:false, skipped:true, reason:step.reason });
      continue;
    }

    const tool = getTool(step.action);
    // Re-check permission and business rules against current state.
    const permission = checkActionPermission(tool.permission, step.resolvedData);
    if(!permission.allowed){
      results.push({ action:step.action, ok:false, reason:permission.reason });
      await logAiAction(step, { ok:false, error:new Error(permission.reason) }, proposal.prompt);
      break;
    }
    const revalidation = tool.validate(step.resolvedData);
    if(!revalidation.ok){
      results.push({ action:step.action, ok:false, reason:revalidation.reason });
      await logAiAction(step, { ok:false, error:new Error(revalidation.reason) }, proposal.prompt);
      break;
    }

    try {
      const runResult = await tool.run({ ...step.resolvedData, params:step.params });
      const entity = tool.entity ? tool.entity(runResult, step.resolvedData) : null;
      results.push({ action:step.action, ok:true, result:runResult, preview:step.preview });
      await logAiAction({ ...step, entity }, { ok:true, result:runResult }, proposal.prompt);
    } catch (err) {
      console.error('AI action execution failed', step.action, err);
      results.push({ action:step.action, ok:false, reason: err.message || 'Execution failed.' });
      await logAiAction(step, { ok:false, error:err }, proposal.prompt);
      break;   // stop the workflow rather than continue after an unknown failure
    }
  }

  const executedCount = results.filter(r=>r.ok).length;
  return {
    ok: executedCount === proposal.steps.length,
    partial: executedCount > 0 && executedCount < proposal.steps.length,
    executedCount, totalSteps: proposal.steps.length,
    results
  };
}

export function cancelProposal(proposalId){
  return proposals.delete(proposalId);
}

/** Test/diagnostic seam. */
export function _debugProposalCount(){ return proposals.size; }
