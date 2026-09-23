/**
 * Blueprints: saving a scan (its parts list, then its original file),
 * serving the file and its thumbnail, and hand-editing the parts list.
 *
 * A scan is saved in two requests -- the parts as JSON, then the file as
 * raw bytes -- so a 20 MB PDF is never inflated into base64 inside JSON.
 */
import fs from 'node:fs';
import { badRequest, notFound, MB } from '../http.mjs';
import { uuid, now } from '../db.mjs';
import { toComponent } from '../records.mjs';
import { pushJob } from './jobs.mjs';
import { relativePathFor, writeFileAtomic, absolutePath, safeMimeType } from '../files.mjs';
import * as v from '../validate.mjs';
import { learnKey } from '../../shared/partNames.js';

export const COMPONENT_STAGES = ['trough', 'screw', 'drive', 'bearings', 'tail', 'other'];
const LOCATIONS = ['drive_end', 'tail_end', 'trough', 'screw', 'hanger', 'other', 'unknown'];
const METHODS = ['bom_table', 'callout', 'detail_view', 'general_assembly', 'inferred', 'manual'];

/** Where a part a person adds by hand sits, from the stage they picked.
 *  Scanned parts carry their own location from the drawing. */
const STAGE_TO_LOCATION = {
  drive: 'drive_end', tail: 'tail_end', trough: 'trough', screw: 'screw', bearings: 'hanger', other: 'unknown'
};

const unit = x => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Math.min(1, Math.max(0, Number(x))));

/**
 * Remembers a correction to a scanned part by its description, so the
 * next scan reads it the same way. A new type is always remembered. A
 * new end only when that description appears once on this drawing: the
 * same bearing at both ends of a conveyor says nothing about which end
 * the next one is at.
 */
function learnCorrection(ctx, existing, sets){
  const drawn = String(existing.item_as_drawn || '').trim();
  const key = learnKey(drawn);
  if(!key || existing.extraction_method === 'manual') return;
  const item = 'item' in sets && sets.item !== existing.item ? sets.item : null;
  let location = null;
  if('stage' in sets && sets.stage !== existing.stage){
    const same = ctx.db.all('select item_as_drawn from components where blueprint_id = ?', existing.blueprint_id)
      .filter(c => learnKey(c.item_as_drawn) === key).length;
    if(same === 1) location = sets.installation_location;
  }
  if(!item && !location) return;
  ctx.db.run(`insert into part_names (key, drawn, item, location, updated_by, updated_at) values (?, ?, ?, ?, ?, ?)
              on conflict(key) do update set drawn = excluded.drawn, item = coalesce(excluded.item, part_names.item),
                location = coalesce(excluded.location, part_names.location), updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    key, drawn, item, location, ctx.user.id, now());
}

/** A component from a scan or the edit form, checked and cleaned. */
function cleanComponent(c, sortOrder){
  const stage = COMPONENT_STAGES.includes(c.stage) ? c.stage : 'other';
  return {
    item: v.text(c.item, 'Part name', { max: 300 }) || 'Unspecified item',
    item_as_drawn: v.text(c.item_as_drawn, 'Name as drawn', { max: 300 }),
    specification: v.text(c.specification, 'Specification', { max: 1000 }),
    quantity: v.optionalNumber(c.quantity, 'Quantity', { min: 0, max: 100000 }),
    stage,
    installation_location: LOCATIONS.includes(c.installation_location) ? c.installation_location : STAGE_TO_LOCATION[stage],
    source_page: c.source_page == null ? null : v.optionalNumber(c.source_page, 'Page', { min: 1, max: 1000 }),
    source_callout: v.text(c.source_callout, 'Callout', { max: 300 }),
    extraction_method: METHODS.includes(c.extraction_method) ? c.extraction_method : 'inferred',
    confidence: unit(c.confidence),
    balloon: c.balloon == null || c.balloon === '' ? null : v.text(c.balloon, 'Item number', { max: 20 }),
    part_number: v.text(c.part_number, 'Part number', { max: 120 }),
    position_x: c.position ? unit(c.position.x) : null,
    position_y: c.position ? unit(c.position.y) : null,
    sort_order: sortOrder
  };
}

function insertComponent(db, blueprintId, c){
  const id = uuid();
  db.run(`insert into components (id, blueprint_id, sort_order, item, item_as_drawn, specification, quantity, stage,
            installation_location, source_page, source_callout, extraction_method, confidence, balloon, part_number,
            position_x, position_y)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, blueprintId, c.sort_order, c.item, c.item_as_drawn, c.specification, c.quantity, c.stage,
    c.installation_location, c.source_page, c.source_callout, c.extraction_method, c.confidence, c.balloon,
    c.part_number, c.position_x, c.position_y);
  return id;
}

function loadBlueprint(db, id){
  const bp = db.get(`select b.*, j.job_number from blueprints b join jobs j on j.id = b.job_id where b.id = ?`, id);
  if(!bp) throw notFound('That blueprint');
  return bp;
}

