/**
 * The assistant: ask about the shop, or ask it to do something. A request
 * to do something always comes back as a review card first; nothing
 * changes until Confirm.
 */
import { html, useEffect, useRef, useState } from '../vendor/index.js';
import { useStore, setState } from '../lib/store.js';
import { explainAiError } from '../lib/ai.js';
import { answer, propose, execute } from '../assistant/plan.js';
import { toast } from '../ui/overlays.js';

const QUICK = [
  'What should the team focus on today?',
  'Which jobs are at risk?',
  "Create today's shift summary.",
  'Generate a morning planning report.',
  'What hardware do we need to pull or order?'
];

// The conversation outlives switching tabs, not a reload.
let history = [];
let nextId = 1;

export function Assistant(){
  const ai = useStore(s => s.ai);
  const draft = useStore(s => s.assistantDraft);
  const [messages, setMessages] = useState(history);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const logRef = useRef(null);

  const update = fn => setMessages(prev => { history = fn(prev); return history; });
  const push = m => { const id = nextId++; update(list => [...list, { id, ...m }]); return id; };
  const patch = (id, change) => update(list => list.map(m => (m.id === id ? { ...m, ...change } : m)));

  useEffect(() => { logRef.current && logRef.current.scrollTo(0, logRef.current.scrollHeight); }, [messages]);

  // Another screen handed over a question ("Ask the assistant for a plan").
  useEffect(() => {
    if(!draft) return;
    setState({ assistantDraft: '' });
    ask(draft);
  }, [draft]);

  async function ask(text){
    text = (text ?? inputRef.current.value).trim();
    if(!text || busy) return;
    inputRef.current.value = '';
    push({ role: 'user', text });
    const id = push({ role: 'ai', loading: true, text: 'Thinking…' });
    setBusy(true);
    try {
      const { text: reply, substitution } = await answer(text);
      patch(id, { loading: false, text: reply, note: substitution ? `Answered by ${substitution.used}.` : null });
    } catch (e) {
      patch(id, { loading: false, error: true, text: explainAiError(e) });
    } finally { setBusy(false); }
  }

  async function doIt(){
    const text = inputRef.current.value.trim();
    if(!text || busy) return;
    inputRef.current.value = '';
    push({ role: 'user', text, action: true });
    const id = push({ role: 'ai', loading: true, text: 'Working out what to do…' });
    setBusy(true);
    try {
      const plan = await propose(text);
      patch(id, plan.error ? { loading: false, error: true, text: plan.error } : { loading: false, plan });
    } catch (e) {
      patch(id, { loading: false, error: true, text: explainAiError(e) });
    } finally { setBusy(false); }
  }

  async function confirm(msg){
    patch(msg.id, { state: 'running' });
    try {
      const outcome = await execute(msg.plan);
      patch(msg.id, { state: 'done', outcome });
    } catch (e) {
      patch(msg.id, { state: null });
      toast(e.message, { kind: 'error' });
    }
  }

  return html`
    <h2 class="screen-title">Assistant</h2>
    ${!ai.ready && html`<p class="error-text">The AI (${ai.label}) isn't set up yet. An admin can set it up in Settings.</p>`}
    <div class="quick">
      ${QUICK.map(q => html`<button key=${q} class="chip" disabled=${busy} onClick=${() => ask(q)}>${q}</button>`)}
    </div>
    <div class="chat" ref=${logRef}>
      ${!messages.length && html`<p class="hint">Ask about jobs, blockers and priorities -- or describe something to do, like
        "move 24-1050 to layout" or "report a blocker on 24-1050: gearbox not in", and tap Do it. You'll see exactly what
        will change before anything does.</p>`}
      ${messages.map(m => html`<${Message} key=${m.id} m=${m} onConfirm=${() => confirm(m)} onCancel=${() => patch(m.id, { state: 'cancelled' })} />`)}
    </div>
    <form class="chat-input" onSubmit=${e => { e.preventDefault(); ask(); }}>
      <input ref=${inputRef} placeholder="Ask about jobs, blockers, priorities…" aria-label="Message" disabled=${busy} />
      <button type="submit" class="btn" disabled=${busy}>Ask</button>
      <button type="button" class="btn btn-primary" disabled=${busy} onClick=${doIt}>Do it</button>
    </form>`;
}

function Message({ m, onConfirm, onCancel }){
  if(m.role === 'user') return html`<div class=${`msg msg-user${m.action ? ' msg-action' : ''}`}>${m.text}</div>`;
  if(m.loading) return html`<div class="msg msg-ai loading">${m.text}</div>`;
  if(m.error) return html`<div class="msg msg-ai msg-error">${m.text}</div>`;
  if(!m.plan){
    return html`
      <div class="msg msg-ai">
        <div class="msg-text">${m.text}</div>
        ${m.note && html`<div class="hint">${m.note}</div>`}
        <button class="link-btn" onClick=${() => navigator.clipboard?.writeText(m.text).then(() => toast('Copied.'))}>Copy</button>
      </div>`;
  }
  const { plan, state, outcome } = m;
  const blocked = plan.steps.filter(s => s.blocked).length;
  return html`
    <div class="msg msg-ai">
      <div class=${`plan ${outcome ? (outcome.complete ? 'plan-ok' : 'plan-warn') : blocked === plan.steps.length ? 'plan-bad' : blocked ? 'plan-warn' : 'plan-ok'}`}>
        <div class="plan-head">${outcome ? (outcome.complete ? 'Done' : `Stopped after ${outcome.done} of ${outcome.total}`)
          : !plan.runnable ? "Can't do this" : blocked ? 'Some steps are blocked' : 'Ready -- check and confirm'}</div>
        ${(outcome ? outcome.results : plan.steps).map((s, i) => html`
          <div key=${i} class=${`plan-step ${s.ok || (!outcome && !s.blocked) ? 'ok' : 'bad'}`}>
            ${outcome ? (s.ok ? '✓' : s.skipped ? '–' : '✕') : s.blocked ? '✕' : '•'} ${s.preview}
            ${(s.blocked || (outcome && !s.ok)) && s.reason && html`<div class="plan-reason">${s.reason}</div>`}
          </div>`)}
        ${plan.skipped.map((r, i) => html`<div key=${`sk${i}`} class="plan-step bad">– Skipped: ${r}</div>`)}
      </div>
      ${!state && plan.runnable && html`
        <div class="row-actions">
          <button class="btn btn-primary btn-sm" onClick=${onConfirm}>Confirm</button>
          <button class="btn btn-sm" onClick=${onCancel}>Cancel</button>
        </div>`}
      ${state === 'running' && html`<div class="hint">Running…</div>`}
      ${state === 'cancelled' && html`<div class="hint">Cancelled -- nothing was changed.</div>`}
    </div>`;
}
