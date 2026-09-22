/**
 * "What you're building": sheet 1 of the drawing, with an arrow pointing
 * at each part the scan located and a leader line out to its name in the
 * margin, the way a shop drawing calls out its own hardware.
 *
 * Nothing is invented: a part only gets an arrow if the scan could point
 * at it, and the sheet under the arrows is the uploaded drawing itself.
 * On a phone the margins are too narrow for names, so labels become a
 * numbered legend under the drawing.
 */
import { html, useEffect, useState } from '../vendor/index.js';
import { fetchBlob } from '../lib/api.js';
import { layoutCallouts, frameForParts, frameImageStyle, arrowHead, GUTTER, IMAGE_LEFT, IMAGE_WIDTH } from './calloutLayout.js';
import { partGroup } from '../domain/parts.js';

/** Sheet 1 is the general arrangement -- what "what you're building" means. */
const SHEET = 1;

/** blueprint id -> Promise of { url, width, height } for sheet 1. */
const pageCache = new Map();

function loadSheet(bp){
  if(!pageCache.has(bp.id)){
    pageCache.set(bp.id, (async () => {
      const blob = await fetchBlob(`/api/blueprints/${bp.id}/file`);
      if(bp.mimeType === 'application/pdf'){
        const { pdfFileToImages } = await import('./pdf.js');
        const [page] = await pdfFileToImages(blob, 1, 1600, 0.85, [SHEET]);
        if(!page) throw new Error('The PDF has no first page.');
        return { url: `data:${page.mime};base64,${page.base64}`, width: page.width, height: page.height };
      }
      const url = URL.createObjectURL(blob);
      const size = await new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve({ width: 0, height: 0 });
        img.src = url;
      });
      return { url, ...size };
    })().catch(e => { pageCache.delete(bp.id); throw e; }));
  }
  return pageCache.get(bp.id);
}

const colorFor = c => partGroup(c).color;

function Label({ c, number, full }){
  const drawn = (c.item_as_drawn || '').trim();
  const same = drawn.toLowerCase().replace(/\s+/g, ' ') === (c.item || '').toLowerCase().replace(/\s+/g, ' ');
  return html`
    <span class="cv-num" style=${{ background: colorFor(c) }}>${number}</span>
    <span class="cv-label-text">
      <span class="cv-label-item">${c.item}${c.quantity ? html` <span class="cv-label-qty">×${c.quantity}</span>` : ''}</span>
      ${full && drawn && !same && html`<span class="cv-label-drawn">${drawn}</span>`}
    </span>`;
}

