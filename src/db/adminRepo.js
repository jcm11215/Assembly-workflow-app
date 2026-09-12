/**
 * Admin data access: the team roster, the audit trail, and shop access
 * codes.
 *
 * Nothing here is trusted to be admin-only by virtue of living in this
 * file -- every query below is re-checked by RLS against the caller's own
 * session (profiles_admin_all, activity_select_own, signup_codes_admin).
 * A tampered client gets rejected by the database, not by this module.
 */
import { db } from './supabaseClient.js';

/* ---------------- team ---------------- */

export function listTeam(){
  return db.select('profiles',
    'select=id,full_name,role,active,created_at,updated_at&order=full_name.asc');
}

export async function setRole(id, role){
  const [row] = await db.update('profiles', `id=eq.${id}`, { role });
  return row;
}

export async function setActive(id, active){
  const [row] = await db.update('profiles', `id=eq.${id}`, { active });
  return row;
}

/* ---------------- audit trail ---------------- */

/**
 * Raw activity_log rows -- unlike activityRepo.listActivity(), the jsonb
 * `detail`, the actor id and the entity reference survive, because the
 * whole point of this screen is showing exactly what was recorded.
 *
 * Filters that the database can apply are applied there; free-text search
 * runs over the returned page in the UI, since `detail` is jsonb and
 * PostgREST cannot ilike into it.
 */
export function listAudit({ actor, action, entityType, since, until, limit = 100, offset = 0 } = {}){
  const parts = [
    'select=id,actor,actor_name,action,entity_type,entity_id,detail,at',
    'order=at.desc',
    `limit=${limit}`,
    `offset=${offset}`
  ];
  if(actor)      parts.push(`actor=eq.${encodeURIComponent(actor)}`);
  if(action)     parts.push(`action=eq.${encodeURIComponent(action)}`);
  if(entityType) parts.push(`entity_type=eq.${encodeURIComponent(entityType)}`);
  if(since)      parts.push(`at=gte.${encodeURIComponent(since)}`);
  if(until)      parts.push(`at=lte.${encodeURIComponent(until)}`);
  return db.select('activity_log', parts.join('&'));
}

/* ---------------- shop access codes ---------------- */
/* signup_codes is readable only where an admin policy exists. Callers
   handle the permission error rather than this module hiding it. */

export function listSignupCodes(){
  return db.select('signup_codes', 'select=code,label,active,created_at&order=created_at.desc');
}

export function addSignupCode(code, label){
  return db.insert('signup_codes', { code, label: label || '' });
}

export async function setCodeActive(code, active){
  const [row] = await db.update('signup_codes', `code=eq.${encodeURIComponent(code)}`, { active });
  return row;
}
