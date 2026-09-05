/**
 * Blueprints repository.
 *
 * Images live in Supabase Storage; spec/validation/BOM live relationally
 * (Phase 3). Phase 8 adds versioning -- each scan of a job's blueprint
 * inserts a new row rather than overwriting the last one, so history is
 * naturally preserved; this module adds the version numbering,
 * comparison, and approval semantics on top of that.
 */
import { db, storage, BLUEPRINT_BUCKET, base64ToBlob, blobToBase64, currentUserId }
  from './supabaseClient.js';
import { rowToComponent, componentToRow } from './mappers.js';

const SEL = 'select=id,job_id,storage_path,page_count,conveyor_type,spec,validation,' +
            'status,version,confidence,review_urgency,reviewed_note,auto_approved,' +
            'extracted_at,reviewed_at';

/**
 * The blueprint that should drive the job's displayed spec/BOM/3D model:
 * the latest APPROVED version if one exists, otherwise the latest
 * version overall (so a job with no review activity yet -- or on an
 * environment where Phase 8 hasn't rolled out -- behaves exactly as
 * before). This is the one behavioral change to a Phase 3 function, and
 * it exists because "review workflow" is meaningless if an unapproved
 * scan is still what feeds the floor.
 */
export async function getForJob(jobId){
  const approved = await db.select('blueprints',
    `${SEL}&job_id=eq.${jobId}&status=eq.approved&order=version.desc&limit=1`);
  const rows = approved.length ? approved
    : await db.select('blueprints', `${SEL}&job_id=eq.${jobId}&order=version.desc&limit=1`);
  if(!rows.length) return null;
  const bp = rows[0];
  bp.components = await listComponents(bp.id);
  return bp;
}

export async function listComponents(blueprintId){
  const rows = await db.select('blueprint_components',
    'select=item,specification,quantity,stage,installation_location,source_page,' +
    `source_callout,extraction_method,confidence&blueprint_id=eq.${blueprintId}`);
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
export async function saveExtraction(jobId, {
  spec, validation, components, imageBase64, pageCount,
  status, confidence, urgency, autoApproved, reason
}){
  let storagePath = null;
  if(imageBase64){
    storagePath = `${jobId}/${Date.now()}.jpg`;
    try {
      await storage.upload(BLUEPRINT_BUCKET, storagePath, base64ToBlob(imageBase64));
    } catch (e) {
      console.error('blueprint image upload failed', e);
      storagePath = null;
    }
  }

  const version = await nextVersion(jobId);
  const resolvedStatus = status || 'review_required';
  const isTerminal = resolvedStatus === 'approved' || resolvedStatus === 'rejected';

  const row = {
    job_id: jobId,
    version,
    storage_path: storagePath,
    page_count: pageCount ?? null,
    conveyor_type: spec ? spec.conveyorType : null,
    spec: spec ?? null,
    validation: validation ?? null,
    status: resolvedStatus,
    confidence: confidence ?? null,
    review_urgency: urgency ?? null,
    auto_approved: !!autoApproved,
    extracted_by: currentUserId()
  };
  // Auto-approval stamps a review record too -- reviewed_by stays null
  // (no human reviewed it), which is what distinguishes it from a
  // person's approval in the audit trail. reviewed_note carries why.
  if(isTerminal){
    row.reviewed_at = new Date().toISOString();
    row.reviewed_by = autoApproved ? null : currentUserId();
    row.reviewed_note = reason || null;
  }

  const [bp] = await db.insert('blueprints', row);

  if(components && components.length){
    await db.insert('blueprint_components',
      components.map(c => componentToRow(c, bp.id)), { returning: false });
  }
  return bp;
}

async function nextVersion(jobId){
  const rows = await db.select('blueprints',
    `select=version&job_id=eq.${jobId}&order=version.desc&limit=1`);
  return rows.length ? rows[0].version + 1 : 1;
}

/** Human review action -- always stamps reviewed_by, unlike an
 *  auto-approval from saveExtraction(). */
export async function setStatus(blueprintId, status, note){
  const patch = { status };
  if(status === 'approved' || status === 'rejected'){
    patch.reviewed_by = currentUserId();
    patch.reviewed_at = new Date().toISOString();
    patch.reviewed_note = note || null;
    patch.auto_approved = false;   // a human decision supersedes any prior auto-approval
  }
  const [row] = await db.update('blueprints', `id=eq.${blueprintId}`, patch);
  return row;
}

export const approveVersion = (blueprintId, note) => setStatus(blueprintId, 'approved', note);
export const rejectVersion  = (blueprintId, note) => setStatus(blueprintId, 'rejected', note);

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
export async function getImage(jobId){
  const bp = await getForJob(jobId);
  if(!bp || !bp.storage_path) return null;
  const blob = await storage.download(BLUEPRINT_BUCKET, bp.storage_path);
  return blob ? blobToBase64(blob) : null;
}

export async function deleteForJob(jobId){
  const rows = await db.select('blueprints', `select=id,storage_path&job_id=eq.${jobId}`);
  await Promise.all(rows
    .filter(r => r.storage_path)
    .map(r => storage.remove(BLUEPRINT_BUCKET, r.storage_path).catch(() => {})));
  await db.remove('blueprints', `job_id=eq.${jobId}`);
}
