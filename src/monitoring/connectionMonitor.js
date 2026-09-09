/**
 * Realtime disconnect logging. Purely observational: subscribes to
 * realtimeClient.js's existing onConnectionChange() (Phase 7) without
 * modifying that module at all. Tracks disconnect count, duration, and
 * writes a durable trace so a bad wifi day on the shop floor is visible
 * afterward, not just felt in the moment.
 */
import { onConnectionChange, isConnected, _debugState } from '../realtime/realtimeClient.js';
import { logActivity } from '../db/repository.js';

const MAX_EVENTS = 100;
const history = [];   // { state, at, durationMs? }
let disconnectedAt = null;
let unsubscribe = null;

function record(entry){
  history.push(entry);
  if(history.length > MAX_EVENTS) history.shift();
}

function handleChange(state){
  const now = Date.now();
  if(state === 'disconnected'){
    disconnectedAt = now;
    record({ state:'disconnected', at:new Date(now).toISOString() });
    logActivity('Realtime disconnected', { at:new Date(now).toISOString() }).catch(()=>{});
    return;
  }
  if(state === 'connected'){
    const durationMs = disconnectedAt ? now - disconnectedAt : null;
    record({ state:'connected', at:new Date(now).toISOString(), afterDisconnectMs: durationMs });
    if(disconnectedAt){
      logActivity('Realtime reconnected', {
        at:new Date(now).toISOString(),
        disconnectedForMs: durationMs
      }).catch(()=>{});
    }
    disconnectedAt = null;
  }
}

export function initConnectionMonitor(){
  if(unsubscribe) return;   // idempotent
  unsubscribe = onConnectionChange(handleChange);
}

export function teardownConnectionMonitor(){
  if(unsubscribe){ unsubscribe(); unsubscribe = null; }
  disconnectedAt = null;
}

export function getConnectionHistory(){ return history.slice().reverse(); }

export function getConnectionSummary(){
  const disconnects = history.filter(h => h.state==='disconnected').length;
  const reconnects = history.filter(h => h.state==='connected' && h.afterDisconnectMs!=null);
  const avgDowntimeMs = reconnects.length
    ? Math.round(reconnects.reduce((a,h)=>a+h.afterDisconnectMs,0) / reconnects.length)
    : null;
  return {
    connected: isConnected(),
    debug: _debugState(),
    disconnectCount: disconnects,
    avgDowntimeMs,
    currentlyDown: disconnectedAt!=null,
    downSinceMs: disconnectedAt ? Date.now()-disconnectedAt : null
  };
}
