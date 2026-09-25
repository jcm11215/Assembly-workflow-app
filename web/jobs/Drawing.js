/**
 * A job's drawing as it was uploaded: a photo opens in a pinch-zoom
 * viewer; a PDF opens in the browser's own viewer in a new tab, which
 * already pans and zooms better than anything built here would.
 */
import { html, useEffect, useRef } from '../vendor/index.js';
import { openModal } from '../ui/overlays.js';

export const fileUrl = bp => `/api/blueprints/${bp.id}/file`;
export const isPdf = bp => bp.mimeType === 'application/pdf';

export function DrawingPreview({ job }){
  const bp = job.blueprint;
  if(!bp) return html`<p class="hint">No drawing scanned for this job yet.</p>`;
  if(!bp.hasFile){
    return html`<p class="hint">The scan's parts were saved, but the drawing file itself wasn't. Re-scan to attach it.</p>`;
  }
  if(isPdf(bp)){
    return html`
      <a class="file-chip" href=${fileUrl(bp)} target="_blank" rel="noopener">
        ${bp.hasThumbnail && html`<img src=${`/api/blueprints/${bp.id}/thumbnail`} alt="" />`}
        <span>${bp.fileName || 'drawing.pdf'}<br /><small class="hint">PDF drawing</small></span>
        <span class="btn btn-primary btn-sm">Open PDF</span>
      </a>`;
  }
  return html`
    <button type="button" class="drawing-preview" onClick=${() => openModal(ImageViewer, { src: fileUrl(bp), title: `${job.jobNumber} drawing` })}>
      <img src=${fileUrl(bp)} alt=${`Drawing for ${job.jobNumber}`} />
      <span class="hint">Tap to open full screen and zoom in.</span>
    </button>`;
}

/** Full-screen image with pinch / wheel zoom and drag to pan; double-tap
 *  fits it back to the screen. */
export function ImageViewer({ src, title, close }){
  const stageRef = useRef(null);
  const imgRef = useRef(null);

  useEffect(() => {
    const stage = stageRef.current, img = imgRef.current;
    let scale = 1, tx = 0, ty = 0, base = 1;
    let drag = null, pinch = null, lastTap = 0;
    const apply = () => { img.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`; };
    const fit = () => {
      const sw = stage.clientWidth, sh = stage.clientHeight;
      const iw = img.naturalWidth || sw, ih = img.naturalHeight || sh;
      base = scale = Math.min(sw / iw, sh / ih);
      tx = (sw - iw * scale) / 2; ty = (sh - ih * scale) / 2;
      apply();
    };
    const zoomAt = (cx, cy, next) => {
      next = Math.max(base * 0.5, Math.min(base * 12, next));
      const f = next / scale;
      tx = cx - (cx - tx) * f; ty = cy - (cy - ty) * f; scale = next;
      apply();
    };
    const local = e => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

    if(img.complete) fit(); else img.onload = fit;
    const onDown = e => {
      if(Date.now() - lastTap < 300){ fit(); lastTap = 0; return; }
      lastTap = Date.now();
      drag = { x: e.clientX, y: e.clientY };
    };
    const onMove = e => {
      if(!drag || pinch) return;
      tx += e.clientX - drag.x; ty += e.clientY - drag.y;
      drag = { x: e.clientX, y: e.clientY };
      apply();
    };
    const onUp = () => { drag = null; };
    const onWheel = e => { e.preventDefault(); const [x, y] = local(e); zoomAt(x, y, scale * (1 - Math.sign(e.deltaY) * 0.15)); };
    const onTouchStart = e => { if(e.touches.length === 2){ pinch = { d: dist(e.touches), s: scale }; drag = null; } };
    const onTouchMove = e => {
      if(e.touches.length !== 2 || !pinch) return;
      const r = stage.getBoundingClientRect();
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
      zoomAt(cx, cy, pinch.s * dist(e.touches) / pinch.d);
    };
    const onTouchEnd = e => { if(e.touches.length < 2) pinch = null; };

    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('touchstart', onTouchStart, { passive: true });
    stage.addEventListener('touchmove', onTouchMove, { passive: true });
    stage.addEventListener('touchend', onTouchEnd);
    const onKey = e => { if(e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return html`
    <div class="viewer">
      <div class="viewer-bar"><span>${title}</span><button class="btn btn-sm" onClick=${close}>Close</button></div>
      <div class="viewer-stage" ref=${stageRef}>
        <img ref=${imgRef} src=${src} alt=${title} draggable="false" />
        <div class="viewer-hint">Pinch to zoom · drag to pan · double-tap to fit</div>
      </div>
    </div>`;
}
