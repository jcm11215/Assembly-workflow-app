/**
 * Every job in a column for its stage. Arrows (or dragging, on a
 * computer) move a job; the same rules as everywhere else apply.
 */
import { html, useState } from '../vendor/index.js';
import { useStore } from '../lib/store.js';
import { STAGES, nextStage, prevStage } from '../../shared/procedure.js';
import { useCan } from '../lib/permissions.js';
import { jobLink } from '../lib/router.js';
import { openModal } from '../ui/overlays.js';
import { tryMove, advance, StagePicker } from '../jobs/stage.js';
import { dueStatus } from '../lib/jobs.js';

export function Board(){
  const jobs = useStore(s => s.jobs);
  const canWork = useCan('job.work');
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);

  const drop = stageId => {
    const job = jobs.find(j => j.id === dragId);
    setDragId(null); setOver(null);
    if(job && job.stage !== stageId) tryMove(job, stageId);
  };

  return html`
    <h2 class="screen-title">Assembly board</h2>
    <div class="board">
      ${STAGES.map(stage => {
        const col = jobs.filter(j => j.stage === stage.id);
        return html`
          <section key=${stage.id} class=${`board-col${over === stage.id ? ' drag-over' : ''}`}
                   onDragOver=${e => { if(dragId){ e.preventDefault(); setOver(stage.id); } }}
                   onDragLeave=${() => setOver(o => (o === stage.id ? null : o))}
                   onDrop=${e => { e.preventDefault(); drop(stage.id); }}>
            <header class="board-col-head"><span>${stage.label}</span><span class="count">${col.length}</span></header>
            <div class="board-col-body">
              ${col.length ? col.map(j => html`
                <div key=${j.id} class=${`board-card due-${dueStatus(j)}`} draggable=${canWork}
                     onDragStart=${e => { setDragId(j.id); e.dataTransfer.effectAllowed = 'move'; }}
                     onDragEnd=${() => { setDragId(null); setOver(null); }}>
                  <a class="board-card-link" href=${jobLink(j.id)}>
                    <b>${j.jobNumber}</b>
                    <span>${j.customer}</span>
                    <small>${j.assignedName || 'Unassigned'} · ${j.percentComplete}%</small>
                  </a>
                  ${canWork && html`
                    <div class="board-card-actions">
                      <button class="icon-btn" disabled=${!prevStage(j.stage)} onClick=${() => tryMove(j, prevStage(j.stage))} aria-label="Move back">←</button>
                      <button class="btn btn-sm" onClick=${() => openModal(StagePicker, { jobId: j.id })}>Move…</button>
                      <button class="icon-btn" disabled=${!nextStage(j.stage)} onClick=${() => advance(j)} aria-label="Move forward">→</button>
                    </div>`}
                </div>`) : html`<div class="board-empty">No jobs</div>`}
            </div>
          </section>`;
      })}
    </div>`;
}
