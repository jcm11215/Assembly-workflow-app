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
  knowledge: html`<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5z"/><path d="M8.5 7.5h7M8.5 11h5"/>`,
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
  home: html`<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/>`,
  jobs: html`<rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M3.5 9h17M8 13h8M8 16.5h5"/>`,
  issues: html`<path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5V14"/><path d="M12 17.2h.01"/>`,
  team: html`<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>`,
  more: html`<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>`,
  menu: html`<path d="M4 7h16M4 12h16M4 17h16"/>`,
  list: html`<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>`,
  columns: html`<rect x="3.5" y="4" width="5" height="16" rx="1.5"/><rect x="9.5" y="4" width="5" height="11" rx="1.5"/><rect x="15.5" y="4" width="5" height="7" rx="1.5"/>`,
  move: html`<path d="M5 12h14M14 7l5 5-5 5"/>`,
  edit: html`<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>`,
  note: html`<path d="M5 4.5h14v11l-4.5 4.5H5z"/><path d="M14.5 20v-4.5H19"/><path d="M8.5 9h7M8.5 12.5h4.5"/>`,
  flag: html`<path d="M6 3.5v17"/><path d="M6 4.5h11l-2 4 2 4H6"/>`,
  scan: html`<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M7.5 12h9"/>`,
  upload: html`<path d="M12 16V4.5M7.5 9 12 4.5 16.5 9"/><path d="M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15"/>`,
  logout: html`<path d="M15 4.5h3.5A1.5 1.5 0 0 1 20 6v12a1.5 1.5 0 0 1-1.5 1.5H15"/><path d="M10 16.5 5.5 12 10 7.5M5.5 12H15"/>`,
  sparkle: html`<path d="M12 3.5l1.9 5.1L19 10.5l-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/><path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>`,
  inbox: html`<path d="M3.5 13.5 6 5h12l2.5 8.5V19a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z"/><path d="M3.5 13.5H8.5l1.5 2.5h4l1.5-2.5h5"/>`,
  clock: html`<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>`,
  alert: html`<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5M12 16h.01"/>`,
  checkCircle: html`<circle cx="12" cy="12" r="8.5"/><path d="M8 12.2l2.7 2.7L16.2 9.4"/>`,
  book: html`<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5z"/>`,
  trash: html`<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/>`
};

export function Icon({ name, size = 22, title }){
  return html`
    <svg class="ic" width=${size} height=${size} viewBox="0 0 24 24" aria-hidden=${title ? undefined : 'true'} role=${title ? 'img' : undefined}>
      ${title && html`<title>${title}</title>`}
      ${PATHS[name] || null}
    </svg>`;
}
