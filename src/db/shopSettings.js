/**
 * Shop-wide settings -- set once by an admin, read by every signed-in
 * device. Exists so nobody has to type the local server's address into
 * each phone and tablet: an admin enters it once in Settings and every
 * device picks it up on its next load.
 *
 * Loaded once at boot (after sign-in) into an in-memory cache, because
 * keys.js and everything that reads it are synchronous. Never throws on
 * load: a missing table or a network blip just means "no shop settings",
 * which every reader already treats as "not configured".
 *
 * Not for secrets -- RLS lets every signed-in user read every row.
 */
import { db } from './supabaseClient.js';

export const SHOP_KEYS = {
  LOCAL_SERVER_URL: 'local_server_url',
  DEFAULT_AI_PROVIDER: 'default_ai_provider',
  BLUEPRINT_STORAGE: 'blueprint_storage'
};

let cache = {};

export async function loadShopSettings(){
  try {
    const rows = await db.select('shop_settings', 'select=key,value');
    cache = Object.fromEntries(rows.map(r => [r.key, r.value]));
  } catch (e) {
    console.error('could not load shop settings', e);
    cache = {};
  }
  return cache;
}

export function getShopSetting(key){
  return cache[key] ?? null;
}

/** Admin only -- RLS refuses anyone else, and the error surfaces to the
 *  caller rather than being hidden here. Updates the cache on success so
 *  this device sees the change without a reload. */
export async function setShopSetting(key, value){
  await db.upsert('shop_settings', { key, value, updated_at: new Date().toISOString() }, 'key',
    { returning: false });
  cache = { ...cache, [key]: value };
}

/** Test seam only. */
export function _setShopSettingsForTest(values){ cache = { ...(values || {}) }; }
