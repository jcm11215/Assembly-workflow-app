/** Part tips: chips that open a short card, and a look-up for any part. */
import { html, useState } from '../vendor/index.js';
import { PART_TIPS, TIP_BY_ID } from '../domain/parts.js';

export function TipCard({ tip }){
  if(!tip) return null;
  return html`
    <div class="tip-card">
      <div class="tip-name">${tip.name}${tip.aka && html` <span class="tip-aka">aka ${tip.aka}</span>`}</div>
      <div class="tip-line"><b>What</b><span>${tip.what}</span></div>
      <div class="tip-line"><b>Purpose</b><span>${tip.purpose}</span></div>
      <div class="tip-line"><b>Where</b><span>${tip.where}</span></div>
      <div class="tip-line"><b>How</b><span>${tip.how}</span></div>
    </div>`;
}

/** A row of chips, one per part; tapping one opens its card below. */
export function TipChips({ tips }){
  const [open, setOpen] = useState(null);
  if(!tips.length) return null;
  return html`
    <div class="tips">
      <div class="tip-chips">
        ${tips.map(t => html`
          <button key=${t.id} type="button" class=${`tip-chip${open === t.id ? ' active' : ''}`}
                  aria-expanded=${open === t.id} onClick=${() => setOpen(open === t.id ? null : t.id)}>ⓘ ${t.name}</button>`)}
      </div>
      <${TipCard} tip=${TIP_BY_ID[open]} />
    </div>`;
}

/** "Look up a part": every tip, for parts no checklist step names. */
export function PartLookup(){
  const [open, setOpen] = useState('');
  const sorted = [...PART_TIPS].sort((a, b) => a.name.localeCompare(b.name));
  return html`
    <div class="tips">
      <select class="tip-lookup" value=${open} onChange=${e => setOpen(e.currentTarget.value)} aria-label="Look up a part">
        <option value="">ⓘ Look up a part…</option>
        ${sorted.map(t => html`<option key=${t.id} value=${t.id}>${t.name}${t.aka ? ` (${t.aka})` : ''}</option>`)}
      </select>
      <${TipCard} tip=${TIP_BY_ID[open]} />
    </div>`;
}
