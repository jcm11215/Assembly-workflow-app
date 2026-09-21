/** PDF -> page images, and image downscaling for upload. */

/* ================= BLUEPRINT EXTRACTION ================= */

export function fileToBase64Raw(file){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = ()=> resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
// Downscales large photos before sending, so uploads stay fast on shop-floor wifi/cell.

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

// PDFs are rendered to images with pdf.js rather than uploaded raw -- this is
// far more reliable across drawing exports and keeps the payload small.
export let pdfjsReadyPromise = null;

export function ensurePdfJs(){
  if(window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if(pdfjsReadyPromise) return pdfjsReadyPromise;
  pdfjsReadyPromise = new Promise((resolve, reject)=>{
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = ()=>{
      try{
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        resolve(window.pdfjsLib);
      }catch(e){ reject(e); }
    };
    script.onerror = ()=> reject(new Error('Could not load the PDF reader. Check your connection and try again, or upload a photo/image instead.'));
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
    let text = '';
    if(opts.textLayer){
      // Never worth failing a scan over: the image is the real input.
      try { text = textLayerFromItems((await page.getTextContent()).items); } catch (e) { text = ''; }
    }
    images.push({base64: dataUrl.split(',')[1], mime:'image/jpeg', page: i,
                 width: canvas.width, height: canvas.height, text});
  }
  return images;
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
