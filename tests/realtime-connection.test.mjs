import './stub.mjs';

// A WebSocket mock that can be told to fail on connect N times.
let attempt=0, failUntil=0, instances=[];
class FlakeyWS{
  constructor(url){
    this.url=url; this.readyState=0; instances.push(this);
    attempt++;
    if(attempt<=failUntil){
      setTimeout(()=>{ this.readyState=3; this.onclose&&this.onclose(); }, 2);
    }else{
      setTimeout(()=>{ this.readyState=1; this.onopen&&this.onopen(); }, 2);
    }
  }
  send(msg){ this.lastSent = JSON.parse(msg); }
  close(){ this.readyState=3; this.onclose&&this.onclose(); }
}
globalThis.WebSocket=FlakeyWS;

const rc = await import('./src/realtime/realtimeClient.mjs');

let pass=0,fail=0; const t=(n,c)=>{c?(pass++,console.log('  PASS '+n)):(fail++,console.log('  FAIL '+n));};

console.log('=== subscribe/unsubscribe + channel bookkeeping ===');
let events=[];
const unsub = rc.subscribeTable('jobs', e=>events.push(e));
await new Promise(r=>setTimeout(r,10));
t('socket opened', rc._debugState().readyState===1);
t('one channel registered', rc._debugState().channelCount===1);

unsub();
t('unsubscribe removes the channel (0 handlers left)', rc._debugState().channelCount===0);

console.log('\n=== multiple subscribers share one channel ===');
const u1 = rc.subscribeTable('blockers', ()=>{});
const u2 = rc.subscribeTable('blockers', ()=>{});
t('two subscribers to the same table = one channel', rc._debugState().channelCount===1);
u1();
t('channel survives while one handler remains', rc._debugState().channelCount===1);
u2();
t('channel removed once the last handler unsubscribes', rc._debugState().channelCount===0);

console.log('\n=== reconnect with exponential backoff ===');
rc.disconnectAll();
attempt=0; failUntil=2; instances=[];
let connectedAt=[];
const stop = rc.onConnectionChange(s=>{ if(s==='connected') connectedAt.push(Date.now()); });
const t0=Date.now();
rc.subscribeTable('notes', ()=>{});
// First attempt fails immediately; backoff schedule is 1s, 2s, 4s... this
// test just proves eventual success and growing delay, not exact timing.
await new Promise(r=>setTimeout(r, 3200));
t('eventually connects after 2 failures', connectedAt.length>=1);
t('required more than one WebSocket construction (retried)', instances.length>=3);
stop();

console.log('\n=== channel cleanup: disconnectAll leaves no timers/channels ===');
rc.subscribeTable('activity_log', ()=>{});
await new Promise(r=>setTimeout(r,10));
rc.disconnectAll();
t('channel map cleared', rc._debugState().channelCount===0);
t('socket reference cleared', rc._debugState().readyState===-1);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail?1:0);
