/** Bill of materials rendering, grouped by subassembly.
 *
 * Two modes: read-only (the default) and edit mode, toggled per-job by
 * the "Edit Components" button. Edit mode exists because the AI scanner
 * doesn't always classify or catch every part correctly -- someone
 * reviewing the extraction needs to fix it directly, not just approve
 * or reject the whole thing and re-scan.
 */

import { BOM_BUCKET_META, BOM_BUCKET_ORDER, BUCKET_TO_STAGE, bomBucketFor } from '../models/stageMeta.js';
import { fmtDate } from '../utils/date.js';
import { escapeHtml } from '../utils/dom.js';
import { state } from '../state/store.js';

function componentRowHtml(c, bucket, idx, total, editing){
  const editControls = editing ? `
    <div class="bom-row-controls">
      <button type="button" class="bom-row-btn" data-action="bom-move-up" data-component-id="${c.id}" ${idx===0?'disabled':''} aria-label="Move up">&#8593;</button>
      <button type="button" class="bom-row-btn" data-action="bom-move-down" data-component-id="${c.id}" ${idx===total-1?'disabled':''} aria-label="Move down">&#8595;</button>
      <button type="button" class="bom-row-btn bom-row-btn-danger" data-action="bom-remove-component" data-component-id="${c.id}" aria-label="Remove">&#10005;</button>
    </div>` : '';
  const manualTag = c.extraction_method === 'manual' ? `<span class="chip-tiny">added manually</span>` : '';
  return `
    <div class="bom-row${editing?' bom-row-editing':''}">
      <div class="bom-row-main">
        <div class="bom-item">${escapeHtml(c.item)} ${manualTag}</div>
        ${c.specification ? `<div class="bom-spec">${escapeHtml(c.specification)}</div>` : ''}
        <div class="bom-qty">Qty: ${c.quantity!=null ? escapeHtml(String(c.quantity)) : '--'}</div>
      </div>
      ${editControls}
    </div>`;
}

function addComponentFormHtml(bucket, blueprintId){
  return `
    <form class="bom-add-form" data-action="bom-add-component-form" data-bucket="${bucket}" data-blueprint-id="${blueprintId}">
      <input type="text" name="item" placeholder="Part name" required>
      <input type="text" name="specification" placeholder="Spec (optional)">
      <input type="number" name="quantity" placeholder="Qty" min="0" style="width:70px;">
      <button type="submit" class="btn btn-primary btn-sm">Add</button>
    </form>`;
}

export function bomListHtml(job){
  if((!job.billOfMaterials || !job.billOfMaterials.length) && !state.bomEditing) return '';
  const editing = !!state.bomEditing;
  const groups = {};
  (job.billOfMaterials||[]).forEach(c=>{
    const b = bomBucketFor(c);
    (groups[b] = groups[b] || []).push(c);
  });
  const bucketsToShow = editing ? BOM_BUCKET_ORDER : BOM_BUCKET_ORDER.filter(b=>groups[b] && groups[b].length);
  const sections = bucketsToShow.map(b=>{
    const meta = BOM_BUCKET_META[b];
    const items = groups[b] || [];
    const rows = items.map((c,i)=>componentRowHtml(c, b, i, items.length, editing)).join('');
    return `
      <div class="bom-group-head"><span class="model-swatch" style="background:${meta.color};"></span>${escapeHtml(meta.label)} <span class="checklist-badge">${items.length}</span></div>
      <div class="bom-list">${rows || (editing?'<div class="bp-hint" style="margin:4px 0;">Nothing here yet.</div>':'')}</div>
      ${editing ? addComponentFormHtml(b, job.blueprintId) : ''}`;
  }).join('');
  return `
  <div class="section-title" style="margin-top:16px;display:flex;justify-content:space-between;align-items:center;">
    <span>Extracted Hardware &amp; Components <span class="count-badge">${(job.billOfMaterials||[]).length}</span></span>
    ${job.blueprintId ? `<button type="button" class="btn btn-outline btn-sm" data-action="bom-toggle-edit">${editing?'Done':'Edit'}</button>` : ''}
  </div>
  ${job.blueprintExtractedAt ? `<div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">Last extracted ${fmtDate(job.blueprintExtractedAt.slice(0,10))}</div>` : ''}
  ${editing ? `<div class="bp-hint" style="margin-bottom:8px;">The AI scanner doesn't always get it right -- add, remove, or reorder anything here.</div>` : ''}
  ${sections}`;
}

// A proportional schematic built from the dimensions read off the drawing --
// NOT a CAD model. It is accurate to the numbers extracted (diameter,
// length, incline, hanger count) and nothing more, which is enough to
// orient someone on the floor without pretending to be engineering data.
