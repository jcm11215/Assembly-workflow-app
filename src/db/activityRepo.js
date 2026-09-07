/**
 * Activity log repository.
 *
 * Append-only. `actor`, `actor_name`, and `at` are overwritten by a DB
 * trigger from the authenticated session, so a client cannot forge who
 * did something or when -- the difference between a log and evidence.
 * actor and actor_name are sourced through authService.currentActorId()/
 * currentActorName() -- once AUTH_ENABLED is true, actor is a real
 * auth.uid() and the DB trigger (stamp_activity in triggers.sql) forces
 * both server-side regardless of what this module sends, so a client
 * cannot forge either even before Phase 6's RLS is applied.
 */
import { db, currentUserId } from './supabaseClient.js';
import { rowToActivity } from './mappers.js';
import { currentActorName } from '../auth/authService.js';

/**
 * Fire-and-forget by design: logging must never block or fail the work
 * the person is actually doing.
 */
export async function log(action, detail, entity){
  try {
    const row = {
      action,
      detail: typeof detail === 'string' ? { text: detail } : (detail || {}),
      actor: currentUserId(),          // real auth.uid() once AUTH_ENABLED; null in legacy mode
      actor_name: currentActorName(),  // profiles.full_name once AUTH_ENABLED; legacy name otherwise
      entity_type: entity && entity.type ? entity.type : null,
      entity_id: entity && entity.id ? entity.id : null
    };
    await db.insert('activity_log', row, { returning: false });
    return true;
  } catch (e) {
    console.error('activity log failed', e);
    return false;
  }
}

export async function listActivity(limit = 300){
  const rows = await db.select('activity_log',
    `select=id,actor,actor_name,action,entity_type,entity_id,detail,at&order=at.desc&limit=${limit}`);
  return rows.map(rowToActivity);
}

export async function listForEntity(entityType, entityId, limit = 100){
  const rows = await db.select('activity_log',
    `select=id,actor_name,action,detail,at&entity_type=eq.${entityType}` +
    `&entity_id=eq.${entityId}&order=at.desc&limit=${limit}`);
  return rows.map(rowToActivity);
}
