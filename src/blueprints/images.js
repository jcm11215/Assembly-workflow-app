/**
 * Blueprint image access + in-memory cache.
 *
 * Images now live in a Supabase Storage bucket, not in a jsonb column.
 * The UI still deals in base64 strings, so this module keeps that
 * interface and does the Storage round-trip behind it.
 */
import * as blueprintsRepo from '../db/blueprintsRepo.js';
import { state } from '../state/store.js';
import { refreshOpenModal } from '../ui/components/modal.js';

/** jobId -> base64 once loaded, or false if confirmed missing. */
export const blueprintImageCache = {};

/**
 * Persist an image together with whatever spec/BOM the job currently
 * holds -- Storage upload plus a blueprints row, in one call.
 */
export async function saveBlueprintImage(jobId, base64Jpeg){
  if(!base64Jpeg) return false;
  const job = state.jobs.find(j => j.id === jobId);
  try {
    await blueprintsRepo.saveExtraction(jobId, {
      spec: job ? job.spec ?? null : null,
      validation: job ? job.validation ?? null : null,
      components: job ? job.billOfMaterials || [] : [],
      imageBase64: base64Jpeg
    });
    delete blueprintImageCache[jobId];   // force a refetch of the new image
    return true;
  } catch (e) {
    console.error('saveBlueprintImage failed', e);
    return false;
  }
}

export async function fetchBlueprintImage(jobId){
  try { return await blueprintsRepo.getImage(jobId); }
  catch (e) { console.error('fetchBlueprintImage failed', e); return null; }
}

/**
 * Fetches once and caches, then refreshes whichever modal is open. The
 * cache is what gets read on re-render, so the image survives any number
 * of modal rebuilds (checklist toggles, stage advances).
 */
export async function ensureBlueprintImageLoaded(jobId){
  const base64 = await fetchBlueprintImage(jobId);
  blueprintImageCache[jobId] = base64 || false;
  refreshOpenModal();
}
