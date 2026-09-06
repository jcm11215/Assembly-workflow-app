/**
 * Profile lookup, creation, and an in-memory cache of the signed-in
 * user's own profile -- so role checks (permissions.js) are synchronous
 * instead of every UI render awaiting a network call.
 */
import { db, DbError } from '../db/supabaseClient.js';

let cachedProfile = null;
export function getCachedProfile(){ return cachedProfile; }
export function setCachedProfile(p){ cachedProfile = p; }
export function clearCachedProfile(){ cachedProfile = null; }

export async function getProfile(userId){
  if(!userId) return null;
  const rows = await db.select('profiles', `select=id,full_name,role,active&id=eq.${userId}`);
  return rows[0] || null;
}

/**
 * Creates a profile for a newly authenticated user. Idempotent against
 * the on-signup DB trigger (handle_new_user in triggers.sql): if that
 * trigger already created the row, the unique-key conflict here is
 * caught and the existing row is fetched instead of erroring.
 *
 * Default role is always 'assembler' -- elevation is an admin action
 * taken afterward, never something a signup flow can grant itself.
 */
export async function createProfileForUser(user, fullName){
  if(!user || !user.id) throw new Error('createProfileForUser requires an authenticated user');
  const name = (fullName || user.email || 'New User').trim();
  try {
    const [row] = await db.insert('profiles', { id: user.id, full_name: name, role: 'assembler' });
    return row;
  } catch (e) {
    if(e instanceof DbError && e.isConflict) return getProfile(user.id);
    throw e;
  }
}

/** Fetch-or-create, then populate the cache. Call once per sign-in. */
export async function ensureProfile(user){
  if(!user) { clearCachedProfile(); return null; }
  let profile = await getProfile(user.id);
  if(!profile) profile = await createProfileForUser(user, user.user_metadata && user.user_metadata.full_name);
  setCachedProfile(profile);
  return profile;
}

export async function updateProfile(userId, patch){
  const [row] = await db.update('profiles', `id=eq.${userId}`, patch);
  if(cachedProfile && cachedProfile.id === userId) setCachedProfile(row);
  return row;
}

/** For an eventual user-management screen (canManageUsers()). */
export async function listProfiles(){
  return db.select('profiles', 'select=id,full_name,role,active&order=full_name.asc');
}
