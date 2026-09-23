/** PDF -> page images, and image downscaling for upload. */

export function fileToBase64Raw(file){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = ()=> resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
// Downscales large photos before sending, so uploads stay fast on shop-floor wifi/cell.
export function fileToImageBase64Resized(file, maxDim, quality){
  maxDim = maxDim || 1400; quality = quality || 0.78;
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = ()=>{
      const img = new Image();
      img.onload = ()=>{
        let width = img.width, height = img.height;
        if(width > maxDim || height > maxDim){
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width*scale); height = Math.round(height*scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,width,height);
        ctx.drawImage(img,0,0,width,height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve({base64: dataUrl.split(',')[1], mime:'image/jpeg'});
      };
      img.onerror = ()=>reject(new Error('Could not read that image file.'));
      img.src = reader.result;
    };
    reader.onerror = ()=>reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}
// PDFs are rendered to images with pdf.js rather than uploaded raw -- this is
// far more reliable across drawing exports and keeps the payload small.
// pdf.js is served from this app's own server (web/vendor/pdfjs), loaded
// the first time a PDF is opened.
export let pdfjsReadyPromise = null;

export function ensurePdfJs(){
  if(window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if(pdfjsReadyPromise) return pdfjsReadyPromise;
  pdfjsReadyPromise = new Promise((resolve, reject)=>{
    const script = document.createElement('script');
    script.src = '/vendor/pdfjs/pdf.min.js';
    script.onload = ()=>{
      try{
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
        resolve(window.pdfjsLib);
      }catch(e){ reject(e); }
    };
    script.onerror = ()=>{
      pdfjsReadyPromise = null;
      reject(new Error('Could not load the PDF reader. Check the connection and try again, or upload a photo instead.'));
    };
    document.head.appendChild(script);
  });
  return pdfjsReadyPromise;
}

// Upper bound on pages sent to the AI -- well above a normal fab set
// (10-20 sheets), there only so a stray 200-page PDF can't hang a phone.
export const MAX_PDF_PAGES = 40;

/** Page count, for the "Pages to scan" hint -- parses the file, renders nothing. */
export async function pdfPageCount(file){
  const pdfjsLib = await ensurePdfJs();
  const pdf = await pdfjsLib.getDocument({data: await file.arrayBuffer()}).promise;
  return pdf.numPages;
}

/**
 * Reads the "Pages to scan" box. Blank or "all" -> every page (the first
 * maxPages of them). Otherwise a list like "1-3, 7, 10-12". Returns
 * {pages} or {error} and never throws, so the form can say exactly
 * what's wrong before anything is sent to the AI.
 */
export function parsePageSelection(text, numPages, maxPages){
  const s = String(text || '').trim().toLowerCase();
  if(!s || s === 'all'){
    return { pages: Array.from({ length: Math.min(numPages, maxPages) }, (_, i) => i + 1) };
  }
  const pages = new Set();
  for(const part of s.split(',').map(p => p.trim()).filter(Boolean)){
    // Accepts an en dash too -- phone keyboards love to "fix" 1-3 into 1–3.
    const m = part.match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
    if(!m) return { error: `"${part}" isn't a page or range -- use something like 1-3, 7.` };
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
    if(a < 1 || b < a) return { error: `"${part}" isn't a valid page range.` };
    if(b > numPages) return { error: `This PDF only has ${numPages} page${numPages === 1 ? '' : 's'}.` };
    for(let p = a; p <= b; p++) pages.add(p);
  }
  if(!pages.size) return { error: 'Enter at least one page, or leave it blank for all.' };
  if(pages.size > maxPages) return { error: `Pick ${maxPages} pages or fewer.` };
  return { pages: [...pages].sort((x, y) => x - y) };
}

/** Per-page cap on selectable text. A parts table is a few thousand
 *  characters; past this it's usually a notes block or a vendor datasheet
 *  bound into the set, and the model's context is better spent on images. */
export const MAX_TEXT_LAYER_CHARS = 4000;

/**
 * A page's selectable text, one line per row of the sheet.
 *
 * pdf.js hands back text runs in drawing order, which on a CAD export is
 * whatever order the CAD program wrote them in -- a parts table comes
 * back as every item number, then every description, then every
 * quantity. Grouping runs by their height on the page and sorting each
 * row left to right puts a table row back on one line, which is what
 * makes the text worth sending. Pure function of pdf.js's items, so it
 * can be tested without a PDF.
 */
export function textItemsToLines(items){
  const runs = (items || [])
    .filter(it => it && typeof it.str === 'string' && it.str.trim() && Array.isArray(it.transform))
    .map(it => ({ str: it.str.trim(), x: it.transform[4], y: it.transform[5],
                  h: Math.abs(it.height || it.transform[3] || 0) }));
  // Top of the sheet first (PDF y grows upward), then left to right.
  runs.sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const lines = [];
  for(const r of runs){
    const line = lines[lines.length - 1];
    const tol = Math.max(2, Math.min(line ? line.h : r.h, r.h || 0) * 0.5);
    if(line && Math.abs(line.y - r.y) <= tol){ line.runs.push(r); line.h = Math.max(line.h, r.h); }
    else lines.push({ y: r.y, h: r.h, runs: [r] });
  }
  return lines
    .map(l => l.runs.sort((a, b) => a.x - b.x).map(r => r.str).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export function textLayerFromItems(items, maxChars){
  maxChars = maxChars || MAX_TEXT_LAYER_CHARS;
  const text = textItemsToLines(items).join('\n');
  // A scanned sheet has no text, and CAD fonts exported as outlines leave
  // only stray characters: nothing worth the tokens.
  if(text.replace(/\s/g, '').length < 20) return '';
  return text.length > maxChars ? text.slice(0, maxChars) + '\n[... more text on this page, cut off here]' : text;
}

/**
 * A page's text runs with where they sit: {str, x, y, w, h} as fractions
 * of the rendered page, 0,0 top-left. `toPage(x, y)` turns a PDF point
 * into canvas pixels (pdf.js's viewport does, rotation included); `size`
 * is the canvas's {width, height}. Pure, so it is tested without a PDF.
 */
export function textRuns(items, toPage, size){
  const out = [];
  for(const it of items || []){
    if(!it || typeof it.str !== 'string' || !it.str.trim() || !Array.isArray(it.transform)) continue;
    const [, , , , e, f] = it.transform;
    const h = Math.abs(it.height || it.transform[3] || 0), w = Math.abs(it.width || 0);
    const [x1, y1] = toPage(e, f), [x2, y2] = toPage(e + w, f + h);
    const x = Math.min(x1, x2) / size.width, y = Math.min(y1, y2) / size.height;
    out.push({ str: it.str.trim(), x, y, w: Math.abs(x2 - x1) / size.width, h: Math.abs(y2 - y1) / size.height, item: it });
  }
  return out;
}

const HEADER = {
  item: /^(ITEM|ITEM\s*NO\.?|ITEM\s*#|NO\.?|FIND|FIND\s*NO\.?|BALLOON)$/i,
  qty: /^(QTY\.?|QUANTITY|REQ'?D)$/i,
  desc: /^(DESCRIPTION|DESC\.?|PART\s*(NO\.?|NUMBER|NAME)|PART)$/i
};

/**
 * What the app can find on a page without any AI, from its text runs:
 *
 *   numbers  every standalone 1-3 digit number and its centre -- balloon
 *            numbers on a CAD export are usually real text
 *   bomBox   [x, y, w, h] around the parts table, found from its header
 *            row (ITEM / QTY / DESCRIPTION) and the item numbers lined up
 *            under or over it; null when there isn't one
 *
 * A scanned sheet has no text runs and gets neither -- the AI reads it
 * whole, as before.
 */
export function indexPage(runs){
  const numbers = (runs || []).filter(r => /^\d{1,3}$/.test(r.str))
    .map(r => ({ n: Number(r.str), x: r.x + r.w / 2, y: r.y + r.h / 2 }));

  // The header row: runs of two or more header kinds on one line.
  const heads = (runs || []).map(r => ({ r, kind: Object.keys(HEADER).find(k => HEADER[k].test(r.str)) })).filter(h => h.kind);
  let best = null;
  for(const h of heads){
    const row = heads.filter(o => Math.abs((o.r.y + o.r.h / 2) - (h.r.y + h.r.h / 2)) < Math.max(0.006, h.r.h));
    const kinds = new Set(row.map(o => o.kind));
    if(kinds.size >= 2 && kinds.has('item') && (!best || row.length > best.length)) best = row;
  }
  if(!best) return { numbers, bomBox: null };

  const itemHead = best.find(o => o.kind === 'item').r;
  const colX = itemHead.x + itemHead.w / 2, tol = Math.max(0.02, itemHead.w);
  const headY = itemHead.y + itemHead.h / 2;
  // Item numbers in that column, walking away from the header in the
  // direction the table runs (CAD tables grow up or down), stopping at
  // the first gap much bigger than a row.
  const col = numbers.filter(n => Math.abs(n.x - colX) <= tol && Math.abs(n.y - headY) < 0.6);
  const pick = sign => {
    const side = col.filter(n => (n.y - headY) * sign > 0).sort((a, b) => Math.abs(a.y - headY) - Math.abs(b.y - headY));
    const rows = [];
    let last = headY, step = null;
    for(const n of side){
      const gap = Math.abs(n.y - last);
      if(step != null && gap > step * 3 + 0.01) break;
      if(rows.length) step = step == null ? gap : Math.min(step, gap) || step;
      rows.push(n); last = n.y;
    }
    return rows;
  };
  const down = pick(1), up = pick(-1);
  const rows = down.length >= up.length ? down : up;
  if(rows.length < 2) return { numbers, bomBox: null };

  const ys = [headY, ...rows.map(r => r.y)];
  const top = Math.min(...ys), bottom = Math.max(...ys);
  const rowH = itemHead.h;
  const left = Math.min(...best.map(o => o.r.x), colX - tol);
  // The description column runs past its header: take every run on the
  // table's lines, starting from the table's left edge.
  const inBand = (runs || []).filter(r => r.x >= left - 0.01 && r.y + r.h / 2 >= top - rowH && r.y + r.h / 2 <= bottom + rowH);
  const right = Math.max(...best.map(o => o.r.x + o.r.w), ...inBand.map(r => Math.min(r.x + r.w, left + 0.7)));
  const pad = 0.012;
  const x = Math.max(0, left - pad), y = Math.max(0, top - rowH - pad);
  return { numbers, bomBox: [x, y, Math.min(1, right + pad) - x, Math.min(1, bottom + rowH + pad) - y] };
}

/** Is a point inside [x, y, w, h]? */
export const inBox = (p, b) => !!b && p.x >= b[0] && p.x <= b[0] + b[2] && p.y >= b[1] && p.y <= b[1] + b[3];

/** Renders the given 1-based pages (default: every page, up to maxPages).
 *  Each image carries its real page number, so the AI can be told which
 *  sheet it's looking at even when pages are skipped. With
 *  opts.textLayer, each also carries the page's selectable text. */
export async function pdfFileToImages(file, maxPages, maxDim, quality, pageNumbers, opts){
  opts = opts || {};
  maxPages = maxPages || 10; maxDim = maxDim || 1700; quality = quality || 0.82;
  const pdfjsLib = await ensurePdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({data: buf}).promise;
  const wanted = (pageNumbers && pageNumbers.length
      ? pageNumbers
      : Array.from({ length: pdf.numPages }, (_, i) => i + 1))
    .filter(n => n >= 1 && n <= pdf.numPages)
    .slice(0, maxPages);
  const images = [];
  for(const i of wanted){
    const page = await pdf.getPage(i);
    const baseViewport = page.getViewport({scale:1});
    const scale = Math.max(0.5, Math.min(maxDim/baseViewport.width, maxDim/baseViewport.height, 3));
    const viewport = page.getViewport({scale});
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height);
    await page.render({canvasContext: ctx, viewport}).promise;
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    // Real pixel size travels with the page: cropping to a region of it
    // needs the aspect ratio, and the canvas is the only place it's known
    // without decoding the image again.
    let text = '', index = null, crop = null;
    if(opts.textLayer){
      // Never worth failing a scan over: the image is the real input.
      try {
        const items = (await page.getTextContent()).items;
        text = textLayerFromItems(items);
        const runs = textRuns(items, (x, y) => baseViewport.convertToViewportPoint(x, y), baseViewport);
        if(runs.length){
          index = indexPage(runs);
          if(index.bomBox) crop = await renderCrop(page, baseViewport, index.bomBox, runs, quality);
        }
      } catch (e) { console.error('reading the PDF text failed', e); }
    }
    images.push({base64: dataUrl.split(',')[1], mime:'image/jpeg', page: i,
                 width: canvas.width, height: canvas.height, text,
                 index: index && { numbers: index.numbers, bomBox: index.bomBox }, crop});
  }
  return images;
}

/**
 * The parts table alone, rendered large -- small table text that is a
 * blur at whole-sheet size is sharp here -- with just its own text.
 */
async function renderCrop(page, baseViewport, box, runs, quality){
  const [bx, by, bw, bh] = box;
  const longest = Math.max(bw * baseViewport.width, bh * baseViewport.height);
  const scale = Math.max(1, Math.min(6, 1600 / longest));
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(bw * vp.width));
  canvas.height = Math.max(1, Math.ceil(bh * vp.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, -bx * vp.width, -by * vp.height] }).promise;
  const inside = runs.filter(r => inBox({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, box)).map(r => r.item);
  return { base64: canvas.toDataURL('image/jpeg', quality).split(',')[1], mime: 'image/jpeg', box, text: textLayerFromItems(inside) };
}

// Shrinks an already-decoded base64 image to a genuinely tiny preview
// (target ~160px wide, low quality -- a few KB) for the job card
// thumbnail. Takes the image ALREADY generated for the AI call as its
// source, so this never re-renders a PDF page or re-reads the original
// file -- just a cheap resize of something already small.
export function shrinkBase64Image(base64, mime, maxDim, quality){
  maxDim = maxDim || 160; quality = quality || 0.55;
  return new Promise((resolve, reject)=>{
    const img = new Image();
    img.onload = ()=>{
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      resolve(dataUrl.split(',')[1]);
    };
    img.onerror = ()=> reject(new Error('Could not generate thumbnail'));
    img.src = `data:${mime};base64,${base64}`;
  });
}
