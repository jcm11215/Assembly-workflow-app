import './stub.mjs';
globalThis.localStorage.setItem('awt_geminiKey', 'test-key-123');

// ---- Mock DB (PostgREST) + Gemini responses ----
let JOBS = [
  { id:'j1', job_number:'SC-4472', customer:'Acme', description:'', due_date:'2026-09-10',
    priority:'Medium', stage:'ready', percent_complete:0, version:1, assigned_to:null, last_moved_by:null, updated_at:'t0' }
];
let CHECKLIST = [];   // start empty -- ready stage requires steps [0,1] complete before advancing
let BLOCKERS = [];
let NOTES = [];
let ACTIVITY = [];
let PROFILES = [{ id:'u-justin', full_name:'Justin McKinney', role:'lead', active:true }];
let BLUEPRINTS = [];

let GEMINI_QUEUE = [];   // canned responses, shifted off in call order
function nextGeminiText(){ return GEMINI_QUEUE.length ? GEMINI_QUEUE.shift() : '[{"action":"unsupported","reason":"no canned response"}]'; }

globalThis.fetch = async (url, opt={}) => {
  const u = String(url); const m = opt.method||'GET';
  const body = opt.body ? JSON.parse(opt.body) : null;
  const ok = d => ({ ok:true, status:200, text:async()=>JSON.stringify(d), json:async()=>d });

  if(u.includes('generativelanguage.googleapis.com')){
    return ok({ candidates:[{ content:{ parts:[{ text: nextGeminiText() }] } }] });
  }
  if(u.includes('/rest/v1/jobs')){
    if(m==='GET'){
      let rows = JOBS;
      const idM = u.match(/[?&]id=eq\.([\w-]+)/); if(idM) rows = rows.filter(r=>r.id===idM[1]);
      const vM = u.match(/version=eq\.(\d+)/);
      if(vM){
        const idM2 = u.match(/id=eq\.([\w-]+)/);
        rows = rows.filter(r => r.id===idM2[1] && r.version===Number(vM[1]));
      }
      return ok(rows);
    }
    if(m==='POST'){ const rows=Array.isArray(body)?body:[body]; rows.forEach(r=>{r.id=r.id||'j'+(JOBS.length+1); r.version=1; JOBS.push(r);}); return ok(rows); }
    if(m==='PATCH'){
      const idM = u.match(/id=eq\.([\w-]+)/);
      const row = JOBS.find(r=>r.id===idM[1]);
      if(!row) return ok([]);
      Object.assign(row, body); row.version = (row.version||1)+1;
      return ok([row]);
    }
  }
  if(u.includes('/rest/v1/job_checklist')){
    if(m==='GET'){
      const jobM = u.match(/job_id=eq\.([\w-]+)/);
      return ok(jobM ? CHECKLIST.filter(c=>c.job_id===jobM[1]) : CHECKLIST);
    }
    if(m==='POST'){
      const rows = Array.isArray(body)?body:[body];
      rows.forEach(r=>{
        const existing = CHECKLIST.find(c=>c.job_id===r.job_id&&c.step_index===r.step_index&&c.item_index===r.item_index);
        if(existing) Object.assign(existing, r); else CHECKLIST.push(r);
      });
      return ok(rows);
    }
  }
  if(u.includes('/rest/v1/blockers')){
    if(m==='GET') return ok(BLOCKERS);
    if(m==='POST'){ const rows=Array.isArray(body)?body:[body]; rows.forEach(r=>{r.id=r.id||'b'+(BLOCKERS.length+1); BLOCKERS.push(r);}); return ok(rows); }
    if(m==='PATCH'){ const idM=u.match(/id=eq\.([\w-]+)/); const row=BLOCKERS.find(r=>r.id===idM[1]); Object.assign(row,body); return ok([row]); }
  }
  if(u.includes('/rest/v1/notes')){
    if(m==='POST'){ const rows=Array.isArray(body)?body:[body]; rows.forEach(r=>{r.id=r.id||'n'+(NOTES.length+1); NOTES.push(r);}); return ok(rows); }
    return ok(NOTES);
  }
  if(u.includes('/rest/v1/activity_log')){
    if(m==='POST'){ const rows=Array.isArray(body)?body:[body]; rows.forEach(r=>{r.id=ACTIVITY.length+1; ACTIVITY.push(r);}); return ok(rows); }
    return ok(ACTIVITY);
  }
  if(u.includes('/rest/v1/profiles')) return ok(PROFILES);
  if(u.includes('/rest/v1/blueprints') || u.includes('/rest/v1/blueprint_components')) return ok(BLUEPRINTS);
  return ok([]);
};

