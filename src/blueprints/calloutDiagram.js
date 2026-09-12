/**
 * The drawing, with an arrow pointing at each part and a leader line out
 * to its name in the margin -- the way a shop drawing calls out its own
 * hardware. The arrow does the pointing precisely so that nothing has to
 * sit on top of the part you're trying to look at.
 *
 * Nothing here is invented: a part only gets an arrow if the scan could
 * actually point at it on the page (see spec.js's normPosition), and the
 * sheet under the arrows is the scanned drawing itself, re-rendered from
 * the stored original.
 *
 * On a phone the margins are too narrow for names, so they collapse to a
 * numbered legend under the drawing and each arrow picks up a small
 * number at its tail -- still clear of the part.
 */
import { componentMapPageCache, ensureComponentMapPageLoaded } from './images.js';
import { layoutCallouts, frameForParts, frameImageStyle, arrowHead, GUTTER, IMAGE_LEFT, IMAGE_WIDTH } from './calloutLayout.js';
import { BOM_BUCKET_META, bomBucketFor } from '../models/stageMeta.js';
import { escapeHtml } from '../utils/dom.js';

// jobId -> which source_page is on screen, when one scan pinned parts
// across more than one sheet.
let calloutPage = {};
export function setCalloutPage(jobId, page){ calloutPage[jobId] = page; }

// jobId -> true when they've asked to see the whole sheet instead of just
// the machine. Off by default: the conveyor is the point, and a sheet is
// mostly border, title block and notes.
let showWholeSheet = {};
export function toggleWholeSheet(jobId){ showWholeSheet[jobId] = !showWholeSheet[jobId]; }

/** Parts that can actually be pointed at, grouped by the sheet they're on. */
function positionedByPage(job){
  const byPage = {};
  (job.billOfMaterials || [])
    .filter(c => c && c.position && c.source_page)
    .forEach(c => { (byPage[c.source_page] = byPage[c.source_page] || []).push(c); });
  return byPage;
}

function colorFor(component){
  return (BOM_BUCKET_META[bomBucketFor(component)] || BOM_BUCKET_META.other).color;
}

/**
 * @param full  margins get the compact form -- a name and a count, one or
 *              two lines. The drawing's own wording is long and set in
 *              mono; in a margin it pushes labels into each other, so it
 *              rides in the legend and the hardware list instead, where
 *              there's a full column to hold it.
 */
function labelInnerHtml(c, number, full){
  const drawn = (c.item_as_drawn || '').trim();
  const sameAsCategory = drawn.toLowerCase().replace(/\s+/g, ' ') === (c.item || '').toLowerCase().replace(/\s+/g, ' ');
  return `
    <span class="cv-num" style="background:${colorFor(c)};">${number}</span>
    <span class="cv-label-text">
      <span class="cv-label-item">${escapeHtml(c.item)}${c.quantity ? ` <span class="cv-label-qty">&times;${escapeHtml(String(c.quantity))}</span>` : ''}</span>
      ${full && drawn && !sameAsCategory ? `<span class="cv-label-drawn">${escapeHtml(drawn)}</span>` : ''}
    </span>`;
}

function pageTabsHtml(job, pages, current){
  if(pages.length < 2) return '';
  return `
    <div class="fab-row cv-pages">
      ${pages.map(p => `<button type="button" class="btn btn-sm ${p===current?'btn-primary':'btn-outline'}" data-action="cv-page" data-id="${job.id}" data-index="${p}">Sheet ${p}</button>`).join('')}
    </div>`;
}

/**
 * Why an empty diagram explains itself instead of rendering nothing.
 *
 * Silence here reads as a broken page: the section vanishes, and with it
 * the "Show whole sheet" toggle that lives inside this output, so there
 * is no way to tell a drawing with no callouts from a drawing that
 * failed to draw. Say which of the two happened, and what to do about
 * it.
 */
function noCalloutsHtml(job){
  const scanned = (job.billOfMaterials || []).length;
  const why = scanned
    ? `The scan found ${scanned} part${scanned===1?'':'s'} but couldn't point at any of them on the sheet,
       so there's nothing to draw arrows to. Parts read off a BOM table have no place on the drawing.`
    : `The scan didn't find any parts on this drawing, so there is nothing to call out yet.`;
  return `
    <div class="cv-diagram-empty">
      ${why}
      The drawing itself is below, under Blueprint &amp; Hardware.
      Re-scanning sometimes pins the parts; otherwise add them by hand with Blueprint &gt; Edit.
    </div>`;
}

/**
 * Returns '' only when there's no drawing at all -- with a drawing but no
 * placeable parts it returns a note saying so, never nothing.
 */
