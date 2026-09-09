/** Shop-floor AI assistant: context assembly + chat. */


/* ================= ASSISTANT ================= */
import { requestRender } from '../app/bus.js';
import { explainFetchError } from './errors.js';
import { callClaudeAPI } from './providers.js';
import { stageLabel } from '../jobs/procedure.js';
import { dueStatus, dueStatusLabel } from '../jobs/selectors.js';
import { state } from '../state/store.js';
import { todayISO } from '../utils/date.js';

export const QUICK_PROMPTS = [
  'What should the team focus on today?',
  'Which jobs are at risk?',
  "Create today's shift summary.",
  'Generate a morning planning report.',
  'What hardware or components do we need to pull or order?'
];

export function buildContext(){
  const jobs = state.jobs.map(j=>{
    const bom = (j.billOfMaterials && j.billOfMaterials.length)
      ? ` | hardware needed: ${j.billOfMaterials.map(c=>`${c.quantity?c.quantity+'x ':''}${c.item}${c.specification?' ('+c.specification+')':''}`).join(', ')}`
      : '';
    return `- ${j.jobNumber} | ${j.customer} | stage: ${stageLabel(j.assemblyStatus)} | priority: ${j.priority} | ${j.percentComplete}% complete | due: ${j.dueDate} (${dueStatusLabel(dueStatus(j))}) | assembler: ${j.assignedAssembler||'Unassigned'}${bom}`;
  }).join('\n');
  const blockers = state.blockers.filter(b=>b.status!=='Resolved').map(b=>`- ${b.jobNumber} | ${b.severity} | ${b.responsibleDepartment} | reported ${b.dateReported} | ${b.issueDescription} | status: ${b.status}`).join('\n') || 'None';
  const notes = state.notes.slice().sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,25)
    .map(n=>`- [${n.date}] ${n.jobNumber||'General'} (${n.noteType}): ${n.notes}`).join('\n') || 'None';
  return `Today's date: ${todayISO()}\n\nJOBS:\n${jobs}\n\nOPEN BLOCKERS:\n${blockers}\n\nRECENT DAILY NOTES:\n${notes}`;
}

export async function sendChat(promptText){
  const inputEl = document.getElementById('chatInput');
  const text = (promptText || (inputEl ? inputEl.value : '') || '').trim();
  if(!text) return;
  state.chat.push({role:'user', text});
  state.chat.push({role:'ai loading', text:'Thinking...'});
  requestRender();
  const input = document.getElementById('chatInput');
  if(input) input.value='';

  const systemPrompt = `You are the AI assistant embedded in the "Assembly Workflow Tracker" app, used by an Assembly Lead and Assemblers in a screw conveyor manufacturing shop. Use the shop data provided below to answer the user's question. Be concise, practical, and shop-floor-focused: use short paragraphs or bullet points, always reference specific job numbers when relevant, and rank priorities by a mix of overdue status, priority level, and open blockers. When asked for a shift summary or planning report, structure the answer with clear short headers and an action list. Avoid filler and avoid repeating the raw data back verbatim.\n\n${buildContext()}`;

  try{
    const reply = await callClaudeAPI(systemPrompt, text);
    state.chat.pop();
    state.chat.push({role:'ai', text: reply || 'No response received. Please try again.'});
  }catch(e){
    console.error(e);
    state.chat.pop();
    state.chat.push({role:'ai', text: explainFetchError(e)});
  }
  requestRender();
}

/* ================= FORMS ================= */
