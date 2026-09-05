import './dom.mjs';
import { DB } from './backend.mjs';

const errors = [];
console.error = (...a)=>errors.push(a.map(String).join(' '));

DB.jobs.push({ id:'j1', job_number:'SC-4472', customer:'Acme', description:'test',
  due_date:'2026-09-30', priority:'High', stage:'ready', percent_complete:0, version:1,
  assigned_to:null, last_moved_by:null, updated_at:'t' });
DB.blockers.push({ id:'b1', job_id:'j1', issue:'X', department:'P', severity:'High', status:'Open', reported_at:'2026-08-01T00:00:00Z', resolved_at:null });
DB.notes.push({ id:'n1', job_id:'j1', note_type:'Progress', body:'note', note_date:'2026-08-01', created_at:'t', author:null });
DB.blueprints.push({ id:'bp1', job_id:'j1', status:'review_required', version:1, confidence:0.8,
  spec:{conveyorType:'screw', overall:{}}, validation:{checks:[],ok:true,errors:0,conflicts:0,warnings:0},
  storage_path:null, extracted_at:'t', reviewed_at:null, review_urgency:'suggested', auto_approved:false });

await import('./src/app/app.mjs');
await new Promise(r=>setTimeout(r,150));
const { state } = await import('./src/state/store.mjs');
const { loadAll } = await import('./src/db/repository.mjs');
await loadAll();
state.jobs.forEach(j=>{ if(!j.blueprintId && j.id==='j1') j.blueprintId='bp1'; });

// Collect every data-action in the source
import fs from 'fs';
function walk(d){ let o=[]; for(const f of fs.readdirSync(d,{withFileTypes:true})){ const p=d+'/'+f.name; o = f.isDirectory()? o.concat(walk(p)) : o.concat([p]); } return o; }
const actions = new Set();
for(const f of walk('./src')){
  if(!f.endsWith('.mjs')) continue;
  for(const m of fs.readFileSync(f,'utf8').matchAll(/data-action="([a-z-]+)"/g)) actions.add(m[1]);
}

// Find the delegated click handler the app registered on document
const handlers = (document._l && document._l.click) || [];
if(!handlers.length){ console.log(JSON.stringify({fatal:'no click handler registered'})); process.exit(1); }

const dataIds = { 'j1':'job', 'b1':'blocker', 'n1':'note', 'bp1':'blueprint' };
const results = [];
for(const action of [...actions].sort()){
  const before = errors.length;
  const btn = new globalThis.__El('button');
  btn.setAttribute('data-action', action);
  btn.setAttribute('data-id', action.includes('blocker')?'b1' : action.includes('bp-')?'bp1' : 'j1');
  btn.setAttribute('data-stage','layout');
  btn.setAttribute('data-mode', action.startsWith('mig-') ? 'legacy_reads' : 'assembly');
  btn.setAttribute('data-part','trough');
  btn.setAttribute('data-prompt','test');
  btn.setAttribute('data-index','0');
  btn.setAttribute('data-provider','gemini');
  btn.setAttribute('data-proposal-id','none');
  const ev = { type:'click', target:{ closest:(sel)=> sel==='[data-action]'?btn:null, hasAttribute:()=>false }, preventDefault(){} };
  try {
    handlers.forEach(h=>h(ev));
    await new Promise(r=>setTimeout(r,15));
    const errs = errors.slice(before).filter(e=>!/NO_API_KEY|api key|Supabase is not configured/i.test(e));
    results.push({action, status: errs.length?'ERROR':'OK', detail: errs[0]?.slice(0,150)});
  } catch(e){
    results.push({action, status:'THREW', detail:`${e.constructor.name}: ${e.message}`});
  }
}
console.log(JSON.stringify({results, total:actions.size}, null, 1));
process.exit(0);
