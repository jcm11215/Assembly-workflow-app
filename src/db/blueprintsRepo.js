/**
 * Blueprints repository.
 *
 * The original uploaded file lives in Supabase Storage; the extracted
 * components live relationally. Each scan inserts a new row rather than
 * overwriting the last, so history is preserved -- this module owns the
 * version numbering and the comparison helpers built on it. The approval
 * half of that (status/confidence/auto-approval) is gone: a scan now
 * keeps only its components and the file they came from.
 */
import { db, storage, BLUEPRINT_BUCKET, base64ToBlob, blobToBase64, currentUserId }
  from './supabaseClient.js';
import { COMPONENT_COLS, rowToComponent, componentToRow } from './mappers.js';

const SEL = 'select=id,job_id,storage_path,original_filename,original_mime_type,' +
            'status,version,extracted_at';

/**
 * The blueprint driving the job's parts list and component map: simply
 * the latest scan. There is no approval step to defer to -- a re-scan
 * replaces what the floor sees as soon as it finishes, which is why
 * every scan is kept as its own version rather than overwriting.
 */
export async function getForJob(jobId){
  const rows = await db.select('blueprints', `${SEL}&job_id=eq.${jobId}&order=version.desc&limit=1`);
  if(!rows.length) return null;
  const bp = rows[0];
  bp.components = await listComponents(bp.id);
  return bp;
}

export async function listComponents(blueprintId){
  const rows = await db.select('blueprint_components',
    `select=${COMPONENT_COLS}&blueprint_id=eq.${blueprintId}&order=sort_order.asc`);
  return rows.map(rowToComponent);
}

/** Every version for a job, newest first -- the raw material for a
 *  "compare versions" / history UI. Lightweight: no components attached. */
export async function listVersions(jobId){
  return db.select('blueprints', `${SEL}&job_id=eq.${jobId}&order=version.desc`);
}

export async function getVersion(blueprintId){
  const rows = await db.select('blueprints', `${SEL}&id=eq.${blueprintId}`);
  if(!rows.length) return null;
  const bp = rows[0];
  bp.components = await listComponents(bp.id);
  return bp;
}

/**
 * Persist an extraction as a new version. Image uploads first so a row
 * is never created claiming an image that doesn't exist (Phase 3
 * behavior, unchanged). `status`/`confidence`/`urgency`/`autoApproved`
 * come from spec.js's determineExtractionStatus() -- this function does
 * not decide review policy, only records the decision.
 */
// Maps a mime type to the extension the storage path gets, so a PDF
// stays a real .pdf object (openable/downloadable as one) rather than
// being uploaded with a misleading .jpg name.
const EXT_BY_MIME = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg', 'image/jpg': 'jpg',
  'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic'
};

/**
 * Saves an extraction: the components (the one thing that matters going
 * forward) plus the ORIGINAL uploaded file, unmodified, so it can be
 * opened later exactly as it was provided -- not a recompressed preview
 * image. spec/validation/confidence/status are accepted for backward
 * compatibility with older callers but are no longer persisted; nothing
 * reviews or displays them anymore.
 */
export async function saveExtraction(jobId, {
  components, originalFile, thumbnail   // { base64, mimeType, filename }, small base64 jpeg or null
}){
  let storagePath = null;
  if(originalFile && originalFile.base64){
    const ext = EXT_BY_MIME[originalFile.mimeType] || 'bin';
    storagePath = `${jobId}/${Date.now()}.${ext}`;
    try {
      await storage.upload(BLUEPRINT_BUCKET, storagePath,
        base64ToBlob(originalFile.base64), originalFile.mimeType || 'application/octet-stream');
    } catch (e) {
      console.error('blueprint file upload failed', e);
      storagePath = null;
    }
  }

  const version = await nextVersion(jobId);

  const row = {
    job_id: jobId,
    version,
    storage_path: storagePath,
    original_filename: (originalFile && originalFile.filename) || null,
    original_mime_type: (originalFile && originalFile.mimeType) || null,
    thumbnail_base64: thumbnail || null,
    status: 'extracted',   // no review workflow anymore -- kept only because the column is not-null
    extracted_by: currentUserId()
  };

  const [bp] = await db.insert('blueprints', row);

  if(components && components.length){
    await db.insert('blueprint_components',
      components.map((c, i) => componentToRow({ ...c, sortOrder: i }, bp.id)), { returning: false });
  }
  return bp;
}

async function nextVersion(jobId){
  const rows = await db.select('blueprints',
    `select=version&job_id=eq.${jobId}&order=version.desc&limit=1`);
  return rows.length ? rows[0].version + 1 : 1;
}

/**
 * Structural diff between two versions -- which dimensions changed
 * value or confidence, and which components were added, removed, or
 * changed. Pure function once both versions are loaded; no writes.
 */
