/**
 * Reading a parts table straight from a page's own text -- no AI.
 *
 * A CAD-exported PDF carries every word of its parts table as real text
 * with a position. Rows line up on one height and columns under their
 * headers, so the table can be rebuilt exactly: item number, quantity,
 * description, part number. That is instant, free and never misreads a
 * character. The AI is only needed when the text is missing (a scan or
 * photo) or doesn't form a clean table, and then it reads an enlarged
 * crop of the table instead.
 *
 * Everything here is a pure function of "runs": {str, x, y, w, h} as
 * fractions of the page, 0,0 top-left (pdf.js's textRuns(), or OCR).
 */

/** The kinds of column a parts table has, by header wording. */
const HEADER = {
  item:     /^(ITEM|ITEM\s*(NO\.?|#|NUMBER)|NO\.?|#|FIND(\s*NO\.?)?|BALLOON|MARK|PC\s*MK)$/i,
  qty:      /^(QTY\.?|QUANTITY|REQ'?D|NO\.?\s*REQ'?D|QTY\.?\s*REQ'?D)$/i,
  partNo:   /^(PART\s*(NO\.?|NUMBER|#)|P\/N|PN|DWG\s*NO\.?|STOCK\s*(NO\.?|CODE)?|CAT(ALOG)?\s*NO\.?|MODEL(\s*NO\.?)?)$/i,
  desc:     /^(DESCRIPTION|DESC\.?|PART\s*NAME|PART|NAME|TITLE|COMPONENT)$/i,
  material: /^(MATERIAL|MAT'?L|SPEC(IFICATION)?|SIZE|REMARKS?|NOTES?)$/i
};
const kindOf = str => Object.keys(HEADER).find(k => HEADER[k].test(str.trim())) || null;

const centreY = r => r.y + r.h / 2;
const centreX = r => r.x + r.w / 2;

/**
 * Runs grouped into lines, and neighbouring runs on a line merged into
 * phrases -- "ITEM" and "NO." printed as two runs become "ITEM NO.", and
 * a description split into words becomes one cell.
 */
export function phrases(runs){
  const sorted = (runs || []).filter(r => r && r.str && r.str.trim())
    .slice().sort((a, b) => centreY(a) - centreY(b) || a.x - b.x);
  const lines = [];
  for(const r of sorted){
    const line = lines.find(l => Math.abs(l.y - centreY(r)) <= Math.max(0.004, Math.min(l.h, r.h) * 0.45));
    if(line){ line.runs.push(r); line.h = Math.max(line.h, r.h); }
    else lines.push({ y: centreY(r), h: r.h, runs: [r] });
  }
  const out = [];
  for(const l of lines){
    const rs = l.runs.sort((a, b) => a.x - b.x);
    let cur = null;
    for(const r of rs){
      const gap = cur ? r.x - (cur.x + cur.w) : Infinity;
      if(cur && gap < Math.max(0.0035, r.h * 0.9)){
        cur.str += ' ' + r.str.trim();
        cur.w = Math.max(cur.x + cur.w, r.x + r.w) - cur.x;
        cur.h = Math.max(cur.h, r.h);
        cur.runs.push(r);
      } else {
        cur = { str: r.str.trim(), x: r.x, y: r.y, w: r.w, h: r.h, runs: [r] };
        out.push(cur);
      }
    }
  }
  return out;
}

const isNumber = s => /^\d{1,3}$/.test(String(s).trim());

/**
 * Finds the parts table: its header row (an item column and at least one
 * other kind), its columns, and the item-number rows lined up under or
 * over the header -- CAD tables grow either way. Returns null when there
 * is no table.
 */
export function findTable(runs){
  const ph = phrases(runs);
  const heads = ph.map(p => ({ p, kind: kindOf(p.str) })).filter(h => h.kind);
  let header = null;
  for(const h of heads){
    const row = heads.filter(o => Math.abs(centreY(o.p) - centreY(h.p)) < Math.max(0.006, h.p.h));
    const kinds = new Set(row.map(o => o.kind));
    if(kinds.has('item') && kinds.size >= 2 && (!header || row.length > header.length)) header = row;
  }
  if(!header) return null;
  header = header.slice().sort((a, b) => a.p.x - b.p.x);

  const itemHead = header.find(h => h.kind === 'item').p;
  const colX = centreX(itemHead), tol = Math.max(0.02, itemHead.w);
  const headY = centreY(itemHead);
  const numbers = ph.filter(p => isNumber(p.str) && Math.abs(centreX(p) - colX) <= tol && Math.abs(centreY(p) - headY) < 0.7);

  const walk = sign => {
    const side = numbers.filter(n => (centreY(n) - headY) * sign > 0)
      .sort((a, b) => Math.abs(centreY(a) - headY) - Math.abs(centreY(b) - headY));
    const rows = [];
    let last = headY, step = null;
    for(const n of side){
      const gap = Math.abs(centreY(n) - last);
      if(step != null && gap > step * 3 + 0.01) break;
      if(rows.length) step = step == null ? gap : Math.min(step, gap) || step;
      rows.push(n); last = centreY(n);
    }
    return rows;
  };
  const down = walk(1), up = walk(-1);
  const anchors = down.length >= up.length ? down : up;
  if(anchors.length < 2) return null;

  const rowH = Math.max(itemHead.h, ...anchors.map(a => a.h));
  const ys = [headY, ...anchors.map(centreY)];
  const top = Math.min(...ys) - rowH, bottom = Math.max(...ys) + rowH;
  const left = Math.min(...header.map(h => h.p.x), colX - tol) - 0.005;
  const inBand = ph.filter(p => p.x >= left && centreY(p) >= top && centreY(p) <= bottom);
  const right = Math.max(...header.map(h => h.p.x + h.p.w), ...inBand.map(p => Math.min(p.x + p.w, left + 0.7)));
  const pad = 0.012;
  const x = Math.max(0, left - pad), y = Math.max(0, top - pad);
  const bomBox = [x, y, Math.min(1, right + pad) - x, Math.min(1, bottom + pad) - y];

  return { header: header.map(h => ({ kind: h.kind, str: h.p.str, x: h.p.x, w: h.p.w })), anchors, headY, bomBox, phrases: inBand };
}

/** Which column a cell belongs to. The item column only ever holds the
 *  row's number (that is the anchor); a bare number goes to the
 *  quantity column when it sits nearest that header; any other text goes
 *  to the text column it overlaps, or the nearest one. */
function columnFor(cell, header){
  const cx = centreX(cell);
  const cols = header.filter(h => h.kind !== 'item');
  const nearest = list => list.slice().sort((a, b) => Math.abs(a.x + a.w / 2 - cx) - Math.abs(b.x + b.w / 2 - cx))[0];
  if(isNumber(cell.str)){
    const n = nearest(cols);
    if(n && n.kind === 'qty') return n;
  }
  const text = cols.filter(h => h.kind !== 'qty');
  const overlapping = text.filter(h => cell.x < h.x + h.w && cell.x + cell.w > h.x);
  return overlapping.length ? nearest(overlapping) : nearest(text.length ? text : cols);
}

/**
 * The table's rows: {balloon, quantity, description, part_number,
 * specification}. A line with no item number belongs to the nearest
 * numbered row -- a description wrapped onto a second line.
 */
export function readTable(table){
  if(!table) return [];
  const header = table.header;
  const anchorSet = new Set(table.anchors);
  const rows = table.anchors.map(a => ({ anchor: a, cells: {} }));
  for(const p of table.phrases){
    if(anchorSet.has(p)) continue;
    if(Math.abs(centreY(p) - table.headY) < Math.max(0.004, p.h * 0.6)) continue;   // the header itself
    const row = rows.slice().sort((a, b) => Math.abs(centreY(a.anchor) - centreY(p)) - Math.abs(centreY(b.anchor) - centreY(p)))[0];
    const col = columnFor(p, header);
    if(!row || !col) continue;
    (row.cells[col.kind] = row.cells[col.kind] || []).push(p);
  }
  const text = list => (list || []).sort((a, b) => a.y - b.y || a.x - b.x).map(p => p.str).join(' ').replace(/\s+/g, ' ').trim();
  return rows.map(r => {
    const qty = text(r.cells.qty);
    return {
      balloon: Number(r.anchor.str),
      quantity: /^\d{1,5}$/.test(qty) ? Number(qty) : null,
      description: text(r.cells.desc) || text(r.cells.partNo),
      part_number: r.cells.desc ? text(r.cells.partNo) : '',
      specification: text(r.cells.material)
    };
  }).sort((a, b) => a.balloon - b.balloon);
}

/** Good enough to use instead of asking the AI: at least two rows, most
 *  of them with a description. */
export function tableIsClean(rows){
  if(!rows || rows.length < 2) return false;
  const described = rows.filter(r => r.description && r.description.length >= 2).length;
  return described / rows.length >= 0.6;
}
