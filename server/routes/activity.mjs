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
import { onlineUserIds } from '../live.mjs';

export default function register(r){

  r.get('/api/activity', ctx => {
    const q = ctx.query;
    const where = [];
    const params = [];
    const add = (sql, value) => { where.push(sql); params.push(value); };

    if(!can(ctx.user.role, 'activity.all')) add('actor_id = ?', ctx.user.id);
    else if(q.get('actor')) add('actor_id = ?', q.get('actor'));
    if(q.get('action')) add('action = ?', q.get('action'));
    const signIns = "action in ('Signed in', 'Signed out', 'Sign-in failed', 'Sign-in refused')";
    if(q.get('kind') === 'signins') where.push(signIns);
    if(q.get('kind') === 'work') where.push(`not ${signIns}`);
    if(q.get('entityType')) add('entity_type = ?', q.get('entityType'));
    if(q.get('entityId')) add('entity_id = ?', q.get('entityId'));
    if(q.get('since')) add('at >= ?', q.get('since'));
    if(q.get('until')) add('at <= ?', q.get('until'));
    if(q.get('before')){
      // Older than that entry, by time (backfilled entries have low ids).
      const ref = ctx.db.get('select at from activity where id = ?', Number(q.get('before')));
      if(ref){ where.push('(at < ? or (at = ? and id < ?))'); params.push(ref.at, ref.at, Number(q.get('before'))); }
    }
    if(q.get('q')){
      const like = `%${q.get('q').replace(/[%_\\]/g, c => '\\' + c)}%`;
      where.push("(actor_name like ? escape '\\' or action like ? escape '\\' or detail like ? escape '\\')");
      params.push(like, like, like);
    }
    const limit = Math.min(500, Math.max(1, Number(q.get('limit')) || 100));
    const rows = ctx.db.all(
      `select * from activity ${where.length ? 'where ' + where.join(' and ') : ''} order by at desc, id desc limit ${limit}`,
      ...params);
    return { entries: rows.map(toActivity), more: rows.length === limit };
  });

  /** The distinct actions ever logged, for the audit screen's filter. */
  r.get('/api/activity/actions', ctx => {
    ctx.require('activity.all');
    return { actions: ctx.db.all('select distinct action from activity order by action').map(r => r.action) };
  });

  /**
   * Everyone with an account: whether they have the app open now, when
   * they last used it, their last sign-in and how much they did this
   * week. Admins only.
   */
  r.get('/api/activity/people', ctx => {
    ctx.require('activity.all');
    const online = onlineUserIds();
    const week = new Date(Date.now() - 7 * 86400000).toISOString();
    const rows = ctx.db.all(`
      select u.id, u.full_name, u.role, u.active,
        (select max(s.last_seen_at) from sessions s where s.user_id = u.id) as seen_ms,
        (select max(a.at) from activity a where a.actor_id = u.id) as last_action,
        (select a.at from activity a where a.actor_id = u.id and a.action = 'Signed in' order by a.id desc limit 1) as last_sign_in,
        (select a.detail from activity a where a.actor_id = u.id and a.action = 'Signed in' order by a.id desc limit 1) as sign_in_detail,
        (select count(*) from activity a where a.actor_id = u.id and a.at >= ? and a.action not in ('Signed in', 'Signed out')) as week_actions,
        (select count(*) from activity a where a.actor_id = u.id and a.at >= ? and a.action = 'Sign-in failed') as week_failed
      from users u order by u.full_name`, week, week);
    const people = rows.map(r => {
      const seen = r.seen_ms ? new Date(r.seen_ms).toISOString() : null;
      let device = null;
      try { device = JSON.parse(r.sign_in_detail || 'null')?.device || null; } catch { /* old entry */ }
      return {
        id: r.id, fullName: r.full_name, role: r.role, active: !!r.active,
        online: online.has(r.id),
        lastActive: [seen, r.last_action].filter(Boolean).sort().pop() || null,
        lastSignIn: r.last_sign_in, device,
        weekActions: r.week_actions, weekFailed: r.week_failed
      };
    });
    return { people };
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
