/** Line icons, drawn at 24x24 with the current text colour. */
import { html } from '../vendor/index.js';

const PATHS = {
  dashboard: html`<path d="M3.5 15.5a8.5 8.5 0 1 1 17 0"/><path d="M12 15.5l4.5-5"/><circle cx="12" cy="15.5" r="1.2"/>`,
  board: html`<rect x="4" y="6.5" width="7" height="7" rx="1"/><rect x="13.5" y="9" width="5.5" height="4.5" rx="1"/><path d="M6 15.5h12a2.5 2.5 0 0 1 0 5H6a2.5 2.5 0 0 1 0-5z"/><path d="M6 18h.01M12 18h.01M18 18h.01"/>`,
  blockers: html`<path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5V14"/><path d="M12 17.2h.01"/>`,
  errors: html`<path d="M6 3.5v17"/><path d="M6 4.5h11l-2 4 2 4H6"/>`,
  tasks: html`<path d="M4 7.5l2 2 3.5-3.5"/><path d="M4 16.5l2 2 3.5-3.5"/><path d="M13 7h7M13 17h7"/>`,
  notes: html`<rect x="5" y="4.5" width="14" height="16.5" rx="2"/><rect x="9" y="2.5" width="6" height="3.5" rx="1"/><path d="M8.5 11h7M8.5 15h4.5"/>`,
  assistant: html`<rect x="4.5" y="8" width="15" height="11.5" rx="3"/><path d="M12 4.5V8"/><circle cx="12" cy="3.5" r="1"/><path d="M9.5 13v1M14.5 13v1"/><path d="M2.5 12.5v3M21.5 12.5v3"/>`,
  activity: html`<path d="M3 12h4l2.5-6.5 5 13 2.5-6.5h4"/>`,
  admin: html`<path d="M12 3l7.5 3v5.5c0 4.5-3.2 8.2-7.5 9.5-4.3-1.3-7.5-5-7.5-9.5V6z"/><path d="M9 12l2 2 4-4"/>`,
  refresh: html`<path d="M20 12a8 8 0 1 1-2.34-5.66L20 8"/><path d="M20 3.5V8h-4.5"/>`,
  settings: html`<path d="M19.6 10.25 21.9 10.61 21.9 13.39 19.6 13.75 18.61 16.13 19.99 18.02 18.02 19.99 16.13 18.61 13.75 19.6 13.39 21.9 10.61 21.9 10.25 19.6 7.87 18.61 5.98 19.99 4.01 18.02 5.39 16.13 4.4 13.75 2.1 13.39 2.1 10.61 4.4 10.25 5.39 7.87 4.01 5.98 5.98 4.01 7.87 5.39 10.25 4.4 10.61 2.1 13.39 2.1 13.75 4.4 16.13 5.39 18.02 4.01 19.99 5.98 18.61 7.87Z"/><circle cx="12" cy="12" r="3"/>`,
  back: html`<path d="M15 5l-7 7 7 7"/>`,
  left: html`<path d="M15 5l-7 7 7 7"/>`,
  right: html`<path d="M9 5l7 7-7 7"/>`,
  up: html`<path d="M5 15l7-7 7 7"/>`,
  down: html`<path d="M5 9l7 7 7-7"/>`,
  plus: html`<path d="M12 5v14M5 12h14"/>`,
  check: html`<path d="M5 12.5l4.5 4.5L19 7.5"/>`,
  close: html`<path d="M6 6l12 12M18 6L6 18"/>`,
  drawing: html`<path d="M4 20V4h16v16z"/><path d="M4 9h16M9 9v11"/><path d="M12.5 13h4M12.5 16h3"/>`,
  info: html`<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8h.01"/>`,
  search: html`<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>`,
  send: html`<path d="M4 12l16-8-6 16-2.5-6.5z"/>`,
  trash: html`<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/>`
};

export function Icon({ name, size = 22, title }){
  return html`
    <svg class="ic" width=${size} height=${size} viewBox="0 0 24 24" aria-hidden=${title ? undefined : 'true'} role=${title ? 'img' : undefined}>
      ${title && html`<title>${title}</title>`}
      ${PATHS[name] || null}
    </svg>`;
}
