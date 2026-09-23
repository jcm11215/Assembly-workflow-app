/**
 * Scan calibration (the Scan testing screen): marking a job's parts list
 * correct, the checked drawings with their test scores, and recent scans.
 * Test scans themselves start through POST /api/scans with `testKeyId`.
 */
import { notFound } from '../http.mjs';
import { getSetting } from '../db.mjs';
import { aiSettings } from '../ai.mjs';
import { listKeys, markCorrect, recentScans } from '../calibration.mjs';
import { pushJob } from './jobs.mjs';
import { SCANNER } from '../../web/scan/pipeline.js';

export default function register(r){

  r.get('/api/calibration', ctx => ({
    keys: listKeys(ctx.db),
    recent: recentScans(ctx.db),
    learned: ctx.db.get('select count(*) as n from part_names').n,
    scanner: SCANNER,
    visionModel: aiSettings(getSetting(ctx.db, 'ai', {})).visionModel || ''
  }), { perm: 'blueprint.manage' });

  /** This blueprint's parts list is right: the drawing's answer key. */
  r.post('/api/blueprints/:id/correct', ctx => {
    const bp = ctx.db.get('select id, job_id from blueprints where id = ?', ctx.params.id);
    if(!bp) throw notFound('That blueprint');
    const done = markCorrect(ctx.db, ctx.user, bp.id);
    const job = pushJob(ctx.db, bp.job_id);
    const s = done.firstScore;
    ctx.log('Parts list marked correct', {
      text: `${job.jobNumber}: ${done.lessons.length} correction${done.lessons.length === 1 ? '' : 's'} learned${s ? `; the scan scored ${s.score}%` : ''}`
    }, { type: 'job', id: bp.job_id });
    return { key: done.key, firstScore: s, learned: done.lessons.map(l => ({ drawn: l.drawn, item: l.item, location: l.location })), job };
  }, { perm: 'blueprint.manage' });

  r.delete('/api/calibration/keys/:id', ctx => {
    const key = ctx.db.get('select id, job_id from answer_keys where id = ?', ctx.params.id);
    if(!key) throw notFound('That checked drawing');
    ctx.db.run('delete from answer_keys where id = ?', key.id);
    pushJob(ctx.db, key.job_id);
    return { ok: true };
  }, { perm: 'blueprint.manage' });
}
