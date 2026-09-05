import './stub.mjs';
let BLOCKERS=[{id:'b1', job_id:'j1', issue:'test issue', department:'', severity:'Medium', status:'Open', reported_at:'2026-01-01T00:00:00Z'}];
let DELETE_CALLS=[];
globalThis.fetch = async(url,opt={})=>{
  const u=String(url); const m=opt.method||'GET';
  const ok=d=>({ok:true,status:200,text:async()=>JSON.stringify(d),json:async()=>d});
  if(u.includes('/rest/v1/blockers')){
    if(m==='GET') return ok(BLOCKERS);
    if(m==='DELETE'){ const idM=u.match(/id=eq\.([\w-]+)/); DELETE_CALLS.push(idM[1]); BLOCKERS=BLOCKERS.filter(b=>b.id!==idM[1]); return ok([]); }
  }
  if(u.includes('/rest/v1/jobs')) return ok([{id:'j1',job_number:'SC-1',customer:'',stage:'ready',percent_complete:0,version:1}]);
  if(u.includes('/rest/v1/job_checklist')||u.includes('/rest/v1/blueprints')||u.includes('/rest/v1/blueprint_components')||u.includes('/rest/v1/profiles')||u.includes('/rest/v1/notes')) return ok([]);
  return ok([]);
};
const { loadAll, persistBlockers } = await import('./src/db/repository.mjs');
const { state } = await import('./src/state/store.mjs');

let pass=0, fail=0;
const t=(n,c)=>{c?(pass++,console.log('  PASS '+n)):(fail++,console.log('  FAIL '+n));};

await loadAll();
t('loaded 1 blocker', state.blockers.length===1);

console.log('=== persistBlockers: single delete, nothing else changed (the exact bug pattern) ===');
state.blockers = [];   // delete the only blocker, no other edits pending
const result = await persistBlockers();
t('persistBlockers reports success', result===true);
t('DELETE actually reached the repository', DELETE_CALLS.includes('b1'));
t('blocker gone from mock DB, not just local state', BLOCKERS.length===0);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail?1:0);
