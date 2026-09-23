/**
 * The dashboard's charts, drawn in plain HTML so they stay sharp at any
 * width and follow the theme: a card with a legend and a table view,
 * horizontal bars split into segments, and columns.
 *
 * A bar is a button when picking it means something (it filters the
 * dashboard). Every bar shows its numbers in a tooltip on hover and on
 * keyboard focus, and every chart can be read as a table instead.
 */
import { html, useRef, useState } from '../vendor/index.js';
import { Icon } from './icons.js';

/** A chart's frame: title, legend, the chart, and a switch to a table. */
export function ChartCard({ title, sub, legend, table, children, class: cls = '' }){
  const [asTable, setAsTable] = useState(false);
  return html`
    <section class=${`card viz-card ${cls}`}>
      <header class="viz-head">
        <div style=${{ minWidth: 0 }}>
          <h2>${title}</h2>
          ${sub && html`<div class="viz-sub">${sub}</div>`}
        </div>
        ${table && html`
          <button type="button" class="icon-btn" aria-pressed=${asTable} onClick=${() => setAsTable(!asTable)}
                  title=${asTable ? 'Show as a chart' : 'Show as a table'} aria-label=${asTable ? `Show ${title} as a chart` : `Show ${title} as a table`}>
            <${Icon} name=${asTable ? 'columns' : 'list'} size=${18} />
          </button>`}
      </header>
      ${!asTable && legend && html`<${Legend} series=${legend} />`}
      <div class="viz-body">${asTable ? html`<${DataTable} ...${table} />` : children}</div>
    </section>`;
}

export function Legend({ series }){
  return html`
    <ul class="viz-legend">
      ${series.map(s => html`<li key=${s.id}><span class="viz-swatch" style=${{ background: s.color }}></span>${s.label}</li>`)}
    </ul>`;
}

function DataTable({ head, rows }){
  return html`
    <table class="table viz-table">
      <thead><tr>${head.map((h, i) => html`<th key=${i} class=${i ? 'num' : ''}>${h}</th>`)}</tr></thead>
      <tbody>${rows.map((r, i) => html`<tr key=${i}>${r.map((c, j) => html`<td key=${j} class=${j ? 'num' : ''}>${c}</td>`)}</tr>`)}</tbody>
    </table>`;
}

/**
 * One tooltip per chart, placed at the pointer, or above a bar that has
 * keyboard focus. `content` is { title, rows: [{ label, value, color }] }.
 */
function useTip(){
  const ref = useRef(null);
  const [tip, setTip] = useState(null);
  const show = (e, content) => {
    const box = ref.current && ref.current.getBoundingClientRect();
    if(!box) return;
    let x, y;
    if(e.type === 'focus'){
      const r = e.currentTarget.getBoundingClientRect();
      x = r.left + r.width / 2 - box.left;
      y = r.top - box.top;
    } else {
      x = e.clientX - box.left;
      y = e.clientY - box.top;
    }
    setTip({ x, y, content, flip: x > box.width / 2 });
  };
  const hide = () => setTip(null);
  const el = tip && html`
    <div class=${`viz-tip${tip.flip ? ' flip' : ''}`} style=${{ left: `${tip.x}px`, top: `${tip.y}px` }} aria-hidden="true">
      <div class="viz-tip-title">${tip.content.title}</div>
      ${tip.content.rows.map((r, i) => html`
        <div key=${i} class="viz-tip-row">
          ${r.color && html`<span class="viz-key" style=${{ background: r.color }}></span>`}
          <b>${r.value}</b><span>${r.label}</span>
        </div>`)}
    </div>`;
  return { ref, show, hide, el };
}

const pickable = (selected, id) => (selected ? (selected === id ? ' sel' : ' dim') : '');

/**
 * Horizontal bars, each split into `series` segments, for categories
 * with long names (stages, people). `rows` are
 * { id, label, fullLabel?, values: { [seriesId]: n }, total }.
 */
export function HBars({ rows, series, selected = '', onSelect, label, unit = 'job' }){
  const tip = useTip();
  const max = Math.max(1, ...rows.map(r => r.total));
  const words = n => `${n} ${unit}${n === 1 ? '' : 's'}`;
  return html`
    <div class="hbars" ref=${tip.ref} role="group" aria-label=${label}>
      ${rows.map(r => {
        const name = r.fullLabel || r.label;
        const content = { title: `${name} · ${words(r.total)}`,
          rows: series.map(s => ({ label: s.label, value: r.values[s.id] || 0, color: s.color })) };
        const said = `${name}: ${words(r.total)}${r.total ? ` (${series.filter(s => r.values[s.id]).map(s => `${r.values[s.id]} ${s.label.toLowerCase()}`).join(', ')})` : ''}`;
        return html`
          <button key=${r.id} type="button" class=${`hbar${pickable(selected, r.id)}`} aria-pressed=${selected === r.id}
                  aria-label=${said} onClick=${() => onSelect && onSelect(selected === r.id ? '' : r.id)}
                  onPointerMove=${e => tip.show(e, content)} onPointerLeave=${tip.hide}
                  onFocus=${e => tip.show(e, content)} onBlur=${tip.hide}>
            <span class="hbar-label">${r.label}</span>
            <span class="hbar-track">
              ${r.total > 0 && html`
                <span class="hbar-fill" style=${{ width: `${(r.total / max) * 100}%` }}>
                  ${series.filter(s => r.values[s.id]).map(s => html`
                    <span key=${s.id} class="hbar-seg" style=${{ flexGrow: r.values[s.id], background: s.color }}></span>`)}
                </span>`}
            </span>
            <span class=${`hbar-value${r.total ? '' : ' zero'}`}>${r.total}</span>
          </button>`;
      })}
      ${tip.el}
    </div>`;
}

/**
 * Columns for a short run of ordered categories (due dates, weeks).
 * `cols` are { id, label, value, color }. With `onSelect`, a column is a
 * button that picks it.
 */
export function Columns({ cols, selected = '', onSelect, label, unit = 'job', tipTitle = c => c.label }){
  const tip = useTip();
  const max = Math.max(1, ...cols.map(c => c.value));
  const words = n => `${n} ${unit}${n === 1 ? '' : 's'}`;
  return html`
    <div class="cols" ref=${tip.ref} role="group" aria-label=${label}>
      ${cols.map(c => {
        const content = { title: tipTitle(c), rows: [{ label: unit === 'job' ? (c.value === 1 ? 'job' : 'jobs') : unit, value: c.value, color: c.color }] };
        const inner = html`
          <span class="col-plot">
            <span class=${`col-value${c.value ? '' : ' zero'}`}>${c.value}</span>
            ${c.value > 0 && html`<span class="col-bar" style=${{ height: `${(c.value / max) * 100}%`, background: c.color }}></span>`}
          </span>
          <span class="col-label">${c.label}</span>`;
        const events = {
          onPointerMove: e => tip.show(e, content), onPointerLeave: tip.hide,
          onFocus: e => tip.show(e, content), onBlur: tip.hide
        };
        return onSelect
          ? html`<button key=${c.id} type="button" class=${`col${pickable(selected, c.id)}`} aria-pressed=${selected === c.id}
                         aria-label=${`${tipTitle(c)}: ${words(c.value)}`} onClick=${() => onSelect(selected === c.id ? '' : c.id)} ...${events}>${inner}</button>`
          : html`<div key=${c.id} class="col" tabindex="0" role="img" aria-label=${`${tipTitle(c)}: ${words(c.value)}`} ...${events}>${inner}</div>`;
      })}
      ${tip.el}
    </div>`;
}
