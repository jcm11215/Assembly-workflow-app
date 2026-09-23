/**
 * Turning a request into actions, in two steps with a person in between:
 *
 *   propose(request)  AI -> JSON -> checked against the tool list ->
 *                     each step resolved, permission- and rule-checked,
 *                     with a one-line preview. Nothing is written.
 *   execute(plan)     runs the steps in order, re-checking each against
 *                     the data as it is now, stopping at the first failure.
 *
 * The AI only ever produces the JSON. It never touches data.
 */
import { askAI } from '../lib/ai.js';
import { getState } from '../lib/store.js';
import { logActivity } from '../lib/actions.js';
import { can } from '../../shared/roles.js';
import { STAGES, stageLabel } from '../../shared/procedure.js';
import { todayISO } from '../../shared/dates.js';
import { dueStatus, DUE_LABEL } from '../lib/jobs.js';
import { TOOLS, TOOL_NAMES, permissionFor } from './tools.js';

/* ---------------- questions ---------------- */

/** The shop as text, for answering questions about it. */
export function shopContext(state){
  const jobs = state.jobs.map(j => {
    const parts = j.blueprint && j.blueprint.components.length
      ? ` | parts: ${j.blueprint.components.map(c => `${c.quantity ? `${c.quantity}x ` : ''}${c.item}${c.specification ? ` (${c.specification})` : ''}`).join(', ')}`
      : '';
    return `- ${j.jobNumber} | ${j.customer} | stage: ${stageLabel(j.stage)} | priority: ${j.priority} | ${j.percentComplete}% | due: ${j.dueDate || 'none'} (${DUE_LABEL[dueStatus(j)]}) | lead: ${j.assignedName || 'unassigned'}${parts}`;
  }).join('\n') || 'None';
  const blockers = state.blockers.filter(b => b.status !== 'Resolved')
    .map(b => `- ${b.jobNumber} | ${b.severity} | ${b.department} | reported ${b.reportedOn} | ${b.issue} | ${b.status}`).join('\n') || 'None';
  const notes = state.notes.slice(0, 25).map(n => `- [${n.date}] ${n.jobNumber || 'Shop-wide'} (${n.type}): ${n.body}`).join('\n') || 'None';
  const errors = state.errors.filter(e => e.status !== 'Corrected').slice(0, 25)
    .map(e => `- ${e.jobNumber} | ${e.department} | ${e.description}`).join('\n') || 'None';
  return `Today's date: ${todayISO()}\n\nJOBS:\n${jobs}\n\nOPEN BLOCKERS:\n${blockers}\n\nOPEN ERRORS:\n${errors}\n\nRECENT NOTES:\n${notes}`;
}

export async function answer(question){
  const system = 'You are the assistant in the "Assembly Workflow Tracker", used by the assemblers and lead of a screw conveyor ' +
    'manufacturing shop. Answer from the shop data below. Be concise and practical: short paragraphs or bullets, name job numbers, ' +
    'and rank priorities by overdue status, priority and open blockers. When the shop\'s knowledge base is quoted below, use it and name the document. For a shift summary or planning report, use short headers ' +
    'and end with an action list. Do not repeat the raw data back.\n\n' + shopContext(getState());
  const { text, substitution, sources, knowledgeNote } = await askAI(system, question, { knowledge: question });
  return { text: text || 'No answer came back. Try again.', substitution, sources, knowledgeNote };
}

/* ---------------- actions ---------------- */

function actionPrompt(state){
  const list = TOOL_NAMES.map(name => {
    const t = TOOLS[name];
    const opt = t.params.optional.length ? `; optional: ${t.params.optional.join(', ')}` : '';
    return `- ${name} -- ${t.description} (required: ${t.params.required.join(', ') || '(none)'}${opt})`;
  }).join('\n');
  const jobs = state.jobs.slice(0, 80).map(j => `${j.jobNumber} | ${j.customer} | stage:${j.stage} | due:${j.dueDate || '--'}`).join('\n');
  const people = state.team.filter(u => u.active).map(u => u.fullName).join(', ');
  return `You translate a request from a shop-floor assembly tracker into STRUCTURED ACTIONS from the fixed list below. You do not execute anything and must never invent an action or field.

AVAILABLE ACTIONS:
${list}

STAGES (in order): ${STAGES.map(s => s.id).join(', ')}
TEAM: ${people || '(none)'}
CURRENT JOBS:
${jobs || '(none)'}

RULES:
1. Reply with ONLY a JSON array, no markdown, no commentary: [{"action": "...", ...}], even for one action.
2. Use only the action and parameter names listed above, spelled exactly.
3. A request implying several steps produces several actions, in the order they should happen.
4. Use job numbers as shown in CURRENT JOBS; if unsure, write your best reading of what was typed -- the app reports a miss.
5. If the request is a question or matches no action, reply exactly: [{"action": "unsupported", "reason": "<brief reason>"}]
6. Never guess a person's name; leave the field out if none is given.
7. For toggle_checklist, put the checklist item's own wording in "item", not the stage name.`;
}