export function Diagram({ job }){
  const bp = job.blueprint;
  const [sheet, setSheet] = useState(null);
  const [failed, setFailed] = useState(false);
  const [whole, setWhole] = useState(false);

  const placed = bp ? bp.components.filter(c => c.position && c.source_page) : [];
  const onSheet = placed.filter(c => c.source_page === SHEET);
  const otherSheets = [...new Set(placed.map(c => c.source_page))].filter(p => p !== SHEET).sort((a, b) => a - b);

  useEffect(() => {
    if(!bp || !bp.hasFile || !onSheet.length) return;
    let live = true;
    setFailed(false);
    loadSheet(bp).then(s => live && setSheet(s)).catch(e => { console.error(e); if(live) setFailed(true); });
    return () => { live = false; };
  }, [bp && bp.id, bp && bp.hasFile, onSheet.length > 0]);

  if(!bp || !bp.hasFile) return null;
  if(!placed.length){
    const n = bp.components.length;
    return html`<div class="cv-empty">
      ${n ? `The scan found ${n} part${n === 1 ? '' : 's'} but couldn't point at any of them on the sheet, so there's nothing to draw arrows to.`
          : "The scan didn't find any parts on this drawing, so there's nothing to call out yet."}
      Re-scanning sometimes pins the parts.</div>`;
  }
  if(!onSheet.length){
    return html`<div class="cv-empty">Nothing on sheet ${SHEET} could be pointed at. The scan did pin parts on
      sheet${otherSheets.length === 1 ? '' : 's'} ${otherSheets.join(', ')}; they're in the parts list below.</div>`;
  }
  if(failed) return html`<div class="cv-empty">Could not load the drawing for this scan.</div>`;
  if(!sheet) return html`<div class="cv-empty">Loading the drawing…</div>`;

  // Crop to the machine unless asked for the whole sheet; a sheet is
  // mostly border, title block and notes.
  const canCrop = sheet.width > 0 && sheet.height > 0;
  const frame = whole || !canCrop ? null : frameForParts(onSheet);
  const imageStyle = frame ? frameImageStyle(frame, sheet.width, sheet.height) : null;
  const cropped = !!imageStyle;
  const { callouts } = layoutCallouts(onSheet, cropped ? frame : null);
  const aspect = imageStyle ? imageStyle.aspectRatio : (canCrop ? sheet.width / sheet.height : null);
  const vbW = 100 * (aspect || 1);

  return html`
    <div class="cv" style=${{ '--cv-gutter': `${GUTTER}%` }}>
      <svg class="cv-leaders" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        ${callouts.map(c => html`<line key=${c.number} x1=${c.anchorX} y1=${c.labelY} x2=${c.tailX} y2=${c.tailY}
                                        stroke=${colorFor(c.component)} stroke-width="1" vector-effect="non-scaling-stroke" />`)}
      </svg>
      <div class="cv-sheet-wrap" style=${{ marginLeft: `${IMAGE_LEFT}%`, width: `${IMAGE_WIDTH}%` }}>
        ${cropped
          ? html`<div class="cv-crop" style=${{ aspectRatio: imageStyle.aspectRatio.toFixed(4) }}>
                   <img class="cv-sheet cv-zoom" src=${sheet.url} alt=${`The conveyor on sheet ${SHEET} for ${job.jobNumber}`}
                        style=${{ width: `${imageStyle.width}%`, left: `${imageStyle.left}%`, top: `${imageStyle.top}%` }} />
                 </div>`
          : html`<img class="cv-sheet" src=${sheet.url} alt=${`Sheet ${SHEET} for ${job.jobNumber}`} />`}
        ${aspect && html`
          <svg class="cv-arrows" viewBox=${`0 0 ${vbW.toFixed(2)} 100`} preserveAspectRatio="none" aria-hidden="true">
            ${callouts.map(c => {
              const toX = c.inFrame.x * vbW, toY = c.inFrame.y * 100;
              const fromX = c.tail.x * vbW, fromY = c.tail.y * 100;
              const head = arrowHead(fromX, fromY, toX, toY, 3.2);
              const end = head ? head[0] : [toX, toY];
              const col = colorFor(c.component);
              return html`<g key=${c.number}>
                <line x1=${fromX} y1=${fromY} x2=${end[0]} y2=${end[1]} stroke=${col} stroke-width="0.9" vector-effect="non-scaling-stroke" />
                ${head && html`<polygon points=${head.map(p => p.join(',')).join(' ')} fill=${col} />`}
              </g>`;
            })}
          </svg>`}
        ${callouts.map(c => {
          const at = aspect ? c.tail : c.inFrame;
          return html`<span key=${c.number} class=${`cv-tag${aspect ? '' : ' cv-tag-on-part'}`} title=${c.component.item}
                            style=${{ left: `${at.x * 100}%`, top: `${at.y * 100}%`, background: colorFor(c.component) }}>${c.number}</span>`;
        })}
      </div>
      ${callouts.map(c => html`
        <div key=${c.number} class=${`cv-label cv-label-${c.side}`} style=${{ top: `${c.labelY}%` }}>
          <${Label} c=${c.component} number=${c.number} full=${false} />
        </div>`)}
    </div>
    ${canCrop && html`<div class="cv-under"><button class="btn btn-sm" onClick=${() => setWhole(!whole)}>
      ${cropped ? 'Show whole sheet' : 'Show just the conveyor'}</button></div>`}
    <ol class="cv-legend">
      ${callouts.map(c => html`<li key=${c.number} class="cv-legend-row"><${Label} c=${c.component} number=${c.number} full=${true} /></li>`)}
    </ol>`;
}
