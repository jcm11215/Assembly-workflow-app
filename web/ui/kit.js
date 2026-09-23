/** Small building blocks the screens share. */
import { html, useEffect, useRef, useState } from '../vendor/index.js';
import { toastError } from './overlays.js';
import { Icon } from './icons.js';

/** The top of every screen: its title, a line under it, and its main actions. */
export function PageHeader({ title, sub, actions, crumbs }){
  return html`
    <header class="page-head">
      <div>
        ${crumbs && html`<div class="crumbs">${crumbs}</div>`}
        <h1>${title}</h1>
        ${sub && html`<div class="page-sub">${sub}</div>`}
      </div>
      ${actions && html`<div class="page-actions">${actions}</div>`}
    </header>`;
}

/**
 * A button that opens a short list of actions. `items` are
 * { label, icon?, onSelect, danger? } or 'sep'; falsy entries are skipped.
 */
export function Menu({ label = 'More', icon = 'more', items, class: cls = 'btn' }){
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if(!open) return;
    const away = e => { if(ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const key = e => { if(e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); };
  }, [open]);
  const shown = items.filter(Boolean);
  if(!shown.length) return null;
  return html`
    <div class="menu-wrap" ref=${ref}>
      <button type="button" class=${cls} aria-haspopup="menu" aria-expanded=${open} onClick=${() => setOpen(!open)}>
        ${icon && html`<${Icon} name=${icon} />`}${label}
      </button>
      ${open && html`
        <div class="menu" role="menu">
          ${shown.map((it, i) => it === 'sep' ? html`<div key=${i} class="menu-sep"></div>` : html`
            <button key=${i} type="button" role="menuitem" class=${`menu-item${it.danger ? ' danger' : ''}`}
                    onClick=${() => { setOpen(false); it.onSelect(); }}>
              ${it.icon && html`<${Icon} name=${it.icon} />`}${it.label}
            </button>`)}
        </div>`}
    </div>`;
}

/** Underlined tabs. `options` are { id, label, count? }. */
export function Tabs({ options, value, onChange, label }){
  return html`
    <div class="tabs" role="tablist" aria-label=${label}>
      ${options.map(o => html`
        <button key=${o.id} type="button" role="tab" class=${`tab${o.id === value ? ' active' : ''}`}
                aria-selected=${o.id === value} onClick=${() => onChange(o.id)}>
          ${o.label}${o.count != null && html`<span class="count">${o.count}</span>`}
        </button>`)}
    </div>`;
}

/** Two or three mutually exclusive views, e.g. List | Board. */
export function Segmented({ options, value, onChange, label }){
  return html`
    <div class="segmented" role="group" aria-label=${label}>
      ${options.map(o => html`
        <button key=${o.id} type="button" class=${o.id === value ? 'active' : ''} aria-pressed=${o.id === value} onClick=${() => onChange(o.id)}>
          ${o.icon && html`<${Icon} name=${o.icon} />`}${o.label}
        </button>`)}
    </div>`;
}

/** The ISC Manufacturing logo, in the gray that suits the theme. */
export function Logo({ class: cls = '' }){
  return html`
    <img class=${`${cls} logo-light`} src="/assets/isc-logo.png" alt="ISC Manufacturing" width="241" height="111" />
    <img class=${`${cls} logo-dark`} src="/assets/isc-logo-dark.png" alt="ISC Manufacturing" width="241" height="111" />`;
}

/** Initials for an avatar: "Justin McKinney" -> "JM". */
export const initials = name => String(name || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';

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

/** Nothing to show. `icon` is an icon name (ui/icons.js). */
export function Empty({ icon = 'inbox', children }){
  return html`<div class="empty"><div class="empty-icon"><${Icon} name=${icon} /></div><div>${children}</div></div>`;
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
