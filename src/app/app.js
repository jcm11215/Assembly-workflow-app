/**
 * Application bootstrap. Ordering matters:
 *   1. wire the render bus + user-id provider
 *   2. paint shell
 *   3. identity gate (login screen or legacy name prompt)
 *   4. load data            5. first render       6. bind events
 *   7. start realtime       8. wire cleanup
 *
 * Polling is gone. Realtime replaces it: on connect, subscribe to
 * jobs/blockers/notes/activity; on reconnect after a drop, do one full
 * reload to close whatever gap was missed while offline, then let
 * per-record events take over again.
 */
import { initEventRouter } from './events.js';
import { render, updateDateSub } from './render.js';
import { setRenderer } from './bus.js';
import { flushPendingSaves, loadAll } from '../db/repository.js';
import { setCurrentUserIdProvider } from '../db/supabaseClient.js';
import { ensureUserName } from '../auth/nameGate.js';
import { AUTH_ENABLED, restoreSession, currentActorId } from '../auth/authService.js';
import { showLogin } from '../auth/loginView.js';
import { onConnectionChange, disconnectAll } from '../realtime/realtimeClient.js';
import { startJobsRealtime, stopJobsRealtime } from '../realtime/jobsRealtime.js';
import { startBlockersRealtime, stopBlockersRealtime } from '../realtime/blockersRealtime.js';
import { startNotesRealtime, stopNotesRealtime } from '../realtime/notesRealtime.js';
import { startActivityRealtime, stopActivityRealtime } from '../realtime/activityRealtime.js';
import { showToast } from '../ui/components/toast.js';
import { initErrorHandlers } from '../monitoring/errorHandler.js';
import { initConnectionMonitor } from '../monitoring/connectionMonitor.js';

export async function boot(){
  setRenderer(render);                              // wire the bus before anything can request a render
  setCurrentUserIdProvider(currentActorId);          // db layer asks auth, never the other way around
  initErrorHandlers();                               // observational only -- catches, never suppresses

  updateDateSub();
  document.getElementById('content').innerHTML =
    `<div class="empty-state"><div class="big">&#8987;</div>Loading shop data...</div>`;

  if(AUTH_ENABLED){
    const session = await restoreSession();
    if(!session){
      showLogin(() => continueBoot());               // blocks here until sign-in succeeds
      return;
    }
  }
  await continueBoot();
}

let realtimeStarted = false;
let sawDisconnect = false;

async function continueBoot(){
  await loadAll();
  render();
  initEventRouter();

  if(!AUTH_ENABLED) ensureUserName();                // legacy mode only -- unchanged from Phase 0-4

  startRealtime();
  window.addEventListener('pagehide', teardown);
}

function startRealtime(){
  if(realtimeStarted) return;
  realtimeStarted = true;
  initConnectionMonitor();   // subscribes to the connection-change events realtimeClient already emits

  onConnectionChange((state) => {
    if(state === 'disconnected'){
      sawDisconnect = true;
      return;
    }
    if(state === 'connected' && sawDisconnect){
      // We were offline for some stretch -- per-record events during that
      // window are gone, so one full reload closes the gap before
      // resuming incremental patching.
      sawDisconnect = false;
      loadAll().then(render).catch(e => {
        console.error('post-reconnect reload failed', e);
        showToast('Reconnected, but could not refresh data -- try the app again shortly', 5000);
      });
    }
  });

  startJobsRealtime();
  startBlockersRealtime();
  startNotesRealtime();
  startActivityRealtime();
}

function stopRealtime(){
  stopJobsRealtime();
  stopBlockersRealtime();
  stopNotesRealtime();
  stopActivityRealtime();
  disconnectAll();
  realtimeStarted = false;
}

function teardown(){
  flushPendingSaves();
  stopRealtime();
}

/** Exposed for sign-out and tests -- explicit cleanup, not just relying on page unload. */
export { stopRealtime, startRealtime };

boot();
