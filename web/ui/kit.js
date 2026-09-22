/** Small building blocks the screens share. */
import { html, useState } from '../vendor/index.js';
import { toastError } from './overlays.js';

export function Section({ title, count, actions, children }){
  return html`
    <section class="section">
      <div class="section-head">
        <h3 class="section-title">${title}${count != null && html` <span class="count">${count}</span>`}</h3>
        ${actions && html`<div class="section-actions">${actions}</div>`}
      </div>
      ${children}
    </section>`;
}

export function Empty({ icon = '—', children }){
  return html`<div class="empty"><div class="empty-icon">${icon}</div><div>${children}</div></div>`;
}

export function Chips({ options, value, onChange, label }){
  return html`
    <div class="chips" role="group" aria-label=${label}>
      ${options.map(o => html`
        <button key=${o.id} type="button" class=${`chip${o.id === value ? ' active' : ''}`} aria-pressed=${o.id === value}
                onClick=${() => onChange(o.id)}>
          ${o.label}${o.count != null && html` <span class="chip-count">${o.count}</span>`}
        </button>`)}
    </div>`;
}

export function Field({ label, hint, children }){
  return html`
    <label class="field">
      <span class="field-label">${label}</span>
      ${children}
      ${hint && html`<span class="field-hint">${hint}</span>`}
    </label>`;
}

export function Progress({ value, label }){
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return html`
    <div class="gauge" role="progressbar" aria-valuenow=${pct} aria-valuemin="0" aria-valuemax="100">
      <div class="gauge-track"><div class="gauge-fill" style=${{ width: `${pct}%` }}></div></div>
      ${label && html`<div class="gauge-label">${label}</div>`}
    </div>`;
}

/**
 * A button for an async action: disabled while it runs, and any failure
 * shown as a toast. `onClick` may return a promise.
 */
export function AsyncButton({ onClick, class: cls = 'btn', busyLabel, children, disabled, ...rest }){
  const [busy, setBusy] = useState(false);
  const run = async e => {
    if(busy) return;
    setBusy(true);
    try { await onClick(e); }
    catch (err) { toastError(err); }
    finally { setBusy(false); }
  };
  return html`<button type="button" class=${cls} disabled=${busy || disabled} onClick=${run} ...${rest}>${busy && busyLabel ? busyLabel : children}</button>`;
}

/**
 * An uncontrolled <select>: `value` only picks the starting option, so a
 * re-render (a live update arriving mid-edit) never undoes a choice.
 * Forms throughout the app are uncontrolled for the same reason -- inputs
 * take `defaultValue`, never `value`.
 */
export function Select({ name, value, options, ...rest }){
  return html`
    <select name=${name} ...${rest}>
      ${options.map(o => {
        const opt = typeof o === 'string' ? { value: o, label: o } : o;
        return html`<option key=${opt.value} value=${opt.value} selected=${String(opt.value) === String(value ?? '')}>${opt.label}</option>`;
      })}
    </select>`;
}

/** Reads a form's fields into a plain object. */
export const formValues = form => Object.fromEntries(new FormData(form).entries());

/**
 * Wraps a form submit handler: prevents the page reload, disables the
 * submit button while it runs, and shows any failure.
 */
export function submitting(handler){
  return async e => {
    e.preventDefault();
    const form = e.currentTarget;
    const button = form.querySelector('[type=submit]');
    if(button) button.disabled = true;
    try { await handler(formValues(form), form); }
    catch (err) { toastError(err); }
    finally { if(button && button.isConnected) button.disabled = false; }
  };
}
