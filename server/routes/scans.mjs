/**
 * Blueprint scans the server runs (../scans.mjs): starting one, and what
 * happens to it once it is read. Each person sees and acts on their own.
 *
 * A scan arrives in one upload: its settings and prepared pages as JSON,
 * then the original file's bytes straight after, with `?meta=` giving
 * the JSON's length -- so a big PDF is never inflated into base64, and a
 * scan is never left half-sent.
 */
import { badRequest, notFound, MB } from '../http.mjs';
import { safeMimeType } from '../files.mjs';
import * as v from '../validate.mjs';
import { startScan, listScans, attachToJob, retry, dismiss, toScan } from '../scans.mjs';

const MAX_PAGES_JSON = 80 * MB;
const MAX_FILE = 60 * MB;
const MAX_THUMBNAIL = 400 * 1024;

function loadScan(ctx){
  const r = ctx.db.get('select * from scans where id = ? and created_by = ?', ctx.params.id, ctx.user.id);
  if(!r) throw notFound('That scan');
  return r;
}

/** Prepared pages as web/scan/pipeline.js contentFor() makes them. */
function checkBlocks(blocks){
  if(!Array.isArray(blocks) || !blocks.length || blocks.length > 400
     || !blocks.every(b => b && typeof b === 'object' && (b.type === 'text' || b.type === 'image'))){
    throw badRequest('That upload has no pages to read.');
  }
  return blocks;
}

export default function register(r){

  r.post('/api/scans', async ctx => {
    const metaLength = Number(ctx.query.get('meta'));
    const body = await ctx.raw(MAX_PAGES_JSON + MAX_FILE);
    if(!Number.isInteger(metaLength) || metaLength <= 0 || metaLength > body.length || metaLength > MAX_PAGES_JSON){
      throw badRequest('That upload is not a scan.');
    }
    let meta;
    try { meta = JSON.parse(body.subarray(0, metaLength).toString('utf8')); }
    catch { throw badRequest('That upload is not a scan.'); }
    const fileBytes = body.subarray(metaLength);
    if(fileBytes.length > MAX_FILE) throw badRequest('That drawing is too large (60 MB at most).');

    // A test scan (Scan testing) reads a checked drawing again, for a score.
    const key = meta.testKeyId ? ctx.db.get('select id from answer_keys where id = ?', String(meta.testKeyId)) : null;
    if(meta.testKeyId && !key) throw badRequest('That checked drawing is gone.');
    const job = meta.jobId && !key ? v.job(ctx.db, meta.jobId) : null;
    const thumbnail = meta.thumbnail ? Buffer.from(String(meta.thumbnail), 'base64') : null;
    if(thumbnail && thumbnail.length > MAX_THUMBNAIL) throw badRequest('The thumbnail is too large.');
    const scan = startScan(ctx.db, ctx.filesDir, ctx.user, {
      jobId: job ? job.id : null,
      includeJobFields: !job && !key && v.bool(meta.includeJobFields),
      testKeyId: key ? key.id : null,
      fileName: v.text(meta.fileName, 'File name', { max: 200 }) || null,
      mimeType: safeMimeType(meta.mimeType),
      thumbnail,
      blocks: checkBlocks(meta.blocks),
      fileBytes: fileBytes.length ? fileBytes : null
    });
    ctx.status = 201;
    return { scan };
  }, { perm: 'blueprint.manage' });

  r.get('/api/scans', ctx => ({ scans: listScans(ctx.db, ctx.user.id) }), { perm: 'blueprint.manage' });

  /** A new-job scan, read and reviewed: saved to the job just created. */
  r.post('/api/scans/:id/attach', async ctx => {
    const scan = loadScan(ctx);
    const job = v.job(ctx.db, (await ctx.json()).jobId);
    let updated;
    try { updated = await attachToJob(ctx.db, ctx.filesDir, ctx.user, scan.id, job.id); }
    catch (err) { if(err.status) throw err; throw badRequest(err.message); }
    return { job: updated, scan: toScan(ctx.db.get('select * from scans where id = ?', scan.id), ctx.db) };
  }, { perm: 'blueprint.manage' });

  r.post('/api/scans/:id/retry', ctx => {
    const scan = loadScan(ctx);
    try { retry(ctx.db, ctx.filesDir, scan.id); }
    catch (err) { throw badRequest(err.message); }
    return { scan: toScan(ctx.db.get('select * from scans where id = ?', scan.id), ctx.db) };
  }, { perm: 'blueprint.manage' });

  /** Put away; a scan still waiting or running is stopped. */
  r.delete('/api/scans/:id', ctx => {
    const scan = loadScan(ctx);
    dismiss(ctx.db, ctx.filesDir, scan.id);
    return { ok: true };
  }, { perm: 'blueprint.manage' });
}
