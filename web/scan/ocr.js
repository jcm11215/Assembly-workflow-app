/**
 * Free text recognition for sheets that have no text of their own -- a
 * scanned PDF or a photo of a paper drawing -- with Tesseract, served
 * from this server (web/vendor/tesseract) and run in the browser.
 *
 * It yields the same {str, x, y, w, h} runs a CAD PDF's text does, so a
 * paper drawing gets the same treatment: its parts table found and
 * enlarged for the AI (or read outright, when the recognised text forms
 * a clean table), and the table's item numbers located on the views as
 * hints for the balloon search. Best effort: if anything here fails the
 * scan goes ahead exactly as it would have without it.
 */
let workerPromise = null;

function loadScript(src){
  return new Promise((resolve, reject) => {
    if(window.Tesseract) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the text reader.'));
    document.head.appendChild(s);
  });
}

/** WebAssembly SIMD: the faster engine build when the browser has it. */
function simdSupported(){
  try {
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch { return false; }
}

function worker(){
  if(!workerPromise){
    workerPromise = (async () => {
      await loadScript('/vendor/tesseract/tesseract.min.js');
      const core = simdSupported() ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js';
      const w = await window.Tesseract.createWorker('eng', 1, {
        workerPath: '/vendor/tesseract/worker.min.js',
        corePath: `/vendor/tesseract/${core}`,
        langPath: '/vendor/tesseract/lang',
        workerBlobURL: false,
        gzip: true
      });
      return w;
    })().catch(e => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

/**
 * The recognised words on a canvas, as runs; words it isn't reasonably
 * sure of are left out rather than guessed. `region` [x, y, w, h] reads
 * just that part (runs still come back in whole-canvas fractions).
 *
 * `mode` is Tesseract's page segmentation: '11' (scattered text) finds
 * words spread over a drawing but drops lone digits; '4' (a column of
 * text) reads a table's rows whole, item numbers and quantities included.
 */
export async function ocrRuns(canvas, { mode = '11', region = null } = {}){
  const w = await worker();
  await w.setParameters({ tessedit_pageseg_mode: mode });
  const rect = region && {
    left: Math.round(region[0] * canvas.width), top: Math.round(region[1] * canvas.height),
    width: Math.round(region[2] * canvas.width), height: Math.round(region[3] * canvas.height)
  };
  const { data } = await w.recognize(canvas, rect ? { rectangle: rect } : {}, { blocks: true, text: false });
  const runs = [];
  for(const block of data.blocks || []){
    for(const para of block.paragraphs || []){
      for(const line of para.lines || []){
        for(const word of line.words || []){
          const t = String(word.text || '').trim();
          if(!t || word.confidence < 55) continue;
          const { x0, y0, x1, y1 } = word.bbox;
          runs.push({ str: t, x: x0 / canvas.width, y: y0 / canvas.height, w: (x1 - x0) / canvas.width, h: (y1 - y0) / canvas.height });
        }
      }
    }
  }
  return runs;
}

/** Frees the engine's memory once a scan's pages are read. */
export async function ocrDone(){
  if(!workerPromise) return;
  const p = workerPromise;
  workerPromise = null;
  try { await (await p).terminate(); } catch { /* already gone */ }
}