const { proposeActions, confirmAndExecute, cancelProposal } = await import('./src/ai/workflowExecutor.mjs');
const { parseUserIntent } = await import('./src/ai/actionParser.mjs');
const { checkActionPermission, PERMISSION } = await import('./src/ai/permissionAdapter.mjs');
const { getTool, ACTION_NAMES } = await import('./src/ai/toolRegistry.mjs');
const { state } = await import('./src/state/store.mjs');

state.jobs = [{ id:'j1', jobNumber:'SC-4472', customer:'Acme', description:'', dueDate:'2026-09-10',
  priority:'Medium', assemblyStatus:'ready', percentComplete:0, version:1, checklist:{}, assignedTo:null, blueprintId:null }];
state.blockers = []; state.notes = []; state.activity = [];

let pass=0, fail=0;
const t = (n,c) => { c ? (pass++, console.log('  PASS '+n)) : (fail++, console.log('  FAIL '+n)); };

console.log('=== actionParser: structural validation ===');
GEMINI_QUEUE.push('[{"action":"move_stage","jobNumber":"SC-4472","targetStage":"layout"}]');
let parsed = await parseUserIntent('move SC-4472 to layout');
t('valid action parsed', parsed.actions.length===1 && parsed.actions[0].action==='move_stage');

GEMINI_QUEUE.push('[{"action":"launch_missiles","jobNumber":"SC-4472"}]');
parsed = await parseUserIntent('do something bad');
t('unrecognized action rejected structurally, not executed', parsed.actions.length===0 && parsed.errors.length>0);

GEMINI_QUEUE.push('[{"action":"assign_job","jobNumber":"SC-4472"}]');   // missing required "assignee"
parsed = await parseUserIntent('assign SC-4472');
t('missing required field rejected', parsed.actions.length===0 && /missing required/i.test(parsed.errors[0]));

GEMINI_QUEUE.push('[{"action":"unsupported","reason":"just a question"}]');
parsed = await parseUserIntent('what is the weather');
t('unsupported request reported, not forced into an action', parsed.unsupported.length===1);

console.log('\n=== toolRegistry: every declared action has resolve/validate/run/preview ===');
t('all 13 actions registered', ACTION_NAMES.length===13);
ACTION_NAMES.forEach(name=>{
  const tool = getTool(name);
  if(!(typeof tool.resolve==='function' && typeof tool.validate==='function' && typeof tool.run==='function' && typeof tool.preview==='function')){
    fail++; console.log('  FAIL '+name+' missing a required method');
  } else pass++;
});

console.log('\n=== permissionAdapter: role enforcement ===');
// legacy mode: AUTH_ENABLED=false -> currentRole()==='lead' always (see permissions.js comment)
t('lead-or-admin action allowed in legacy mode', checkActionPermission(PERMISSION.LEAD_OR_ADMIN,{}).allowed===true);
t('any-signed-in allowed', checkActionPermission(PERMISSION.ANY_SIGNED_IN,{}).allowed===true);

console.log('\n=== workflowExecutor: review mode -- proposal does NOT execute ===');
GEMINI_QUEUE.push('[{"action":"assign_job","jobNumber":"SC-4472","assignee":"Justin McKinney"}]');
const beforeCount = JOBS.filter(j=>j.assigned_to).length;
const proposal = await proposeActions('assign SC-4472 to Justin McKinney');
t('proposal succeeds and is not yet executed', proposal.ok===true && !proposal.anyBlocked);
t('no repository write happened during propose', JOBS.filter(j=>j.assigned_to).length===beforeCount);
t('preview text is human-readable', /assign/i.test(proposal.steps[0].preview));

