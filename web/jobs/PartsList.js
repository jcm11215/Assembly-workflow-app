/**
 * The parts a scan found, grouped by where they go. Admins can switch to
 * editing: fix a category, reorder within a group, remove a part, or add
 * one the scan missed.
 */
import { html, useState } from '../vendor/index.js';
import { PART_GROUPS, partGroup, tipForPart } from '../domain/parts.js';
import { addComponent, updateComponent, deleteComponent, reorderComponents } from '../lib/actions.js';
import { useCan } from '../lib/permissions.js';
import { fmtWhen } from '../lib/format.js';
import { toastError } from '../ui/overlays.js';
import { submitting } from '../ui/kit.js';
import { TipCard } from './Tips.js';

export function PartsList({ job }){
  const bp = job.blueprint;
  const canEdit = useCan('blueprint.manage');
  const [editing, setEditing] = useState(false);
  const parts = bp ? bp.components : [];
  if(!bp) return null;

  const anyPlaced = parts.some(c => c.position);
  const groups = PART_GROUPS.map(g => ({ ...g, parts: parts.filter(c => partGroup(c).id === g.id) }))
    .filter(g => editing || g.parts.length);

  const run = fn => fn().catch(toastError);

  /** Swaps a part with its neighbour inside its group, then saves the
   *  whole list's order in one request. */
  const move = (group, index, delta) => run(async () => {
    const swapped = group.parts.slice();
    [swapped[index], swapped[index + delta]] = [swapped[index + delta], swapped[index]];
    const order = PART_GROUPS.flatMap(g => (g.id === group.id ? swapped : parts.filter(c => partGroup(c).id === g.id)));
    await reorderComponents(bp.id, order.map(c => c.id));
  });

  return html`
    <div class="parts">
      <div class="parts-head">
        <div>
          <b>Parts from the drawing</b> <span class="count">${parts.length}</span>
          <div class="hint">Scan ${bp.version}${bp.extractedByName ? ` by ${bp.extractedByName}` : ''} · ${fmtWhen(bp.extractedAt)}</div>
        </div>
        ${canEdit && html`<button class="btn btn-sm" onClick=${() => setEditing(!editing)}>${editing ? 'Done' : 'Edit parts'}</button>`}
      </div>
      ${editing && html`<p class="hint">The scanner doesn't always get it right -- fix, reorder, remove or add anything here.</p>`}
      ${!parts.length && !editing && html`<p class="hint">
        The drawing is attached, but the scan didn't find any parts on it. Re-scanning often works on a second try;
        otherwise an admin can add them by hand with Edit parts.</p>`}
      ${groups.map(g => html`
        <div key=${g.id} class="parts-group">
          <div class="parts-group-head"><span class="swatch" style=${{ background: g.color }}></span>${g.label} <span class="count">${g.parts.length}</span></div>
          ${g.parts.map((c, i) => html`
            <${PartRow} key=${c.id} part=${c} anyPlaced=${anyPlaced} editing=${editing}
                        first=${i === 0} last=${i === g.parts.length - 1}
                        onUp=${() => move(g, i, -1)} onDown=${() => move(g, i, 1)}
                        onRemove=${() => run(() => deleteComponent(c.id))}
                        onRegroup=${stage => run(() => updateComponent(c.id, { stage }))} />`)}
          ${editing && html`
            <form class="part-add" onSubmit=${submitting(async (f, form) => {
              await addComponent(bp.id, { item: f.item, specification: f.specification, quantity: f.quantity || null, stage: g.stage });
              form.reset();
            })}>
              <input name="item" placeholder="Part name" required />
              <input name="specification" placeholder="Spec (optional)" />
              <input name="quantity" type="number" min="0" step="any" placeholder="Qty" class="qty" />
              <button type="submit" class="btn btn-primary btn-sm">Add</button>
            </form>`}
        </div>`)}
    </div>`;
}

function PartRow({ part: c, anyPlaced, editing, first, last, onUp, onDown, onRemove, onRegroup }){
  const [tipOpen, setTipOpen] = useState(false);
  const tip = editing ? null : tipForPart(c);
  const drawn = (c.item_as_drawn || '').trim();
  const showDrawn = drawn && drawn.toLowerCase().replace(/\s+/g, ' ') !== c.item.toLowerCase().replace(/\s+/g, ' ');
  return html`
    <div class="part">
      <div class="part-main">
        <div class="part-item">
          ${c.item}
          ${c.extraction_method === 'manual' && html` <span class="tag">added by hand</span>`}
          ${anyPlaced && !c.position && c.extraction_method !== 'manual' &&
            html` <span class="tag" title="In the parts list, but not called out on any view">not shown on the drawing</span>`}
        </div>
        ${showDrawn && html`<div class="part-drawn" title="Exactly as written on the drawing">${drawn}</div>`}
        ${c.specification && html`<div class="part-spec">${c.specification}</div>`}
        ${c.part_number && html`<div class="part-pn">PN ${c.part_number}</div>`}
        <div class="part-qty">Qty: ${c.quantity ?? '--'}</div>
        ${editing && html`
          <select class="part-group-select" aria-label="Category" onChange=${e => onRegroup(e.currentTarget.value)}>
            ${PART_GROUPS.map(g => html`<option key=${g.id} value=${g.stage} selected=${partGroup(c).id === g.id}>${g.label}</option>`)}
          </select>`}
        ${tipOpen && html`<${TipCard} tip=${tip} />`}
      </div>
      ${editing && html`
        <div class="part-controls">
          <button class="icon-btn" disabled=${first} onClick=${onUp} aria-label="Move up">↑</button>
          <button class="icon-btn" disabled=${last} onClick=${onDown} aria-label="Move down">↓</button>
          <button class="icon-btn danger" onClick=${onRemove} aria-label="Remove">✕</button>
        </div>`}
      ${tip && html`<button class=${`icon-btn tip-btn${tipOpen ? ' active' : ''}`} onClick=${() => setTipOpen(!tipOpen)}
                             aria-expanded=${tipOpen} aria-label="What is this part?">ⓘ</button>`}
    </div>`;
}
