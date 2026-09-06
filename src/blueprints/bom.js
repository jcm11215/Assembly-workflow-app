/** Bill of materials rendering, grouped by subassembly. */


import { STAGE_META, STAGE_ORDER } from '../models/stageMeta.js';
import { fmtDate } from '../utils/date.js';
import { escapeHtml } from '../utils/dom.js';

export function bomListHtml(job){
  if(!job.billOfMaterials || !job.billOfMaterials.length) return '';
  const groups = {};
  job.billOfMaterials.forEach(c=>{
    const s = STAGE_META[c.stage] ? c.stage : 'other';
    (groups[s] = groups[s] || []).push(c);
  });
  const sections = STAGE_ORDER.filter(s=>groups[s] && groups[s].length).map(s=>{
    const meta = STAGE_META[s];
    const rows = groups[s].map(c=>`
      <div class="bom-row">
        <div class="bom-item">${escapeHtml(c.item)}</div>
        ${c.specification ? `<div class="bom-spec">${escapeHtml(c.specification)}</div>` : ''}
        <div class="bom-qty">Qty: ${c.quantity!=null ? escapeHtml(String(c.quantity)) : '--'}</div>
      </div>`).join('');
    return `
      <div class="bom-group-head"><span class="model-swatch" style="background:${meta.color};"></span>${escapeHtml(meta.label)} <span class="checklist-badge">${groups[s].length}</span></div>
      <div class="bom-list">${rows}</div>`;
  }).join('');
  return `
  <div class="section-title" style="margin-top:16px;">Extracted Hardware &amp; Components <span class="count-badge">${job.billOfMaterials.length}</span></div>
  ${job.blueprintExtractedAt ? `<div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">Last extracted ${fmtDate(job.blueprintExtractedAt.slice(0,10))}</div>` : ''}
  ${sections}`;
}

// A proportional schematic built from the dimensions read off the drawing --
// NOT a CAD model. It is accurate to the numbers extracted (diameter,
// length, incline, hanger count) and nothing more, which is enough to
// orient someone on the floor without pretending to be engineering data.