export function diffVersions(a, b){
  const dims = [];
  const walkPair = (pathPrefix, na, nb) => {
    const keys = new Set([...Object.keys(na||{}), ...Object.keys(nb||{})]);
    keys.forEach(k => {
      const va = na ? na[k] : undefined, vb = nb ? nb[k] : undefined;
      const path = pathPrefix ? `${pathPrefix}.${k}` : k;
      const isDim = v => v && typeof v === 'object' && 'status' in v && 'normalized_in' in v;
      if(isDim(va) || isDim(vb)){
        const av = va && va.status === 'ok' ? va.normalized_in : null;
        const bv = vb && vb.status === 'ok' ? vb.normalized_in : null;
        if(av !== bv){
          dims.push({ field: path, from: av, to: bv,
                      fromConfidence: va ? va.confidence : null,
                      toConfidence: vb ? vb.confidence : null });
        }
      } else if((va && typeof va === 'object') || (vb && typeof vb === 'object')){
        walkPair(path, va || {}, vb || {});
      }
    });
  };
  walkPair('', a.spec || {}, b.spec || {});

  const key = c => `${c.item}::${c.installation_location}`;
  const aComp = new Map((a.components||[]).map(c => [key(c), c]));
  const bComp = new Map((b.components||[]).map(c => [key(c), c]));
  const addedComponents = [...bComp.keys()].filter(k => !aComp.has(k)).map(k => bComp.get(k));
  const removedComponents = [...aComp.keys()].filter(k => !bComp.has(k)).map(k => aComp.get(k));
  const changedComponents = [];
  aComp.forEach((ca, k) => {
    const cb = bComp.get(k);
    if(cb && (ca.specification !== cb.specification || ca.quantity !== cb.quantity)){
      changedComponents.push({ item: ca.item, from: ca, to: cb });
    }
  });

  return {
    fromVersion: a.version, toVersion: b.version,
    dimensionChanges: dims,
    addedComponents, removedComponents, changedComponents,
    confidenceChange: (b.confidence ?? null) - (a.confidence ?? null),
    statusChange: a.status !== b.status ? { from: a.status, to: b.status } : null
  };
}

export async function compareVersions(blueprintIdA, blueprintIdB){
  const [a, b] = await Promise.all([getVersion(blueprintIdA), getVersion(blueprintIdB)]);
  if(!a || !b) throw new Error('One or both versions could not be found.');
  return diffVersions(a, b);
}

/** Download the image for whichever version getForJob() would select. */
/** Returns the stored original file as {base64, mimeType, filename}, or
 *  null if nothing was saved. Works for any file type -- the caller
 *  decides how to display it (inline image vs. open-as-PDF). */
export async function getOriginalFile(jobId){
  const bp = await getForJob(jobId);
  if(!bp || !bp.storage_path) return null;
  const blob = await storage.download(BLUEPRINT_BUCKET, bp.storage_path);
  if(!blob) return null;
  return {
    base64: await blobToBase64(blob),
    mimeType: bp.original_mime_type || 'application/octet-stream',
    filename: bp.original_filename || null
  };
}

// Kept as an alias -- returns just the base64 the way the old function
// did, for any caller not yet migrated to the mime-aware version.
export async function getImage(jobId){
  const f = await getOriginalFile(jobId);
  return f ? f.base64 : null;
}

export async function deleteForJob(jobId){
  const rows = await db.select('blueprints', `select=id,storage_path&job_id=eq.${jobId}`);
  await Promise.all(rows
    .filter(r => r.storage_path)
    .map(r => storage.remove(BLUEPRINT_BUCKET, r.storage_path).catch(() => {})));
  await db.remove('blueprints', `job_id=eq.${jobId}`);
}

/* ------------------------------------------------------------------ *
 * Manual component editing -- added because the AI scanner doesn't
 * always get every part right, and someone reviewing the extraction
 * needs to fix it directly rather than re-scan and hope. Every function
 * here acts on ONE existing blueprint version's components; it never
 * creates a new version the way a re-scan does.
 * ------------------------------------------------------------------ */

/** Adds a component a human typed in, not one the AI extracted --
 *  extraction_method:'manual' and confidence:null keep that distinction
 *  visible in the data itself, not just in how it got there. */
export async function addComponent(blueprintId, { item, specification, quantity, stage }){
  const existing = await db.select('blueprint_components',
    `select=sort_order&blueprint_id=eq.${blueprintId}&order=sort_order.desc&limit=1`);
  const nextOrder = existing.length ? existing[0].sort_order + 1 : 0;
  const [row] = await db.insert('blueprint_components', {
    blueprint_id: blueprintId,
    item: (item || '').trim() || 'Unspecified item',
    specification: (specification || '').trim(),
    quantity: quantity ?? null,
    stage: stage || 'other',
    installation_location: STAGE_TO_LOCATION[stage] || 'unknown',
    extraction_method: 'manual',
    confidence: null,
    sort_order: nextOrder
  });
  return rowToComponent(row);
}

/** Edits an existing component's fields (item/spec/quantity/stage).
 *  Does not touch sort_order -- use reorderComponents for that. */
export async function updateComponent(componentId, patch){
  const row = {};
  if(patch.item !== undefined) row.item = patch.item.trim() || 'Unspecified item';
  if(patch.specification !== undefined) row.specification = patch.specification.trim();
  if(patch.quantity !== undefined) row.quantity = patch.quantity;
  if(patch.stage !== undefined){
    row.stage = patch.stage;
    row.installation_location = STAGE_TO_LOCATION[patch.stage] || 'unknown';
  }
  const [updated] = await db.update('blueprint_components', `id=eq.${componentId}`, row);
  return updated ? rowToComponent(updated) : null;
}

export async function deleteComponent(componentId){
  await db.remove('blueprint_components', `id=eq.${componentId}`);
}

/** Bulk-applies new sort_order values -- one call for a whole reorder
 *  rather than one PATCH per swapped row. `ordered` is an array of
 *  component ids in their new display order. */
export async function reorderComponents(ordered){
  await Promise.all(ordered.map((id, i) =>
    db.update('blueprint_components', `id=eq.${id}`, { sort_order: i }, { returning: false })));
}

// Reverse of spec.js's stageForLocation() -- used only when a human picks
// a stage from the add/edit form, since the AI path always derives
// installation_location from the drawing, never the other way around.
const STAGE_TO_LOCATION = {
  drive: 'drive_end', tail: 'tail_end', trough: 'trough',
  screw: 'screw', bearings: 'hanger', other: 'unknown'
};
