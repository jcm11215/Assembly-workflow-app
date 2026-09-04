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

export async function pdfFileToImages(file, maxPages, maxDim, quality){
  maxPages = maxPages || 10; maxDim = maxDim || 1700; quality = quality || 0.82;
  const pdfjsLib = await ensurePdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({data: buf}).promise;
  const numPages = Math.min(pdf.numPages, maxPages);
  const images = [];
  for(let i=1; i<=numPages; i++){
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
    images.push({base64: dataUrl.split(',')[1], mime:'image/jpeg'});
  }
  return images;
}
