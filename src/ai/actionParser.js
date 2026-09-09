/**
 * Natural language -> structured action(s).
 *
 * Calls the existing AI dispatch (ai/providers.js) with the action
 * system prompt, parses the JSON response, and rejects anything that
 * isn't a recognized action name with the exact required fields. This
 * is the ONLY validation actionParser does -- it has no opinion on
 * permissions or business rules, both of which belong to
 * permissionAdapter.js and toolRegistry.js respectively, run later in
 * the pipeline.
 */
import { callClaudeAPI } from './providers.js';
import { buildActionSystemPrompt } from './actionPrompts.js';
import { getTool, ACTION_NAMES } from './toolRegistry.js';

export class ParseError extends Error {
  constructor(message, raw){ super(message); this.name = 'ParseError'; this.raw = raw; }
}

function stripFences(text){
  return text.trim().replace(/^```json/i,'').replace(/^```/,'').replace(/```$/,'').trim();
}

/** Structural check only: right shape, known action, required fields
 *  present. Does not check whether the job/person named actually
 *  exists -- that's resolve()'s job, one step later, with fresher data
 *  than this parse necessarily has. */
function validateActionShape(entry, index){
  if(!entry || typeof entry !== 'object'){
    return { ok:false, error:`Action ${index}: not an object.` };
  }
  if(entry.action === 'unsupported'){
    return { ok:true, unsupported:true, reason: entry.reason || 'Not a supported action.' };
  }
  if(!ACTION_NAMES.includes(entry.action)){
    return { ok:false, error:`Action ${index}: "${entry.action}" is not a recognized action.` };
  }
  const tool = getTool(entry.action);
  const missing = tool.params.required.filter(p => entry[p] === undefined || entry[p] === null || entry[p] === '');
  if(missing.length){
    return { ok:false, error:`Action ${index} (${entry.action}): missing required field(s): ${missing.join(', ')}.` };
  }
  // Strip anything not in the tool's declared schema -- the model is
  // instructed not to invent fields, but this is the enforcement, not
  // the honor system.
  const allowed = new Set(['action', ...tool.params.required, ...tool.params.optional]);
  const params = {};
  Object.keys(entry).forEach(k => { if(allowed.has(k)) params[k] = entry[k]; });
  return { ok:true, action: entry.action, params };
}

/**
 * Parses one user request into zero or more structured actions.
 * Returns { actions: [{action, params}], unsupported: [{reason}], raw }.
 * Throws ParseError only if the model's output isn't valid JSON at all
 * -- a recognized-but-invalid action is reported per-entry instead, so
 * one bad step in a multi-step request doesn't discard the good ones.
 */
export async function parseUserIntent(userPrompt){
  const systemPrompt = buildActionSystemPrompt();
  const raw = await callClaudeAPI(systemPrompt, userPrompt);
  const cleaned = stripFences(raw);

  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch (e) { throw new ParseError('The model did not return valid JSON.', raw); }

  const list = Array.isArray(parsed) ? parsed : [parsed];
  if(!list.length) throw new ParseError('The model returned an empty action list.', raw);

  const actions = [];
  const unsupported = [];
  const errors = [];

  list.forEach((entry, i) => {
    const v = validateActionShape(entry, i);
    if(!v.ok){ errors.push(v.error); return; }
    if(v.unsupported){ unsupported.push({ reason: v.reason }); return; }
    actions.push({ action: v.action, params: v.params });
  });

  return { actions, unsupported, errors, raw };
}
