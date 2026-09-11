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

/** Renders the given 1-based pages (default: every page, up to maxPages).
 *  Each image carries its real page number, so the AI can be told which
 *  sheet it's looking at even when pages are skipped. */
export async function pdfFileToImages(file, maxPages, maxDim, quality, pageNumbers){
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
    images.push({base64: dataUrl.split(',')[1], mime:'image/jpeg', page: i});
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
