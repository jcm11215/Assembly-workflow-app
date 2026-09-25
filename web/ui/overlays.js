/**
 * Modals, confirmations and toasts. Anything can open one; <Overlays/>,
 * mounted once at the root, draws them.
 *
 *   openModal(Component, props)   -> close function; the component also
 *                                    receives `close` as a prop
 *   confirmAction({ title, message, confirmLabel, danger }) -> Promise<boolean>
 *   toast(message, { ms, kind })  kind: 'info' | 'error' | 'ok'
 */
import { html, useEffect, useState } from '../vendor/index.js';

let modals = [];
let toasts = [];
let nextId = 1;
const listeners = new Set();
const emit = () => listeners.forEach(fn => fn());

export function openModal(Component, props = {}){
  const id = nextId++;
  const close = () => {
    modals = modals.filter(m => m.id !== id);
    emit();
  };
  modals = [...modals, { id, Component, props: { ...props, close } }];
  emit();
  return close;
}

export const closeAllModals = () => { modals = []; emit(); };

export function toast(message, { ms = 3500, kind = 'info' } = {}){
  const id = nextId++;
  toasts = [...toasts.slice(-2), { id, message, kind }];
  emit();
  setTimeout(() => { toasts = toasts.filter(t => t.id !== id); emit(); }, ms);
}

/** Shows an error the way every screen should: the server's own words. */
export const toastError = (err, prefix = '') =>
  toast(`${prefix}${(err && err.message) || String(err)}`, { ms: 6000, kind: 'error' });

export function confirmAction({ title, message, confirmLabel = 'Confirm', danger = false }){
  return new Promise(resolve => {
    openModal(Confirm, { title, message, confirmLabel, danger, resolve });
  });
}

function Confirm({ title, message, confirmLabel, danger, resolve, close }){
  const answer = v => { close(); resolve(v); };
  return html`
    <${Sheet} title=${title} close=${() => answer(false)} small>
      <p class="confirm-text">${message}</p>
      <div class="row-end">
        <button class="btn" onClick=${() => answer(false)}>Cancel</button>
        <button class=${`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick=${() => answer(true)} autofocus>${confirmLabel}</button>
      </div>
    <//>`;
}

/**
 * The frame every modal uses: a bottom sheet on a phone, a centred panel
 * on a wide screen. `locked` removes every way to dismiss it (sign-in).
 */
export function Sheet({ title, close, children, locked = false, small = false, wide = false }){
  useEffect(() => {
    if(locked) return;
    const onKey = e => { if(e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [locked, close]);

  return html`
    <div class="overlay" onClick=${e => { if(!locked && e.target === e.currentTarget) close(); }}>
      <div class=${`sheet${small ? ' sheet-small' : ''}${wide ? ' sheet-wide' : ''}`} role="dialog" aria-modal="true" aria-label=${title}>
        <div class="sheet-head">
          <h2>${title}</h2>
          ${!locked && html`<button class="icon-btn" onClick=${close} aria-label="Close">×</button>`}
        </div>
        <div class="sheet-body">${children}</div>
      </div>
    </div>`;
}

export function Overlays(){
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force(n => n + 1);
    listeners.add(fn);
    fn();   // anything opened before this subscribed (see useStore)
    return () => listeners.delete(fn);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('modal-open', modals.length > 0);
  });

  return html`
    ${modals.map(({ id, Component, props }) => html`<${Component} key=${id} ...${props} />`)}
    <div class="toasts" aria-live="polite">
      ${toasts.map(t => html`<div key=${t.id} class=${`toast toast-${t.kind}`}>${t.message}</div>`)}
    </div>`;
}
