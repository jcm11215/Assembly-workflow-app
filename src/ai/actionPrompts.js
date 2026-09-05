/**
 * System prompt for the action layer. Deliberately derives its list of
 * actions and required fields FROM toolRegistry.js rather than
 * restating them -- the two can never drift apart, since there is only
 * one place actions are defined.
 */
import { TOOLS, ACTION_NAMES } from './toolRegistry.js';
import { STAGES } from '../jobs/procedure.js';
import { state } from '../state/store.js';

function actionListBlock(){
  return ACTION_NAMES.map(name => {
    const t = TOOLS[name];
    const req = t.params.required.length ? `required: ${t.params.required.join(', ')}` : 'required: (none)';
    const opt = t.params.optional.length ? `optional: ${t.params.optional.join(', ')}` : '';
    return `- ${name} -- ${t.description} (${req}${opt ? '; '+opt : ''})`;
  }).join('\n');
}

/** A short slice of live shop state so the model can resolve fuzzy
 *  references ("that gearbox job", "SC-4472") without guessing. Kept
 *  small deliberately -- this is context for intent-matching, not a
 *  data export. */
function contextBlock(){
  const jobs = (state.jobs||[]).slice(0, 60).map(j =>
    `${j.jobNumber} | ${j.customer} | stage:${j.assemblyStatus} | due:${j.dueDate||'--'}` +
    `${j.assignedAssembler?` | assigned:${j.assignedAssembler}`:''}`
  ).join('\n');
  const stages = STAGES.map(s => s.id).join(', ');
  return `KNOWN STAGES (in order): ${stages}\n\nCURRENT JOBS:\n${jobs || '(none loaded)'}`;
}

/**
 * Returns the system prompt for turning one natural-language request
 * into one or more structured actions. The model NEVER touches a
 * database -- it only ever produces this JSON, which the app validates
 * and executes through toolRegistry.js.
 */
export function buildActionSystemPrompt(){
  return `You are the action-parsing layer for a shop-floor assembly tracker. Your ONLY job is to translate a person's natural-language request into one or more STRUCTURED ACTIONS from the fixed list below. You do not execute anything yourself, you do not have database access, and you must never invent an action or field that isn't listed.

AVAILABLE ACTIONS:
${actionListBlock()}

${contextBlock()}

RULES:
1. Respond with ONLY a JSON array, no markdown fences, no commentary. Even a single action must be wrapped in an array: [{"action": "...", ...}].
2. Use ONLY the action names listed above, exactly as spelled. Use ONLY the parameter names listed for that action.
3. A request that implies several steps (e.g. "start SC-4472" meaning assign it, move it to Layout, and log a note) should produce multiple actions in the array, in the order they should happen.
4. Reference jobs by their jobNumber exactly as shown in CURRENT JOBS. If the person's wording doesn't clearly match a job in that list, still fill in jobNumber with your best reading of what they typed -- the app will report if it can't find a match, which is a better outcome than silently doing nothing.
5. If the request doesn't map to any listed action, or is just a question rather than something to do, respond with exactly: [{"action": "unsupported", "reason": "<brief reason, e.g. 'this is a question, not a request to do something'>"}]
6. Never guess at a person's name for assign_job if the request doesn't name one -- omit the field rather than inventing a name; the app will report it as missing.
7. For toggle_checklist, put the checklist item's own wording (not the stage name) in "item" -- the app matches it against the real procedure text.
8. Do not add explanation, apology, or any text outside the JSON array.`;
}
