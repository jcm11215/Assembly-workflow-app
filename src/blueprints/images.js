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