function stripFences(text){
  return String(text || '').trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
}

/** Checks the AI's JSON: known actions, required fields, nothing extra. */
export function parseActions(text){
  let list;
  try { list = JSON.parse(stripFences(text)); }
  catch { return { error: "The AI's answer wasn't something I could act on. Try rewording it." }; }
  list = Array.isArray(list) ? list : [list];
  const steps = [], skipped = [];
  list.forEach((entry, i) => {
    if(!entry || typeof entry !== 'object'){ skipped.push(`Step ${i + 1} was not an action.`); return; }
    if(entry.action === 'unsupported'){ skipped.push(entry.reason || "That isn't something I can do."); return; }
    const tool = TOOLS[entry.action];
    if(!tool){ skipped.push(`"${entry.action}" isn't something I can do.`); return; }
    const missing = tool.params.required.filter(k => entry[k] == null || entry[k] === '');
    if(missing.length){ skipped.push(`${entry.action}: missing ${missing.join(', ')}.`); return; }
    const params = {};
    for(const k of [...tool.params.required, ...tool.params.optional]) if(entry[k] !== undefined) params[k] = entry[k];
    steps.push({ action: entry.action, params });
  });
  return { steps, skipped };
}

/** One step, resolved and checked against the data as it is now. */
function prepare(step, state){
  const tool = TOOLS[step.action];
  const resolved = tool.resolve(step.params, state);
  if(!resolved.ok) return { ...step, blocked: true, reason: resolved.reason, preview: `${step.action}: ${resolved.reason}` };
  const preview = tool.preview(resolved);
  const perm = permissionFor(tool, step.params);
  if(!can(state.me.role, perm)) return { ...step, resolved, preview, blocked: true, reason: 'Your role cannot do this.' };
  const rule = tool.check ? tool.check(resolved, state.me) : { ok: true };
  if(!rule.ok) return { ...step, resolved, preview, blocked: true, reason: rule.reason };
  return { ...step, resolved, preview, blocked: false };
}

export async function propose(request){
  const state = getState();
  const { text } = await askAI(actionPrompt(state), request);
  const parsed = parseActions(text);
  if(parsed.error) return { error: parsed.error };
  if(!parsed.steps.length) return { error: parsed.skipped[0] || "That isn't something I can do." };
  const steps = parsed.steps.map(s => prepare(s, state));
  return { request, steps, skipped: parsed.skipped, runnable: steps.some(s => !s.blocked) };
}

export async function execute(plan){
  const results = [];
  for(const step of plan.steps){
    if(step.blocked){ results.push({ preview: step.preview, ok: false, skipped: true, reason: step.reason }); continue; }
    // Re-checked now: the data can change in the minute between the
    // review card and the tap on Confirm.
    const fresh = prepare(step, getState());
    if(fresh.blocked){ results.push({ preview: step.preview, ok: false, reason: fresh.reason }); break; }
    try {
      await TOOLS[step.action].run(fresh.resolved);
      results.push({ preview: fresh.preview, ok: true });
      logActivity('Assistant action', { text: fresh.preview, request: plan.request.slice(0, 300), tool: step.action });
    } catch (e) {
      results.push({ preview: fresh.preview, ok: false, reason: e.message });
      break;
    }
  }
  const done = results.filter(r => r.ok).length;
  const runnable = plan.steps.filter(s => !s.blocked).length;
  return { results, done, total: plan.steps.length, complete: done === runnable && runnable > 0 };
}