function loadComponent(db, id){
  const c = db.get(`select c.*, b.job_id, j.job_number from components c
                      join blueprints b on b.id = c.blueprint_id join jobs j on j.id = b.job_id
                     where c.id = ?`, id);
  if(!c) throw notFound('That part');
  return c;
}

const MAX_THUMBNAIL = 400 * 1024;

export default function register(r){

  /** A new scan: its parts list and thumbnail. The file follows in a
   *  PUT to /api/blueprints/:id/file. */
  r.post('/api/jobs/:id/blueprints', async ctx => {
    const body = await ctx.json(8 * MB);
    const job = v.job(ctx.db, ctx.params.id);
    const components = Array.isArray(body.components) ? body.components : [];
    if(components.length > 2000) throw badRequest('That is too many parts for one drawing.');
    let thumbnail = null;
    if(body.thumbnail){
      thumbnail = Buffer.from(String(body.thumbnail), 'base64');
      if(thumbnail.length > MAX_THUMBNAIL) throw badRequest('The thumbnail is too large.');
    }
    const cleaned = components.map((c, i) => cleanComponent(c || {}, i));

    const id = uuid();
    const version = ctx.db.tx(() => {
      const { n } = ctx.db.get('select coalesce(max(version), 0) + 1 as n from blueprints where job_id = ?', job.id);
      ctx.db.run(`insert into blueprints (id, job_id, version, original_filename, mime_type, thumbnail, extracted_by, extracted_at)
                  values (?, ?, ?, ?, ?, ?, ?, ?)`,
        id, job.id, n, v.text(body.fileName, 'File name', { max: 200 }) || null,
        v.text(body.mimeType, 'File type', { max: 100 }) || null, thumbnail, ctx.user.id, now());
      for(const c of cleaned) insertComponent(ctx.db, id, c);
      return n;
    });

    ctx.log('Blueprint scanned', {
      text: `${job.job_number}: version ${version}, ${cleaned.length} part${cleaned.length === 1 ? '' : 's'}`,
      jobNumber: job.job_number, version, parts: cleaned.length
    }, { type: 'job', id: job.id });
    ctx.status = 201;
    const updated = pushJob(ctx.db, job.id);
    return { blueprint: updated.blueprint, job: updated };
  }, { perm: 'blueprint.manage' });

  r.put('/api/blueprints/:id/file', async ctx => {
    const bp = loadBlueprint(ctx.db, ctx.params.id);
    if(bp.file_path) throw badRequest('That blueprint already has its file.');
    const bytes = await ctx.raw(60 * MB);
    if(!bytes.length) throw badRequest('The file is empty.');
    const mime = safeMimeType(String(ctx.req.headers['content-type'] || bp.mime_type || '').split(';')[0].trim());
    if(mime === 'application/octet-stream') throw badRequest('A drawing has to be a PDF or a photo (JPEG, PNG, WebP, HEIC).');
    const rel = relativePathFor(bp.job_number, bp.original_filename, mime, bp.version);
    await writeFileAtomic(ctx.filesDir, rel, bytes);
    ctx.db.run('update blueprints set file_path = ?, mime_type = ? where id = ?', rel, mime, bp.id);
    const job = pushJob(ctx.db, bp.job_id);
    return { blueprint: job.blueprint, job };
  }, { perm: 'blueprint.manage' });

  r.get('/api/blueprints/:id/file', ctx => {
    const bp = loadBlueprint(ctx.db, ctx.params.id);
    if(!bp.file_path) throw notFound('The file for that blueprint');
    const abs = absolutePath(ctx.filesDir, bp.file_path);
    let stat;
    try { stat = fs.statSync(abs); } catch { throw notFound('The file for that blueprint'); }
    const name = (bp.original_filename || 'blueprint').replace(/[^\x20-\x7e]|["\\]/g, '_');
    const type = safeMimeType(bp.mime_type);
    ctx.res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      // Only a PDF or an image opens in the browser; anything else downloads.
      'Content-Disposition': `${type === 'application/octet-stream' ? 'attachment' : 'inline'}; filename="${name}"`,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff'
    });
    fs.createReadStream(abs).pipe(ctx.res);
  });

  r.get('/api/blueprints/:id/thumbnail', ctx => {
    const row = ctx.db.get('select thumbnail from blueprints where id = ?', ctx.params.id);
    if(!row || !row.thumbnail) throw notFound('That thumbnail');
    // A blueprint's thumbnail never changes: a re-scan is a new blueprint id.
    ctx.res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Content-Length': row.thumbnail.length,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff'
    });
    ctx.res.end(Buffer.from(row.thumbnail));
  });

  /* ---------------- hand-editing the parts list ---------------- */

  r.post('/api/blueprints/:id/components', async ctx => {
    const bp = loadBlueprint(ctx.db, ctx.params.id);
    const body = await ctx.json();
    const { n } = ctx.db.get('select coalesce(max(sort_order), -1) + 1 as n from components where blueprint_id = ?', bp.id);
    const c = cleanComponent({ ...body, extraction_method: 'manual', confidence: null, installation_location: null }, n);
    const id = insertComponent(ctx.db, bp.id, c);
    ctx.log('Part added', { text: `${bp.job_number}: ${c.item}`, jobNumber: bp.job_number }, { type: 'job', id: bp.job_id });
    ctx.status = 201;
    return { component: toComponent(ctx.db.get('select * from components where id = ?', id)), job: pushJob(ctx.db, bp.job_id) };
  }, { perm: 'blueprint.manage' });

  r.patch('/api/components/:id', async ctx => {
    const existing = loadComponent(ctx.db, ctx.params.id);
    const body = await ctx.json();
    const sets = {};
    if('item' in body) sets.item = v.text(body.item, 'Part name', { max: 300 }) || 'Unspecified item';
    if('specification' in body) sets.specification = v.text(body.specification, 'Specification', { max: 1000 });
    if('quantity' in body) sets.quantity = v.optionalNumber(body.quantity, 'Quantity', { min: 0, max: 100000 });
    if('balloon' in body) sets.balloon = body.balloon == null || String(body.balloon).trim() === '' ? null : v.text(body.balloon, 'Item number', { max: 20 });
    if('stage' in body){
      sets.stage = v.oneOf(body.stage, COMPONENT_STAGES, 'Category');
      sets.installation_location = STAGE_TO_LOCATION[sets.stage];
    }
    const keys = Object.keys(sets);
    if(!keys.length) throw badRequest('Nothing to change.');
    ctx.db.run(`update components set ${keys.map(k => `${k} = ?`).join(', ')} where id = ?`, ...keys.map(k => sets[k]), existing.id);
    learnCorrection(ctx, existing, sets);
    ctx.log('Part edited', { text: `${existing.job_number}: ${sets.item || existing.item}`, jobNumber: existing.job_number },
      { type: 'job', id: existing.job_id });
    return {
      component: toComponent(ctx.db.get('select * from components where id = ?', existing.id)),
      job: pushJob(ctx.db, existing.job_id)
    };
  }, { perm: 'blueprint.manage' });

  r.delete('/api/components/:id', ctx => {
    const existing = loadComponent(ctx.db, ctx.params.id);
    ctx.db.run('delete from components where id = ?', existing.id);
    ctx.log('Part removed', { text: `${existing.job_number}: ${existing.item}`, jobNumber: existing.job_number },
      { type: 'job', id: existing.job_id });
    return { job: pushJob(ctx.db, existing.job_id) };
  }, { perm: 'blueprint.manage' });

    /* ---------------- learned part names ---------------- */

  /** Every correction the scan has learned, newest first. */
  r.get('/api/parts/learned', ctx => ({
    names: ctx.db.all(`select p.*, u.full_name as updated_by_name from part_names p
                        left join users u on u.id = p.updated_by order by p.updated_at desc`).map(p => ({
      key: p.key, drawn: p.drawn, item: p.item || '', location: p.location || '',
      usedCount: p.used_count, updatedAt: p.updated_at, updatedByName: p.updated_by_name || ''
    }))
  }), { perm: 'blueprint.manage' });

  /** Forgets one: later scans read that description afresh. */
  r.delete('/api/parts/learned/:key', ctx => {
    const row = ctx.db.get('select * from part_names where key = ?', ctx.params.key);
    if(!row) throw notFound('That learned name');
    ctx.db.run('delete from part_names where key = ?', row.key);
    ctx.log('Learned part name forgotten', { text: row.drawn });
    return { ok: true };
  }, { perm: 'blueprint.manage' });

  /** A scan applied these learned names: counted, so the list shows
   *  which ones earn their keep. */
  r.post('/api/parts/learned/used', async ctx => {
    const { keys } = await ctx.json();
    for(const k of (Array.isArray(keys) ? keys : []).slice(0, 500)){
      ctx.db.run('update part_names set used_count = used_count + 1 where key = ?', String(k));
    }
    return { ok: true };
  }, { perm: 'blueprint.manage' });

  /** New display order for a blueprint's parts: `ids` in order. */
  r.put('/api/blueprints/:id/order', async ctx => {
    const bp = loadBlueprint(ctx.db, ctx.params.id);
    const { ids } = await ctx.json();
    if(!Array.isArray(ids)) throw badRequest('Send the part ids in their new order.');
    ctx.db.tx(() => {
      ids.forEach((id, i) => ctx.db.run('update components set sort_order = ? where id = ? and blueprint_id = ?', i, String(id), bp.id));
    });
    return { job: pushJob(ctx.db, bp.job_id) };
  }, { perm: 'blueprint.manage' });
}