console.log('\n=== workflowExecutor: confirm actually executes exactly once ===');
const result = await confirmAndExecute(proposal.proposalId);
t('confirm executes successfully', result.ok===true);
t('job actually assigned in the mock DB', JOBS[0].assigned_to==='u-justin');
const replay = await confirmAndExecute(proposal.proposalId);
t('re-confirming an already-executed proposal is a no-op (one-shot)', replay.ok===false);

console.log('\n=== audit: AI actions logged with action_source=ai ===');
const aiLog = ACTIVITY.find(a => a.detail && a.detail.action_source==='ai' && a.detail.tool==='assign_job');
t('activity_log received an AI-sourced entry', !!aiLog);
t('audit entry names the tool used', aiLog.detail.tool==='assign_job');

console.log('\n=== business rule enforcement: AI cannot bypass the checklist gate ===');
// job is in 'ready' stage with an EMPTY checklist -- moving to 'complete' must be blocked
// (skips stages) even though the AI "asked" for it.
GEMINI_QUEUE.push('[{"action":"move_stage","jobNumber":"SC-4472","targetStage":"complete"}]');
const skipProposal = await proposeActions('jump SC-4472 straight to complete');
t('stage-skip is blocked at proposal time, reusing validateStageTransition', skipProposal.anyBlocked===true);
t('rejection reason mentions the real business rule', /skip/i.test(skipProposal.steps[0].reason));
const beforeStage = JOBS[0].stage;
await confirmAndExecute(skipProposal.proposalId);
t('blocked step never reached the repository -- stage unchanged', JOBS[0].stage===beforeStage);

console.log('\n=== multi-step workflow: "Start SC-4472" -> assign, move, note ===');
JOBS[0].assigned_to = null;   // reset
CHECKLIST.push({job_id:'j1', step_index:0, item_index:0, done:true});
CHECKLIST.push({job_id:'j1', step_index:0, item_index:1, done:true});
CHECKLIST.push({job_id:'j1', step_index:0, item_index:2, done:true});
CHECKLIST.push({job_id:'j1', step_index:0, item_index:3, done:true});
CHECKLIST.push({job_id:'j1', step_index:0, item_index:4, done:true});
CHECKLIST.push({job_id:'j1', step_index:1, item_index:0, done:true});
CHECKLIST.push({job_id:'j1', step_index:1, item_index:1, done:true});
CHECKLIST.push({job_id:'j1', step_index:1, item_index:2, done:true});
CHECKLIST.push({job_id:'j1', step_index:1, item_index:3, done:true});
CHECKLIST.push({job_id:'j1', step_index:1, item_index:4, done:true});
state.jobs[0].checklist = {'0-0':true,'0-1':true,'0-2':true,'0-3':true,'0-4':true,'1-0':true,'1-1':true,'1-2':true,'1-3':true,'1-4':true};
GEMINI_QUEUE.push(JSON.stringify([
  {action:'assign_job', jobNumber:'SC-4472', assignee:'Justin McKinney'},
  {action:'move_stage', jobNumber:'SC-4472', targetStage:'layout'},
  {action:'create_note', jobNumber:'SC-4472', notes:'Kicked off per AI request', noteType:'Progress'}
]));
const multi = await proposeActions('start SC-4472');
t('multi-step request produces 3 ordered steps', multi.steps.length===3);
t('none blocked (checklist now complete, valid one-stage move)', !multi.anyBlocked);
const multiResult = await confirmAndExecute(multi.proposalId);
t('all 3 steps executed', multiResult.executedCount===3);
t('job assigned', JOBS[0].assigned_to==='u-justin');
t('stage moved to layout', JOBS[0].stage==='layout');
t('note created', NOTES.some(n=>n.body==='Kicked off per AI request'));
const aiLogCount = ACTIVITY.filter(a=>a.detail&&a.detail.action_source==='ai').length;
t('each of the 3 steps produced its own audit entry', aiLogCount===4);   // 1 from earlier assign test + 3 here

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail?1:0);