export function calloutDiagramHtml(job){
  if(!job.hasBlueprintImage) return '';
  const byPage = positionedByPage(job);
  const pages = Object.keys(byPage).map(Number).sort((a,b)=>a-b);
  if(!pages.length) return noCalloutsHtml(job);

  const remembered = calloutPage[job.id];
  const current = (remembered && byPage[remembered])
    ? remembered
    : pages.reduce((best,p) => byPage[p].length > byPage[best].length ? p : best, pages[0]);
  calloutPage[job.id] = current;

  const tabs = pageTabsHtml(job, pages, current);
  const cached = componentMapPageCache[`${job.id}:${current}`];
  if(cached === undefined){
    ensureComponentMapPageLoaded(job.id, current);
    return `${tabs}<div class="cv-diagram-empty">Loading the drawing...</div>`;
  }
  if(!cached){
    return `${tabs}<div class="cv-diagram-empty">Could not load the drawing for this scan.</div>`;
  }

  // Crop to the machine unless they've asked for the whole sheet, or we
  // don't know the page's pixel size to crop against (an older cached
  // render) -- in which case the full sheet is the honest fallback.
  const wantsWhole = !!showWholeSheet[job.id];
  const frame = wantsWhole ? null : frameForParts(byPage[current]);
  const imageStyle = frame ? frameImageStyle(frame, cached.width, cached.height) : null;
  const cropped = !!imageStyle;

  const { callouts } = layoutCallouts(byPage[current], cropped ? frame : null);

  // The margin leader stops where the arrow begins; the arrow itself
  // covers the last stretch to the part.
  const leaders = callouts.map(c => `
    <line x1="${c.anchorX.toFixed(2)}" y1="${c.labelY.toFixed(2)}"
          x2="${c.tailX.toFixed(2)}" y2="${c.tailY.toFixed(2)}"
          stroke="${colorFor(c.component)}" stroke-width="1"
          vector-effect="non-scaling-stroke"/>`).join('');

  // Arrows go in an overlay sized to the sheet, with the sheet's real
  // proportions in its viewBox, so the heads come out symmetrical. The
  // margin leaders can't share it: they have to reach labels outside the
  // sheet, so their SVG spans the whole diagram and is stretched to it --
  // fine for a straight line, but it would shear an arrowhead.
  const sheetAspect = imageStyle
    ? imageStyle.aspectRatio
    : (cached.width > 0 && cached.height > 0 ? cached.width / cached.height : null);
  const vbW = 100 * (sheetAspect || 1);
  const arrowSize = 3.2;
  const arrows = sheetAspect ? callouts.map(c => {
    const toX = c.inFrame.x * vbW, toY = c.inFrame.y * 100;
    const fromX = c.tail.x * vbW, fromY = c.tail.y * 100;
    const head = arrowHead(fromX, fromY, toX, toY, arrowSize);
    const col = colorFor(c.component);
    // Stop the shaft at the head's base so it can't poke through the tip.
    const shaftEnd = head ? head[0] : [toX, toY];
    return `
      <line x1="${fromX.toFixed(2)}" y1="${fromY.toFixed(2)}"
            x2="${(shaftEnd[0]).toFixed(2)}" y2="${(shaftEnd[1]).toFixed(2)}"
            stroke="${col}" stroke-width="0.9" vector-effect="non-scaling-stroke"/>
      ${head ? `<polygon points="${head.map(p => p.map(n => n.toFixed(2)).join(',')).join(' ')}" fill="${col}"/>` : ''}`;
  }).join('') : '';

  // The number rides at the arrow's tail, off the part. On a wide screen
  // the margin label carries it instead and these stay hidden. Without a
  // measured page there's no arrow to sit at the end of, so it falls back
  // to marking the part directly -- a tag adrift from its part with
  // nothing joining them would be worse than one sitting on it.
  const tags = callouts.map(c => {
    const at = sheetAspect ? c.tail : c.inFrame;
    return `
    <span class="cv-tag${sheetAspect ? '' : ' cv-tag-on-part'}" style="left:${(at.x*100).toFixed(2)}%;top:${(at.y*100).toFixed(2)}%;background:${colorFor(c.component)};"
          title="${escapeHtml(c.component.item)}">${c.number}</span>`;
  }).join('');

  const labels = callouts.map(c => `
    <div class="cv-label cv-label-${c.side}" style="top:${c.labelY.toFixed(2)}%;">
      ${labelInnerHtml(c.component, c.number, false)}
    </div>`).join('');

  const legend = callouts.map(c => `
    <li class="cv-legend-row">${labelInnerHtml(c.component, c.number, true)}</li>`).join('');

  // Cropped: the wrapper is the frame, and the sheet is blown up inside
  // it and shifted so the frame is what shows through.
  const sheet = cropped
    ? `<div class="cv-sheet-crop" style="aspect-ratio:${imageStyle.aspectRatio.toFixed(4)};">
         <img class="cv-sheet cv-sheet-zoom"
              style="width:${imageStyle.width.toFixed(3)}%;left:${imageStyle.left.toFixed(3)}%;top:${imageStyle.top.toFixed(3)}%;"
              src="data:${cached.mime};base64,${cached.base64}"
              alt="The conveyor on sheet ${current} of the drawing for ${escapeHtml(job.jobNumber)}">
       </div>`
    : `<img class="cv-sheet" src="data:${cached.mime};base64,${cached.base64}"
            alt="Sheet ${current} of the drawing for ${escapeHtml(job.jobNumber)}">`;

  // Only offered when cropping is actually possible. Without the page's
  // pixel size there's nothing to crop against, so the button would
  // promise a view it can't produce and then appear to do nothing.
  const canCrop = cached.width > 0 && cached.height > 0;
  const viewToggle = canCrop ? `
    <button type="button" class="btn btn-outline btn-sm cv-view-toggle" data-action="cv-whole-sheet" data-id="${job.id}">
      ${cropped ? 'Show whole sheet' : 'Show just the conveyor'}
    </button>` : '';

  return `
  ${tabs}
  <div class="cv-diagram" style="--cv-gutter:${GUTTER}%;">
    <svg class="cv-leaders" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${leaders}</svg>
    <div class="cv-sheet-wrap" style="margin-left:${IMAGE_LEFT}%;width:${IMAGE_WIDTH}%;">
      ${sheet}
      <svg class="cv-arrows" viewBox="0 0 ${vbW.toFixed(2)} 100" preserveAspectRatio="none" aria-hidden="true">${arrows}</svg>
      ${tags}
    </div>
    ${labels}
  </div>
  ${viewToggle ? `<div class="cv-under">${viewToggle}</div>` : ''}
  <ol class="cv-legend">${legend}</ol>`;
}
