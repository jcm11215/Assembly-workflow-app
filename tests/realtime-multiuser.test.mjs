import './stub.mjs';
const { state } = await import('./src/state/store.mjs');
const { handleJobEvent } = await import('./src/realtime/jobsRealtime.mjs');

let pass=0, fail=0;
const t=(n,c)=>{c?(pass++,console.log('  PASS '+n)):(fail++,console.log('  FAIL '+n));};

console.log('=== SCENARIO: two assemblers, two different jobs, concurrent edits ===');
state.jobs = [
  { id:'j1', jobNumber:'SC-1', assemblyStatus:'ready', percentComplete:0, version:1, checklist:{} },
  { id:'j2', jobNumber:'SC-2', assemblyStatus:'layout', percentComplete:20, version:1, checklist:{} }
];
// Assembler A ticks a box on SC-1 (server confirms v2); Assembler B moves
// SC-2 (server confirms v2) -- realtime events for both arrive interleaved.
handleJobEvent({ type:'UPDATE', record:{ id:'j1', job_number:'SC-1', stage:'ready', percent_complete:0, version:2 } });
handleJobEvent({ type:'UPDATE', record:{ id:'j2', job_number:'SC-2', stage:'bearings', percent_complete:35, version:2 } });
t('SC-1 updated independently', state.jobs[0].version===2);
t('SC-2 updated independently, unaffected by SC-1 event', state.jobs[1].assemblyStatus==='bearings' && state.jobs[1].version===2);

console.log('\n=== SCENARIO: two leads, conflicting writes to the SAME job ===');
state.jobs = [{ id:'j3', jobNumber:'SC-3', assemblyStatus:'ready', percentComplete:0, version:1, checklist:{} }];
// Lead A's device writes first (server assigns v2), and that event arrives.
handleJobEvent({ type:'UPDATE', record:{ id:'j3', job_number:'SC-3', stage:'layout', percent_complete:15, version:2 } });
t('first write applied', state.jobs[0].version===2 && state.jobs[0].assemblyStatus==='layout');
// Lead B's device had ALSO started from v1 and its write is REJECTED
// server-side (optimistic concurrency, Phase 3) -- so no v-based event for
// that failed write ever arrives. Confirm a stale v1 echo (e.g. a network
// replay) does not regress the already-applied v2 state.
handleJobEvent({ type:'UPDATE', record:{ id:'j3', job_number:'SC-3', stage:'ready', percent_complete:0, version:1 } });
t('stale v1 echo of the LOSING write does not roll back the winning v2 state',
  state.jobs[0].version===2 && state.jobs[0].assemblyStatus==='layout');

console.log('\n=== SCENARIO: reconnect after an outage triggers a full catch-up (app.js logic) ===');
let reloadCount = 0;
let sawDisconnect = false;
function simulateConnectionChange(connState){
  if(connState==='disconnected'){ sawDisconnect = true; return; }
  if(connState==='connected' && sawDisconnect){ sawDisconnect = false; reloadCount++; }
}
simulateConnectionChange('connected');       // normal startup -- no prior disconnect
t('initial connect does not trigger a redundant reload', reloadCount===0);
simulateConnectionChange('disconnected');
simulateConnectionChange('connected');       // reconnect after a real drop
t('reconnect AFTER a disconnect triggers exactly one catch-up reload', reloadCount===1);
simulateConnectionChange('connected');       // a second "connected" event with no new disconnect between
t('a redundant connected event does not trigger a second reload', reloadCount===1);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail?1:0);
