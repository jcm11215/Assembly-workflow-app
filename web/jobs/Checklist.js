/**
 * A stage's checklist: its procedure steps, each item a tick box showing
 * who ticked it. Parts tips for the step sit above its items.
 */
import { html, useState } from '../vendor/index.js';
import { PROCEDURE, STAGE_STEPS, checklistKey } from '../../shared/procedure.js';
import { setChecklistItem } from '../lib/actions.js';
import { useCan } from '../lib/permissions.js';
import { fmtWhen } from '../lib/format.js';
import { toastError } from '../ui/overlays.js';
import { tipsForStep } from '../domain/parts.js';
import { TipChips } from './Tips.js';
import { Icon } from '../ui/icons.js';

export function StageChecklist({ job, showTips = false }){
  const steps = STAGE_STEPS[job.stage] || [];
  if(!steps.length) return html`<p class="hint">This is a sign-off stage -- there is no checklist.</p>`;
  return html`${steps.map(step => html`<${Step} key=${step} job=${job} step=${step} showTips=${showTips} />`)}`;
}

function Step({ job, step, showTips }){
  const canWork = useCan('job.work');
  const [pending, setPending] = useState({});
  const { title, items } = PROCEDURE[step];
  const done = items.filter((_, i) => job.checklist[checklistKey(step, i)]).length;

  const toggle = async key => {
    if(!canWork || pending[key]) return;
    setPending(p => ({ ...p, [key]: true }));
    try { await setChecklistItem(job, key, !job.checklist[key]); }
    catch (e) { toastError(e); }
    finally { setPending(p => ({ ...p, [key]: false })); }
  };

  return html`
    <div class="check-step">
      <div class="check-step-head">
        <span>${title}</span>
        <span class=${`badge${done === items.length ? ' badge-done' : ''}`}>${done}/${items.length}</span>
      </div>
      ${showTips && html`<${TipChips} tips=${tipsForStep(step)} />`}
      ${items.map((text, i) => {
        const key = checklistKey(step, i);
        const tick = job.checklist[key];
        return html`
          <button key=${key} type="button" class=${`check-item${tick ? ' done' : ''}${pending[key] ? ' pending' : ''}`}
                  onClick=${() => toggle(key)} aria-pressed=${!!tick} disabled=${!canWork}>
            <span class="check-box">${tick && html`<${Icon} name="check" size=${15} />`}</span>
            <span class="check-text">
              ${text}
              ${tick && tick.by && html`<span class="check-by">${tick.by} · ${fmtWhen(tick.at)}</span>`}
            </span>
          </button>`;
      })}
    </div>`;
}
