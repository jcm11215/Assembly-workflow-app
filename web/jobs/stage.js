/**
 * Moving jobs between stages from anywhere in the app: the Advance
 * button, the board's arrows and drag-and-drop, and the "Move to…"
 * picker all come through here.
 *
 * The rule (shared/procedure.js) is checked first so a refusal is
 * explained without a round trip; the server checks it again for real.
 * Advancing with the checklist unfinished opens the checklist instead of
 * just refusing, so the person lands where they can finish it.
 */
import { html } from '../vendor/index.js';
import { getState, useStore } from '../lib/store.js';
import { moveStage } from '../lib/actions.js';
import { checkStageMove, nextStage, stageLabel, STAGES } from '../../shared/procedure.js';
import { openModal, Sheet, toast, toastError } from '../ui/overlays.js';
import { StageChecklist } from './Checklist.js';

export async function tryMove(job, to){
  const verdict = checkStageMove(job, to, getState().me.role);
  if(!verdict.ok){
    if(verdict.code === 'checklist') openModal(StageGate, { jobId: job.id });
    else if(verdict.code !== 'same_stage') toast(verdict.reason, { ms: 5000 });
    return false;
  }
  try {
    const moved = await moveStage(job, to);
    toast(`${moved.jobNumber} → ${stageLabel(moved.stage)}`, { kind: 'ok' });
    return true;
  } catch (e) {
    toastError(e);
    return false;
  }
}

export function advance(job){
  const to = nextStage(job.stage);
  if(!to){ toast('Already at the final stage.'); return Promise.resolve(false); }
  return tryMove(job, to);
}

/** The current stage's checklist, with an Advance button that lights up
 *  once every item is ticked. */
function StageGate({ jobId, close }){
  const job = useStore(s => s.jobs.find(j => j.id === jobId));
  if(!job) return null;
  const to = nextStage(job.stage);
  const ready = checkStageMove(job, to, 'assembler').ok;
  return html`
    <${Sheet} title=${`${stageLabel(job.stage)} · ${job.jobNumber}`} close=${close}>
      <p class="hint">Finish this stage's checklist to move ${job.jobNumber} on to ${stageLabel(to)}.</p>
      <${StageChecklist} job=${job} />
      <button class="btn btn-primary btn-block" disabled=${!ready}
              onClick=${async () => { if(await tryMove(job, to)) close(); }}>
        ${ready ? `Advance to ${stageLabel(to)}` : 'Tick every item to advance'}
      </button>
    <//>`;
}

/** Pick any stage. Forward moves still go one step at a time. */
export function StagePicker({ jobId, close }){
  const job = useStore(s => s.jobs.find(j => j.id === jobId));
  if(!job) return null;
  return html`
    <${Sheet} title=${`Move ${job.jobNumber}`} close=${close} small>
      <div class="stage-picker">
        ${STAGES.map(s => html`
          <button key=${s.id} class=${`btn${s.id === job.stage ? ' current' : ''}`} disabled=${s.id === job.stage}
                  onClick=${async () => { if(await tryMove(job, s.id)) close(); }}>
            ${s.label}${s.id === job.stage ? ' (now)' : ''}
          </button>`)}
      </div>
    <//>`;
}
