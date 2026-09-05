import './stub.mjs';
let ACTIVITY=[];
globalThis.WebSocket=class{constructor(){this.readyState=0;setTimeout(()=>{this.readyState=1;this.onopen&&this.onopen();},2);}send(){}close(){this.readyState=3;this.onclose&&this.onclose();}};
globalThis.fetch = async(url,opt={})=>{
  const ok=d=>({ok:true,status:200,text:async()=>JSON.stringify(d),json:async()=>d});
  if(String(url).includes('/rest/v1/activity_log') && (opt.method||'GET')==='POST'){
    const body=JSON.parse(opt.body); const rows=Array.isArray(body)?body:[body];
    rows.forEach(r=>{r.id=ACTIVITY.length+1; ACTIVITY.push(r);}); return ok(rows);
  }
  return ok([]);
};

const { initConnectionMonitor, getConnectionSummary, getConnectionHistory } = await import('./src/monitoring/connectionMonitor.mjs');
const rc = await import('./src/realtime/realtimeClient.mjs');

let pass=0, fail=0;
const t=(n,c)=>{c?(pass++,console.log('  PASS '+n)):(fail++,console.log('  FAIL '+n));};

console.log('=== connection monitor observes realtimeClient without modifying it ===');
initConnectionMonitor();
const unsub = rc.subscribeTable('jobs', ()=>{});
await new Promise(r=>setTimeout(r,10));
t('sees the connection as up', getConnectionSummary().connected===true);

console.log('\n=== disconnect + reconnect is logged with duration ===');
ACTIVITY = [];
rc.disconnectAll();   // simulates a drop
await new Promise(r=>setTimeout(r,10));
rc.subscribeTable('blockers', ()=>{});   // triggers a fresh connect
await new Promise(r=>setTimeout(r,10));
await new Promise(r=>setTimeout(r,10));
const summary = getConnectionSummary();
t('disconnect event recorded', getConnectionHistory().some(h=>h.state==='disconnected'));
t('reconnect logged to activity_log', ACTIVITY.some(a=>a.action==='Realtime reconnected'));
t('disconnect also logged', ACTIVITY.some(a=>a.action==='Realtime disconnected'));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail?1:0);
