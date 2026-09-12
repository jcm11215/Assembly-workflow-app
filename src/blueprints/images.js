/**
 * Blueprint original-file access + in-memory cache.
 *
 * The stored file is whatever was originally uploaded -- a PDF or a
 * photo, unmodified -- not a recompressed preview image. The UI needs
 * to know the mime type to decide how to show it (inline image vs.
 * open-as-PDF), so the cache holds {base64, mimeType}, not a bare string.
 */
import * as blueprintsRepo from '../db/blueprintsRepo.js';
import { state } from '../state/store.js';
import { refreshOpenModal } from '../ui/components/modal.js';
import { pdfFileToImages } from './pdf.js';
import { base64ToBlob } from '../db/supabaseClient.js';

/** jobId -> {base64, mimeType, filename} once loaded, or false if
 *  confirmed missing. */
export const blueprintImageCache = {};

/** Kept for API compatibility -- not currently called from the main
 *  extraction flow (extract.js calls blueprintsRepo.saveExtraction
 *  directly), but matches its new {components, originalFile} shape. */
export async function saveBlueprintImage(jobId, originalFile){
  if(!originalFile || !originalFile.base64) return false;
  const job = state.jobs.find(j => j.id === jobId);
  try {
    await blueprintsRepo.saveExtraction(jobId, {
      components: job ? job.billOfMaterials || [] : [],
      originalFile
    });
    delete blueprintImageCache[jobId];   // force a refetch of the new file
    return true;
  } catch (e) {
    console.error('saveBlueprintImage failed', e);
    return false;
  }
}

export async function fetchBlueprintImage(jobId){
  try { return await blueprintsRepo.getOriginalFile(jobId); }
  catch (e) { console.error('fetchBlueprintImage failed', e); return null; }
}

/**
 * Fetches once and caches, then refreshes whichever modal is open. The
 * cache is what gets read on re-render, so the file survives any number
 * of modal rebuilds (checklist toggles, stage advances).
 */
export async function ensureBlueprintImageLoaded(jobId){
  const file = await fetchBlueprintImage(jobId);
  blueprintImageCache[jobId] = file || false;
  refreshOpenModal();
}

/**
 * The component map (ui.js's componentMapHtml) overlays pins on the exact
 * page image the AI reported each component's position against -- for a
 * PDF that means re-rendering that one page as an image client-side with
 * the same pdf.js path the scan itself uses, not the whole original file.
 * A plain image *is* its own page 1, so it's served straight from the
 * already-cached original file with no re-render.
 * jobId:page -> {base64, mime} once rendered, or false if it failed.
 */
export const componentMapPageCache = {};

export async function ensureComponentMapPageLoaded(jobId, page){
  const key = `${jobId}:${page}`;
  if(componentMapPageCache[key] !== undefined) return;
  let original = blueprintImageCache[jobId];
  if(original === undefined){
    original = await fetchBlueprintImage(jobId);
    blueprintImageCache[jobId] = original || false;
  }
  if(!original){ componentMapPageCache[key] = false; refreshOpenModal(); return; }
  try {
    if(original.mimeType !== 'application/pdf'){
      // The original photo/image IS the page the AI looked at -- page 1.
      componentMapPageCache[key] = { base64: original.base64, mime: original.mimeType };
    } else {
      const blob = base64ToBlob(original.base64, original.mimeType);
      const [rendered] = await pdfFileToImages(blob, 1, 1600, 0.85, [page]);
      componentMapPageCache[key] = rendered ? { base64: rendered.base64, mime: rendered.mime } : false;
    }
  } catch (e) {
    console.error('ensureComponentMapPageLoaded failed', e);
    componentMapPageCache[key] = false;
  }
  refreshOpenModal();
}
