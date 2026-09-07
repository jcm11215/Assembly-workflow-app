/**
 * Realtime sync for the activity log. Append-only at the database level
 * (Phase 2/6 grant no update/delete policy to any role), so this only
 * ever handles INSERT -- there is no update/delete path to wire.
 */
import { subscribeTable } from './realtimeClient.js';
import { state } from '../state/store.js';
import { rowToActivity } from '../db/mappers.js';
import { requestRender } from '../app/bus.js';

let unsubscribe = null;
const MAX_KEPT = 300;

export function handleActivityEvent({ type, record }){
  if(type !== 'INSERT' || !record) return;
  if(!Array.isArray(state.activity)) return;   // Activity tab hasn't been opened yet
  const mapped = rowToActivity(record);
  if(state.activity.some(a => a.id === mapped.id)) return;   // dedupe
  state.activity.unshift(mapped);
  if(state.activity.length > MAX_KEPT) state.activity.length = MAX_KEPT;
  requestRender();
}

export function startActivityRealtime(){
  stopActivityRealtime();
  unsubscribe = subscribeTable('activity_log', handleActivityEvent);
}

export function stopActivityRealtime(){
  if(unsubscribe){ unsubscribe(); unsubscribe = null; }
}
