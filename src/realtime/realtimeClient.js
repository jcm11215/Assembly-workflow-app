/**
 * Supabase Realtime client.
 *
 * Plain WebSocket against the Phoenix Channels protocol Supabase
 * Realtime speaks -- no SDK, consistent with the rest of this app's
 * zero-build approach. One socket is shared by every table subscription;
 * each table gets its own Phoenix "channel" (topic) over that socket.
 *
 * Wire protocol (Supabase Realtime, Phoenix Channels v1.0):
 *   connect:  wss://<project>.supabase.co/realtime/v1/websocket
 *             ?apikey=<anon key>&vsn=1.0.0
 *   join:     {topic:"realtime:public:<table>", event:"phx_join",
 *              payload:{config:{postgres_changes:[{event:"*",
 *              schema:"public", table:<table>}]}}, ref:<n>}
 *   change:   {topic, event:"postgres_changes",
 *              payload:{data:{type, record, old_record, ...}}, ref:null}
 *   heartbeat: every 25s, or the server drops the connection.
 * This is implemented against the documented protocol; if Supabase
 * changes the wire format, only this file needs updating -- every
 * table-specific module below depends on the handler API, not the wire.
 */
import { SUPABASE_URL, SUPABASE_ANON_KEY, supabaseReady } from '../db/config.js';
import { getAccessToken } from '../auth/sessionStore.js';

const HEARTBEAT_MS = 25000;
const MAX_BACKOFF_MS = 30000;

let socket = null;
let ref = 0;
let heartbeatTimer = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let connecting = false;
let intentionallyClosed = false;

/** topic -> { joined: bool, handlers: Map(handlerId -> fn) } */
const channels = new Map();

/** Fired on connect/disconnect so callers can trigger a catch-up fetch. */
const connectionListeners = new Set();
export function onConnectionChange(fn){
  connectionListeners.add(fn);
  return () => connectionListeners.delete(fn);
}
function notifyConnection(state){
  connectionListeners.forEach(fn => { try { fn(state); } catch (e) { console.error(e); } });
}

function nextRef(){ return String(++ref); }

function wsUrl(){
  const base = SUPABASE_URL.replace(/^http/, 'ws');
  const token = getAccessToken() || SUPABASE_ANON_KEY;   // user JWT once signed in, else anon
  return `${base}/realtime/v1/websocket?apikey=${SUPABASE_ANON_KEY}&token=${token}&vsn=1.0.0`;
}

function ensureSocket(){
  if(!supabaseReady()) return;
  if(socket && (socket.readyState === 0 || socket.readyState === 1)) return; // connecting or open
  if(connecting) return;
  connecting = true;
  intentionallyClosed = false;

  try {
    socket = new WebSocket(wsUrl());
  } catch (e) {
    connecting = false;
    scheduleReconnect();
    return;
  }

  socket.onopen = () => {
    connecting = false;
    reconnectAttempt = 0;
    startHeartbeat();
    // Rejoin every channel that was open before a drop.
    for(const topic of channels.keys()) send(joinMessage(topic));
    notifyConnection('connected');
  };

  socket.onmessage = (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }
    handleMessage(msg);
  };

  socket.onerror = () => { /* onclose follows; reconnect handled there */ };

  socket.onclose = () => {
    connecting = false;
    stopHeartbeat();
    for(const ch of channels.values()) ch.joined = false;
    notifyConnection('disconnected');
    if(!intentionallyClosed) scheduleReconnect();
  };
}

function scheduleReconnect(){
  clearTimeout(reconnectTimer);
  const delay = Math.min(MAX_BACKOFF_MS, 1000 * Math.pow(2, reconnectAttempt));
  reconnectAttempt++;
  reconnectTimer = setTimeout(() => { ensureSocket(); }, delay);
}

function startHeartbeat(){
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: nextRef() });
  }, HEARTBEAT_MS);
}
function stopHeartbeat(){ clearInterval(heartbeatTimer); heartbeatTimer = null; }

function send(msg){
  if(socket && socket.readyState === 1) socket.send(JSON.stringify(msg));
}

function joinMessage(topic){
  const table = topic.split(':')[2];
  return {
    topic, event: 'phx_join', ref: nextRef(),
    payload: { config: { postgres_changes: [{ event: '*', schema: 'public', table }] } }
  };
}

function handleMessage(msg){
  const { topic, event, payload } = msg;
  const ch = channels.get(topic);
  if(!ch) return;

  if(event === 'phx_reply' && payload && payload.status === 'ok'){
    ch.joined = true;
    return;
  }
  if(event === 'postgres_changes' && payload && payload.data){
    const { type, record, old_record } = payload.data;
    ch.handlers.forEach(fn => {
      try { fn({ type, record: record || null, oldRecord: old_record || null }); }
      catch (e) { console.error('realtime handler failed', topic, e); }
    });
  }
}

/**
 * Subscribe to every change on `table`. Returns an unsubscribe function.
 * Multiple subscribers to the same table share one channel/topic.
 */
export function subscribeTable(table, handler){
  const topic = `realtime:public:${table}`;
  let ch = channels.get(topic);
  if(!ch){
    ch = { joined: false, handlers: new Map() };
    channels.set(topic, ch);
  }
  const id = Symbol('handler');
  ch.handlers.set(id, handler);

  ensureSocket();
  if(socket && socket.readyState === 1) send(joinMessage(topic));

  return function unsubscribe(){
    const c = channels.get(topic);
    if(!c) return;
    c.handlers.delete(id);
    if(c.handlers.size === 0){
      channels.delete(topic);
      send({ topic, event: 'phx_leave', payload: {}, ref: nextRef() });
    }
  };
}

/** Full teardown -- used on sign-out and in tests. Leaves no timers running. */
export function disconnectAll(){
  intentionallyClosed = true;
  clearTimeout(reconnectTimer);
  stopHeartbeat();
  channels.clear();
  if(socket){ try { socket.close(); } catch {} }
  socket = null;
}

export function isConnected(){ return !!(socket && socket.readyState === 1); }

/** Test/diagnostic seam -- not used in production code paths. */
export function _debugState(){
  return { readyState: socket ? socket.readyState : -1, channelCount: channels.size, reconnectAttempt };
}
