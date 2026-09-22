/**
 * The activity log. The server writes an entry for every change it makes;
 * the app adds the few things only it knows about (an AI action it ran, a
 * scan that failed in the browser).
 *
 * Admins see the whole shop's log with filters. Everyone else sees their
 * own entries.
 */
import { can } from '../../shared/roles.js';
import { toActivity } from '../records.mjs';
import * as v from '../validate.mjs';

export default function register(r){

  r.get('/api/activity', ctx => {
    const q = ctx.query;
    const where = [];
    const params = [];
    const add = (sql, value) => { where.push(sql); params.push(value); };

    if(!can(ctx.user.role, 'activity.all')) add('actor_id = ?', ctx.user.id);
    else if(q.get('actor')) add('actor_id = ?', q.get('actor'));
    if(q.get('action')) add('action = ?', q.get('action'));
    if(q.get('entityType')) add('entity_type = ?', q.get('entityType'));
    if(q.get('entityId')) add('entity_id = ?', q.get('entityId'));
    if(q.get('since')) add('at >= ?', q.get('since'));
    if(q.get('until')) add('at <= ?', q.get('until'));
    if(q.get('before')) add('id < ?', Number(q.get('before')));
    if(q.get('q')){
      const like = `%${q.get('q').replace(/[%_\\]/g, c => '\\' + c)}%`;
      where.push("(actor_name like ? escape '\\' or action like ? escape '\\' or detail like ? escape '\\')");
      params.push(like, like, like);
    }
    const limit = Math.min(500, Math.max(1, Number(q.get('limit')) || 100));
    const rows = ctx.db.all(
      `select * from activity ${where.length ? 'where ' + where.join(' and ') : ''} order by id desc limit ${limit}`,
      ...params);
    return { entries: rows.map(toActivity), more: rows.length === limit };
  });

  /** The distinct actions ever logged, for the audit screen's filter. */
  r.get('/api/activity/actions', ctx => {
    ctx.require('activity.all');
    return { actions: ctx.db.all('select distinct action from activity order by action').map(r => r.action) };
  });

  r.post('/api/activity', async ctx => {
    const body = await ctx.json(64 * 1024);
    const action = v.text(body.action, 'Action', { required: true, max: 80 });
    const detail = body.detail && typeof body.detail === 'object' ? body.detail : { text: v.text(body.detail, 'Detail', { max: 2000 }) };
    const entity = body.entity && body.entity.type
      ? { type: v.text(body.entity.type, 'Entity type', { max: 20 }), id: v.text(body.entity.id, 'Entity id', { max: 80 }) }
      : null;
    return { entry: ctx.log(action, { ...detail, source: 'app' }, entity) };
  });
}
