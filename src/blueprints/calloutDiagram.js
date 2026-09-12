/**
 * The drawing with numbered balloons on each part and leader lines out to
 * labels in the margins -- the way a shop drawing calls out its own
 * hardware, rather than labels dumped on top of the picture.
 *
 * Nothing here is invented: a part only gets a balloon if the scan could
 * actually point at it on the page (see spec.js's normPosition), and the
 * sheet under the balloons is the scanned drawing itself, re-rendered
 * from the stored original.
 *
 * On a phone the margins are too narrow for labels, so they collapse to a
 * numbered legend under the drawing -- the balloons keep the numbers, so
 * it reads the same either way.
 */
import { componentMapPageCache, ensureComponentMapPageLoaded } from './images.js';
import { layoutCallouts, GUTTER, IMAGE_LEFT, IMAGE_WIDTH } from './calloutLayout.js';
import { BOM_BUCKET_META, bomBucketFor } from '../models/stageMeta.js';
import { escapeHtml } from '../utils/dom.js';

// jobId -> which source_page is on screen, when one scan pinned parts
// across more than one sheet.
let calloutPage = {};
export function setCalloutPage(jobId, page){ calloutPage[jobId] = page; }

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
 * Returns '' when there is nothing to draw -- no scan, or a scan whose
 * parts all came off a BOM table with no location on the sheet.
 */
export function calloutDiagramHtml(job){
  if(!job.hasBlueprintImage) return '';
  const byPage = positionedByPage(job);
  const pages = Object.keys(byPage).map(Number).sort((a,b)=>a-b);
  if(!pages.length) return '';

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

  const { callouts, minHeightPx } = layoutCallouts(byPage[current]);

  const leaders = callouts.map(c => `
    <line x1="${c.anchorX.toFixed(2)}" y1="${c.labelY.toFixed(2)}"
          x2="${c.pointX.toFixed(2)}" y2="${c.pointY.toFixed(2)}"
          stroke="${colorFor(c.component)}" stroke-width="1"
          vector-effect="non-scaling-stroke"/>`).join('');

  // Balloons sit inside the sheet wrapper, so their coordinates are a
  // plain fraction of the image and stay right when the phone layout
  // widens the sheet to the full container.
  const balloons = callouts.map(c => `
    <span class="cv-balloon" style="left:${(c.component.position.x*100).toFixed(2)}%;top:${(c.component.position.y*100).toFixed(2)}%;background:${colorFor(c.component)};"
          title="${escapeHtml(c.component.item)}">${c.number}</span>`).join('');

  const labels = callouts.map(c => `
    <div class="cv-label cv-label-${c.side}" style="top:${c.labelY.toFixed(2)}%;">
      ${labelInnerHtml(c.component, c.number, false)}
    </div>`).join('');

  const legend = callouts.map(c => `
    <li class="cv-legend-row">${labelInnerHtml(c.component, c.number, true)}</li>`).join('');

  return `
  ${tabs}
  <div class="cv-diagram" style="--cv-gutter:${GUTTER}%;min-height:${minHeightPx}px;">
    <svg class="cv-leaders" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${leaders}</svg>
    <div class="cv-sheet-wrap" style="margin-left:${IMAGE_LEFT}%;width:${IMAGE_WIDTH}%;">
      <img class="cv-sheet" src="data:${cached.mime};base64,${cached.base64}"
           alt="Sheet ${current} of the drawing for ${escapeHtml(job.jobNumber)}">
      ${balloons}
    </div>
    ${labels}
  </div>
  <ol class="cv-legend">${legend}</ol>`;
}
