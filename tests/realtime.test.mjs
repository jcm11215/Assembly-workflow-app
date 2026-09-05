import './stub.mjs';

const { state } = await import('./src/state/store.mjs');
const { handleJobEvent, patchJobFromRow } = await import('./src/realtime/jobsRealtime.mjs');
const { handleBlockerEvent } = await import('./src/realtime/blockersRealtime.mjs');
const { handleNoteEvent } = await import('./src/realtime/notesRealtime.mjs');
const { handleActivityEvent } = await import('./src/realtime/activityRealtime.mjs');

let pass=0,fail=0; const t=(n,c)=>{c?(pass++,console.log('  PASS '+n)):(fail++,console.log('  FAIL '+n));};

console.log('=== jobs: patch-by-id ===');
state.jobs=[{id:'j1',jobNumber:'SC-1',customer:'Acme',assemblyStatus:'ready',percentComplete:0,version:1,checklist:{'0-0':true},spec:{foo:'bar'}}];
handleJobEvent({type:'UPDATE',record:{id:'j1',job_number:'SC-1',customer:'Acme',stage:'layout',percent_complete:15,version:2}});
t('stage patched by id', state.jobs[0].assemblyStatus==='layout');
t('percentComplete patched', state.jobs[0].percentComplete===15);
t('version advanced', state.jobs[0].version===2);
t('checklist preserved (not in the row payload)', state.jobs[0].checklist['0-0']===true);
t('spec preserved (not in the row payload)', state.jobs[0].spec.foo==='bar');

console.log('\n=== jobs: stale-version rejection ===');
handleJobEvent({type:'UPDATE',record:{id:'j1',job_number:'SC-1',stage:'ready',percent_complete:0,version:1}}); // older
t('stale UPDATE (v1 after v2) is dropped', state.jobs[0].assemblyStatus==='layout' && state.jobs[0].version===2);

console.log('\n=== jobs: duplicate/out-of-order delivery ===');
handleJobEvent({type:'UPDATE',record:{id:'j1',job_number:'SC-1',stage:'layout',percent_complete:15,version:2}}); // same version, re-delivered
t('same-version echo is idempotent (no error, state unchanged)', state.jobs[0].version===2 && state.jobs[0].assemblyStatus==='layout');

console.log('\n=== jobs: DELETE by id ===');
state.jobs.push({id:'j2',jobNumber:'SC-2',version:1});
handleJobEvent({type:'DELETE',oldRecord:{id:'j2'}});
t('deleted job removed by id, other job untouched', state.jobs.length===1 && state.jobs[0].id==='j1');

console.log('\n=== jobs: optimistic-update echo is a no-op ===');
// Simulate: local device just wrote version 3 optimistically (as
// persistJobs() does), then the realtime echo of that same write arrives.
state.jobs[0].version=3; state.jobs[0].percentComplete=30;
handleJobEvent({type:'UPDATE',record:{id:'j1',job_number:'SC-1',stage:'layout',percent_complete:30,version:3}});
t('echo of our own write does not regress or duplicate state', state.jobs[0].percentComplete===30 && state.jobs[0].version===3);

console.log('\n=== blockers: insert/update/delete by id, job_number resolved locally ===');
state.blockers=[];
handleBlockerEvent({type:'INSERT',record:{id:'b1',job_id:'j1',issue:'Gearmotor delayed',department:'Purchasing',severity:'Critical',status:'Open',reported_at:'2026-08-30T00:00:00Z'}});
t('blocker inserted', state.blockers.length===1);
t('job_number resolved from local jobs (not in the row payload)', state.blockers[0].jobNumber==='SC-1');
handleBlockerEvent({type:'UPDATE',record:{id:'b1',job_id:'j1',issue:'Gearmotor delayed',department:'Purchasing',severity:'Critical',status:'Resolved',reported_at:'2026-08-30T00:00:00Z'}});
t('blocker status patched by id', state.blockers[0].status==='Resolved');
handleBlockerEvent({type:'DELETE',oldRecord:{id:'b1'}});
t('blocker removed by id', state.blockers.length===0);

console.log('\n=== notes: insert by id, dedupe on update ===');
state.notes=[];
handleNoteEvent({type:'INSERT',record:{id:'n1',job_id:'j1',note_type:'Progress',body:'Trough aligned',note_date:'2026-08-30'}});
t('note inserted', state.notes.length===1);
handleNoteEvent({type:'INSERT',record:{id:'n1',job_id:'j1',note_type:'Progress',body:'Trough aligned (edited)',note_date:'2026-08-30'}});
t('re-delivery of same id updates in place, no duplicate', state.notes.length===1 && state.notes[0].notes.includes('edited'));

console.log('\n=== activity: append-only, INSERT only, dedupe, capped ===');
state.activity=[];
handleActivityEvent({type:'INSERT',record:{id:1,actor_name:'D. Reyes',action:'Job created',detail:{},at:'2026-08-30T00:00:00Z'}});
t('activity row appended', state.activity.length===1);
handleActivityEvent({type:'UPDATE',record:{id:1,actor_name:'Tampered',action:'edited'}});
t('UPDATE event ignored -- log is append-only client-side too', state.activity[0].who==='D. Reyes');
handleActivityEvent({type:'INSERT',record:{id:1,actor_name:'D. Reyes',action:'Job created',detail:{},at:'2026-08-30T00:00:00Z'}});
t('duplicate INSERT (same id) not appended twice', state.activity.length===1);
for(let i=2;i<=305;i++) handleActivityEvent({type:'INSERT',record:{id:i,actor_name:'X',action:'test',detail:{},at:'t'}});
t('activity list capped at 300', state.activity.length===300);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail?1:0);
