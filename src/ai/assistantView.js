/** Assistant tab rendering, plus the AI Action Layer's review-and-confirm UI. */

import { QUICK_PROMPTS, sendChat } from './assistant.js';
import { activeProviderHasKey, getAiProvider } from './keys.js';
import { proposeActions, confirmAndExecute, cancelProposal } from './workflowExecutor.js';
import { requestRender as render } from '../app/bus.js';
import { state } from '../state/store.js';
import { escapeHtml } from '../utils/dom.js';
import { showToast } from '../ui/components/toast.js';

function actionProposalCardHtml(msg){
  if(msg.error){
    return `<div class="chat-msg ai"><div class="val-line vc-error">${escapeHtml(msg.error)}${msg.detail?` — ${escapeHtml(msg.detail)}`:''}</div></div>`;
  }
  const steps = msg.steps.map((s,i)=>`
    <div class="val-line ${s.blocked?'vc-error':'vc-ok'}">
      ${s.blocked?'&#10005;':'&#10003;'} ${escapeHtml(s.preview)}
      ${s.blocked?`<div style="font-size:11px;color:var(--text-faint);margin-left:18px;">${escapeHtml(s.reason||'')}</div>`:''}
    </div>`).join('');
  const unsupportedNote = (msg.unsupported||[]).map(u=>
    `<div class="val-line vc-warn">Skipped: ${escapeHtml(u.reason)}</div>`).join('');
  const canConfirm = !msg.allBlocked && !msg.resolved;

  return `
  <div class="chat-msg ai">
    <div class="val-box ${msg.allBlocked?'val-bad':msg.anyBlocked?'val-warn':'val-ok'}" style="margin-bottom:8px;">
      <div class="val-head">${msg.allBlocked?'Cannot proceed':msg.anyBlocked?'Some steps blocked':'Ready to run'}</div>
      ${steps}
      ${unsupportedNote}
    </div>
    ${canConfirm ? `
    <div class="fab-row">
      <button class="btn btn-primary btn-sm" data-action="confirm-ai-action" data-proposal-id="${msg.proposalId}">Confirm</button>
      <button class="btn btn-outline btn-sm" data-action="cancel-ai-action" data-proposal-id="${msg.proposalId}">Cancel</button>
    </div>` : ''}
    ${msg.resolved ? `<div class="bp-hint">${msg.resolved}</div>` : ''}
  </div>`;
}

function actionResultCardHtml(msg){
  // confirmAndExecute() returns {ok:false, reason} with no `results`
  // array when a proposal has expired or was already consumed --
  // render that as a plain message rather than crashing the whole tab.
  if(!Array.isArray(msg.results)){
    return `
    <div class="chat-msg ai">
      <div class="val-box val-bad">
        <div class="val-head">Could not run that</div>
        <div class="val-line vc-error">${escapeHtml(msg.reason || 'The request expired or was already handled. Ask again.')}</div>
      </div>
    </div>`;
  }
  const rows = msg.results.map(r=>`
    <div class="val-line ${r.ok?'vc-ok':'vc-error'}">
      ${r.ok?'&#10003;':(r.skipped?'&#8213;':'&#10005;')} ${escapeHtml(r.action)}${r.ok?'':`: ${escapeHtml(r.reason||'')}`}
    </div>`).join('');
  return `
  <div class="chat-msg ai">
    <div class="val-box ${msg.ok?'val-ok':msg.partial?'val-warn':'val-bad'}">
      <div class="val-head">${msg.ok?'Done':msg.partial?`Partially completed (${msg.executedCount}/${msg.totalSteps})`:'Failed'}</div>
      ${rows}
    </div>
  </div>`;
}

export function renderAssistant(){
  const chatHtml = state.chat.map((m,i)=>{
    if(m.role==='action-proposal') return actionProposalCardHtml(m);
    if(m.role==='action-result') return actionResultCardHtml(m);
    if(m.role==='ai'){
      return `<div class="chat-msg ai"><div>${escapeHtml(m.text)}</div><button class="copy-btn" data-action="copy-msg" data-index="${i}">Copy</button></div>`;
    }
    if(m.role==='ai loading'){
      return `<div class="chat-msg ai loading">${escapeHtml(m.text)}</div>`;
    }
    return `<div class="chat-msg user">${escapeHtml(m.text)}</div>`;
  }).join('');
  document.getElementById('content').innerHTML = `
    <div class="section-title">AI Assistant</div>
    ${!activeProviderHasKey() ? `<div class="focus-banner"><div class="focus-banner-head">Setup Needed</div><div style="font-size:13px;margin-bottom:10px;">Add an API key for ${getAiProvider()==='openrouter'?'OpenRouter':'Google Gemini'} to turn this on.</div><button class="btn btn-primary btn-sm" data-action="open-settings">Open Settings</button></div>` : ''}
    <div class="prompt-grid">
      ${QUICK_PROMPTS.map(p=>`<button data-action="quick-prompt" data-prompt="${escapeHtml(p)}">${escapeHtml(p)}</button>`).join('')}
    </div>
    <div class="chat-log" id="chatLog">${chatHtml}</div>
    <div class="bp-hint" style="margin:0 0 6px 0;">Ask a question, or describe something to do (e.g. "move SC-4472 to layout") and tap Do It to review and confirm before anything changes.</div>
    <div class="chat-input-row">
      <input type="text" id="chatInput" placeholder="Ask about jobs, blockers, priorities..." />
      <button class="btn btn-outline" data-action="send-chat">Ask</button>
      <button class="btn btn-primary" data-action="send-ai-action">Do It</button>
    </div>
  `;
  const log = document.getElementById('chatLog');
  if(log) log.scrollTop = log.scrollHeight;
}

export function goToAssistantWithPrompt(promptText){
  state.tab = 'assistant';
  render();
  window.scrollTo(0,0);
  sendChat(promptText);
}

/** "Do It" entry point -- entirely separate from sendChat()'s Q&A path.
 *  Nothing here executes anything; it only proposes and shows a review
 *  card. Execution happens exclusively in confirmProposedAction(). */
export async function sendActionRequest(promptTextArg){
  const input = document.getElementById('chatInput');
  const promptText = promptTextArg || (input ? input.value.trim() : '');
  if(!promptText) return;
  if(input) input.value = '';

  state.chat.push({ role:'user', text: promptText });
  state.chat.push({ role:'ai loading', text:'Working out what to do...' });
  render();

  try {
    const proposal = await proposeActions(promptText);
    state.chat.pop();   // remove the loading bubble
    if(!proposal.ok){
      state.chat.push({ role:'action-proposal', error: proposal.reason, detail: proposal.detail });
    } else {
      state.chat.push({ role:'action-proposal', ...proposal });
    }
  } catch (err) {
    state.chat.pop();
    state.chat.push({ role:'action-proposal', error: err.message || 'Something went wrong.' });
  }
  render();
}

export async function confirmProposedAction(proposalId){
  const msg = state.chat.find(m => m.role==='action-proposal' && m.proposalId===proposalId);
  if(msg) msg.resolved = 'Running...';
  render();
  try {
    const outcome = await confirmAndExecute(proposalId);
    if(msg) msg.resolved = null;
    state.chat.push({ role:'action-result', ...outcome });
  } catch (err) {
    if(msg) msg.resolved = null;
    showToast(`Could not complete that: ${err.message}`, 6000);
  }
  render();
}

export function cancelProposedAction(proposalId){
  cancelProposal(proposalId);
  const msg = state.chat.find(m => m.role==='action-proposal' && m.proposalId===proposalId);
  if(msg) msg.resolved = 'Cancelled -- nothing was changed.';
  render();
}
