/**
 * The parts a scan found, grouped by where they go, each with the
 * drawing's item number -- the number on its balloon and in the parts
 * table -- so a part here, its tag on the picture above and its balloon
 * on the paper drawing are easy to match. Admins can switch to editing:
 * fix a type, an end or an item number, reorder within a group, remove a
 * part, or add one the scan missed.
 */
import { html, useState } from '../vendor/index.js';
import { PART_GROUPS, PART_TYPES, partGroup, tipForPart } from '../domain/parts.js';
import { addComponent, updateComponent, deleteComponent, reorderComponents } from '../lib/actions.js';
import { useCan } from '../lib/permissions.js';
import { fmtWhen } from '../lib/format.js';
import { openModal, toastError } from '../ui/overlays.js';
import { submitting } from '../ui/kit.js';
import { TipCard } from './Tips.js';

export function PartsList({ job }){
  const bp = job.blueprint;
  const canEdit = useCan('blueprint.manage');
  const [editing, setEditing] = useState(false);
  const parts = bp ? bp.components : [];
  if(!bp) return null;

  const anyPlaced = parts.some(c => c.position);
  // Only a scan from the old scanner: a list someone has rearranged since
  // can hold the same part twice at one end on purpose.
  const repeats = bp.scanner ? 0 : repeatedEntries(parts);
  const rescan = () => import('../scan/ScanDialog.js').then(m => openModal(m.RescanJob, { jobId: job.id })).catch(toastError);
  const groups = PART_GROUPS.map(g => ({ ...g, parts: parts.filter(c => partGroup(c).id === g.id) }))
    .filter(g => editing || g.parts.length);
  // Read like the drawing's own table: by item number, the parts without
  // one after. Editing keeps the saved order, which is what reordering
  // changes.
  const byNumber = list => list.slice().sort((a, b) => itemRank(a) - itemRank(b));
  const shown = g => (editing ? g.parts : byNumber(g.parts));
  // One table row can be several parts at different places (a QTY 2
  // bearing, one each end): the total on the conveyor, per item number.
  const totals = new Map();
  for(const c of parts){
    const k = itemKey(c);
    if(!k) continue;
    const t = totals.get(k) || { qty: 0, rows: 0 };
    t.qty += Number(c.quantity) || 0; t.rows++;
    totals.set(k, t);
  }
  /** Moves one of a QTY 2+ entry to its own row, to put at another end. */
  const split = c => run(async () => {
    await updateComponent(c.id, { quantity: Number(c.quantity) - 1 });
    await addComponent(bp.id, { item: c.item, item_as_drawn: c.item_as_drawn, specification: c.specification,
      part_number: c.part_number, quantity: 1, balloon: c.balloon, stage: c.stage });
  });

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
      ${editing && html`<p class="hint">The scanner doesn't always get it right -- fix, reorder, remove or add anything here.
        A type or end you fix is remembered, and the next scan reads that part the same way. A part you remove is left out of later scans.</p>`}
      ${repeats > 0 && !editing && html`
        <div class="note-bar parts-repeats">
          <span>This scan lists ${repeats} part${repeats === 1 ? '' : 's'} more than once: the scanner used to count a part again in every view that showed it. ${canEdit
            ? 'Scanning the drawing again gives a clean list (this one is kept as the earlier scan).' : 'An admin can scan the drawing again to fix it.'}</span>
          ${canEdit && html`<button class="btn btn-sm" onClick=${rescan}>Scan again</button>`}
        </div>`}
      ${!parts.length && !editing && html`<p class="hint">
        The drawing is attached, but the scan didn't find any parts on it. Re-scanning often works on a second try;
        otherwise an admin can add them by hand with Edit parts.</p>`}
      ${groups.map(g => html`
        <div key=${g.id} class="parts-group">
          <div class="parts-group-head"><span class="swatch" style=${{ background: g.color }}></span>${g.label} <span class="count">${g.parts.length}</span></div>
          ${shown(g).map((c, i) => html`
            <${PartRow} key=${c.id} part=${c} anyPlaced=${anyPlaced} editing=${editing}
                        total=${totals.get(itemKey(c))} onSplit=${() => split(c)}
                        first=${i === 0} last=${i === g.parts.length - 1}
                        onUp=${() => move(g, i, -1)} onDown=${() => move(g, i, 1)}
                        onRemove=${() => run(() => deleteComponent(c.id))}
                        onRegroup=${stage => run(() => updateComponent(c.id, { stage }))}
                        onRetype=${item => run(() => updateComponent(c.id, { item }))}
                        onRenumber=${balloon => run(() => updateComponent(c.id, { balloon }))} />`)}
          ${editing && html`
            <form class="part-add" onSubmit=${submitting(async (f, form) => {
              await addComponent(bp.id, { item: f.item, specification: f.specification, quantity: f.quantity || null,
                balloon: f.balloon || null, stage: g.stage });
              form.reset();
            })}>
              <input name="balloon" placeholder="Item #" class="qty" inputmode="numeric" aria-label="Item number" />
              <input name="item" placeholder="Part name" required />
              <input name="specification" placeholder="Spec (optional)" />
              <input name="quantity" type="number" min="0" step="any" placeholder="Qty" class="qty" />
              <button type="submit" class="btn btn-primary btn-sm">Add</button>
            </form>`}
        </div>`)}
    </div>`;
}

const itemKey = c => (c.balloon != null && String(c.balloon).trim() !== '' ? String(c.balloon).trim() : null);

/** Scanned entries past the first of the same part at the same place --
 *  what the old scanner produced. Parts added by hand are the person's
 *  own business. */
function repeatedEntries(parts){
  const seen = new Set();
  let extra = 0;
  for(const c of parts){
    if(c.extraction_method === 'manual') continue;
    const name = String(c.item_as_drawn || c.item || '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
    const key = [itemKey(c) || '', name, String(c.part_number || '').toUpperCase(), c.installation_location || 'unknown'].join('|');
    if(seen.has(key)) extra++;
    else seen.add(key);
  }
  return extra;
}

/** Parts sort by item number; one without comes after all that have one. */
function itemRank(c){
  const n = Number(c.balloon);
  return c.balloon != null && String(c.balloon).trim() !== '' && Number.isFinite(n) ? n : 1e6;
}

function PartRow({ part: c, anyPlaced, editing, total, first, last, onUp, onDown, onRemove, onRegroup, onRetype, onRenumber, onSplit }){
  const [tipOpen, setTipOpen] = useState(false);
  const tip = editing ? null : tipForPart(c);
  const drawn = (c.item_as_drawn || '').trim();
  const showDrawn = drawn && drawn.toLowerCase().replace(/\s+/g, ' ') !== c.item.toLowerCase().replace(/\s+/g, ' ');
  return html`
    <div class="part">
      <div class="part-main">
        <div class="part-item">
          ${c.balloon != null && String(c.balloon).trim() !== '' && html`<span class="item-no" title="Item number on the drawing">${c.balloon}</span>`}
          ${c.item}
          ${c.extraction_method === 'manual' && html` <span class="tag">added by hand</span>`}
          ${anyPlaced && !c.position && c.extraction_method !== 'manual' &&
            html` <span class="tag" title="In the parts list, but not called out on any view">not shown on the drawing</span>`}
        </div>
        ${showDrawn && html`<div class="part-drawn" title="Exactly as written on the drawing">${drawn}</div>`}
        ${c.specification && html`<div class="part-spec">${c.specification}</div>`}
        ${c.part_number && html`<div class="part-pn">PN ${c.part_number}</div>`}
        <div class="part-qty">
          ${total && total.rows > 1
            ? html`Qty here: <b>${c.quantity ?? '--'}</b> · <span title="The parts table's quantity for this item">${total.qty} on the conveyor</span>`
            : html`Qty: ${c.quantity ?? '--'}`}
        </div>
        ${editing && html`
          <div class="part-edit-row">
            <input class="part-group-select item-no-input" aria-label="Item number" placeholder="Item #" defaultValue=${c.balloon || ''}
                   inputmode="numeric" onChange=${e => onRenumber(e.currentTarget.value.trim())} />
            <select class="part-group-select" aria-label="Type" onChange=${e => onRetype(e.currentTarget.value)}>
              ${!PART_TYPES.includes(c.item) && html`<option value="" selected disabled>${c.item}</option>`}
              ${PART_TYPES.map(t => html`<option key=${t} value=${t} selected=${c.item === t}>${t}</option>`)}
            </select>
            <select class="part-group-select" aria-label="Where it goes" onChange=${e => onRegroup(e.currentTarget.value)}>
              ${PART_GROUPS.map(g => html`<option key=${g.id} value=${g.stage} selected=${partGroup(c).id === g.id}>${g.label}</option>`)}
            </select>
          </div>`}
        ${tipOpen && html`<${TipCard} tip=${tip} />`}
      </div>
      ${editing && html`
        <div class="part-controls">
          <button class="icon-btn" disabled=${first} onClick=${onUp} aria-label="Move up">↑</button>
          <button class="icon-btn" disabled=${last} onClick=${onDown} aria-label="Move down">↓</button>
          ${Number(c.quantity) >= 2 && html`<button class="btn btn-sm" onClick=${onSplit}
            title="Move one of these to its own row, to put it at another place (a bearing at each end, say)">Split one off</button>`}
          <button class="icon-btn danger" onClick=${onRemove} aria-label="Remove">✕</button>
        </div>`}
      ${tip && html`<button class=${`icon-btn tip-btn${tipOpen ? ' active' : ''}`} onClick=${() => setTipOpen(!tipOpen)}
                             aria-expanded=${tipOpen} aria-label="What is this part?">ⓘ</button>`}
    </div>`;
}
