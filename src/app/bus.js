/**
 * Minimal render bus. Feature modules request a re-render without
 * importing the router, which is what previously created import cycles
 * (render -> feature -> render). app.js binds the actual renderer once.
 */
let renderer = null;

export function setRenderer(fn){ renderer = fn; }

/** Request a full re-render. No-op until app.js wires the renderer. */
export function requestRender(){
  if(renderer) renderer();
}
