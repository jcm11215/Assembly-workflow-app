/**
 * Minimal render bus. Feature modules request a re-render without
 * importing the router, which is what previously created import cycles
 * (render -> feature -> render). app.js binds the actual renderer once.
 *
 * Renders are coalesced to one per animation frame. Every realtime event
 * across the four subscribed tables (jobs, blockers, notes, activity)
 * calls requestRender(), and each render replaces all of #content -- so a
 * burst of updates from another device used to mean one full innerHTML
 * rebuild per event, all of them discarded except the last.
 */
let renderer = null;
let frame = 0;

// Node (tests) has no rAF. Falling back to a timer keeps the coalescing
// behaviour identical there rather than silently rendering synchronously.
const schedule = typeof requestAnimationFrame === 'function'
  ? requestAnimationFrame
  : fn => setTimeout(fn, 16);
const unschedule = typeof cancelAnimationFrame === 'function'
  ? cancelAnimationFrame
  : clearTimeout;

export function setRenderer(fn){ renderer = fn; }

/**
 * Request a re-render on the next frame. Repeated calls before that frame
 * collapse into one. No-op until app.js wires the renderer.
 */
export function requestRender(){
  if(!renderer || frame) return;
  frame = schedule(() => { frame = 0; renderer(); });
}

/**
 * Render immediately, cancelling any frame already queued. For the boot
 * path and anywhere that must read the DOM straight after rendering it.
 */
export function renderNow(){
  if(frame){ unschedule(frame); frame = 0; }
  if(renderer) renderer();
}
