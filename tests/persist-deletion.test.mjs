import './stub.mjs';
let JOBS=[{id:'j1', job_number:'SC-1', customer:'Acme', description:'', due_date:null, priority:'Medium', stage:'ready', percent_complete:0, version:1, assigned_to:null, last_moved_by:null, updated_at:'t0'}];
let DELETE_CALLS = [];
globalThis.fetch = async(url,opt={})=>{
  const u=String(url); const m=opt.method||'GET';
  const ok=d=>({ok:true,status:200,text:async()=>JSON.stringify(d),json:async()=>d});
  if(u.includes('/rest/v1/jobs')){
    if(m==='GET') return ok(JOBS);
    if(m==='DELETE'){ const idM=u.match(/id=eq\.([\w-]+)/); DELETE_CALLS.push(idM[1]); JOBS=JOBS.filter(j=>j.id!==idM[1]); return ok([]); }
    if(m==='PATCH'){ const idM=u.match(/id=eq\.([\w-]+)/); const row=JOBS.find(j=>j.id===idM[1]); if(!row) return ok([]); Object.assign(row,JSON.parse(opt.body)); row.version=(row.version||1)+1; return ok([row]); }
    if(m==='POST'){ const body=JSON.parse(opt.body); const rows=Array.isArray(body)?body:[body]; rows.forEach(r=>{r.id=r.id||'j'+(JOBS.length+1); r.version=1; JOBS.push(r);}); return ok(rows); }
  }
  if(u.includes('/rest/v1/job_checklist')) return ok([]);
  if(u.includes('/rest/v1/blueprints')||u.includes('/rest/v1/blueprint_components')) return ok([]);
  if(u.includes('/rest/v1/profiles')) return ok([]);
  return ok([]);
};

const { loadAll, persistJobs } = await import('./src/db/repository.mjs');
const { state } = await import('./src/state/store.mjs');

let pass=0, fail=0;
const t=(n,c)=>{c?(pass++,console.log('  PASS '+n)):(fail++,console.log('  FAIL '+n));};

await loadAll();
t('loaded 1 job', state.jobs.length===1);

console.log('=== persistJobs: deletion is detected and persisted (regression test for the fix) ===');
state.jobs = state.jobs.filter(j => j.id !== 'j1');   // simulate the delete-job UI action
const result = await persistJobs();
t('persistJobs reports success', result===true);
t('DELETE was actually called against the repository', DELETE_CALLS.includes('j1'));
t('job is gone from the mock database, not just local state', JOBS.length===0);

console.log('\n=== persistJobs: create still works after the fix ===');
DELETE_CALLS = [];
state.jobs = [{ id:'jnew', jobNumber:'SC-9', customer:'Beta', assemblyStatus:'ready', percentComplete:0, checklist:{} }];
await persistJobs();
t('new job created in mock DB', JOBS.some(j=>j.job_number==='SC-9'));
t('no spurious delete calls during a create', DELETE_CALLS.length===0);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail?1:0);
