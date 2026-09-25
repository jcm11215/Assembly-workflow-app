/**
 * Jobs in a column for their stage. Arrows (or dragging, on a computer)
 * move a job; the same rules as everywhere else apply.
 */
import { html, useState } from '../vendor/index.js';
import { STAGES, nextStage, prevStage } from '../../shared/procedure.js';
import { useCan } from '../lib/permissions.js';
import { jobLink } from '../lib/router.js';
import { fmtDue } from '../lib/format.js';
import { Icon } from '../ui/icons.js';
import { tryMove, advance } from '../jobs/stage.js';
import { dueStatus } from '../lib/jobs.js';

export function Board({ jobs }){
  const canWork = useCan('job.work');
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);

  const drop = stageId => {
    const job = jobs.find(j => j.id === dragId);
    setDragId(null); setOver(null);
    if(job && job.stage !== stageId) tryMove(job, stageId);
  };

  return html`
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
              ${col.length ? col.map(j => {
                const status = dueStatus(j);
                return html`
                  <div key=${j.id} class="board-card" draggable=${canWork}
                       onDragStart=${e => { setDragId(j.id); e.dataTransfer.effectAllowed = 'move'; }}
                       onDragEnd=${() => { setDragId(null); setOver(null); }}>
                    <a class="board-card-link" href=${jobLink(j.id)}>
                      <b>${j.jobNumber}</b>
                      <span>${j.customer}</span>
                    </a>
                    <div class="board-card-foot">
                      ${j.dueDate && status !== 'ok'
                        ? html`<span class=${`due-tag due-${status}`}>${status === 'complete' ? 'Complete' : fmtDue(j.dueDate)}</span>`
                        : html`<span class="hint" style=${{ fontSize: '12.5px' }}>${j.assignedName || 'Unassigned'}</span>`}
                      ${canWork && html`
                        <div class="board-card-actions">
                          <button class="icon-btn" disabled=${!prevStage(j.stage)} onClick=${() => tryMove(j, prevStage(j.stage))} aria-label="Move back"><${Icon} name="left" size=${18} /></button>
                          <button class="icon-btn" disabled=${!nextStage(j.stage)} onClick=${() => advance(j)} aria-label="Move forward"><${Icon} name="right" size=${18} /></button>
                        </div>`}
                    </div>
                  </div>`;
              }) : html`<div class="board-empty">No jobs</div>`}
            </div>
          </section>`;
      })}
    </div>`;
}
