import './dom.mjs';
import { DB, CALLS } from './backend.mjs';

const errors = [];
const origError = console.error;
console.error = (...a)=>{ errors.push(a.map(String).join(' ')); };

// Seed realistic data BEFORE boot
DB.jobs.push({ id:'j1', job_number:'SC-4472', customer:'Acme', description:'20in x 48ft screw conveyor',
  due_date:'2026-09-30', priority:'High', stage:'ready', percent_complete:0, version:1,
  assigned_to:null, last_moved_by:null, created_at:'2026-01-01', updated_at:'2026-01-01' });
DB.jobs.push({ id:'j2', job_number:'SC-4480', customer:'Beta Mill', description:'12in x 20ft',
  due_date:'2026-10-15', priority:'Medium', stage:'layout', percent_complete:25, version:1,
  assigned_to:'u-lead', last_moved_by:'u-lead', created_at:'2026-01-01', updated_at:'2026-01-01' });
DB.blockers.push({ id:'b1', job_id:'j1', issue:'Gearmotor delayed', department:'Purchasing',
  severity:'Critical', status:'Open', reported_at:'2026-08-01T00:00:00Z', resolved_at:null });
DB.notes.push({ id:'n1', job_id:'j1', note_type:'Progress', body:'Trough sections staged',
  note_date:'2026-08-01', created_at:'2026-08-01T00:00:00Z', author:null });
DB.activity_log.push({ id:1, actor:null, actor_name:'Test Lead', action:'Job created',
  entity_type:'job', entity_id:'j1', detail:{}, at:'2026-08-01T00:00:00Z' });
DB.job_checklist.push({ id:'c1', job_id:'j2', step_index:0, item_index:0, done:true });

const results = [];
function step(name, fn){
  return (async ()=>{
    const before = errors.length;
    try { await fn(); 
      const newErrs = errors.slice(before);
      if(newErrs.length) results.push({name, status:'ERROR-LOGGED', detail:newErrs[0].slice(0,160)});
      else results.push({name, status:'OK'});
    }
    catch(e){ results.push({name, status:'THREW', detail:`${e.constructor.name}: ${e.message}`}); }
  })();
}

// ---- boot ----
let app;
await step('boot app.js', async ()=>{
  app = await import('./src/app/app.mjs');
  await new Promise(r=>setTimeout(r,120));
});

const { state } = await import('./src/state/store.mjs');
const render = (await import('./src/app/render.mjs'));

await step('loadAll populated state', async ()=>{
  const { loadAll } = await import('./src/db/repository.mjs');
  await loadAll();
  if(!state.jobs.length) throw new Error('no jobs loaded from mock DB');
});

// ---- render every tab ----
for(const tab of ['dashboard','board','blockers','notes','assistant','activity']){
  await step(`render tab: ${tab}`, async ()=>{
    state.tab = tab;
    render.render();
    await new Promise(r=>setTimeout(r,30));
  });
}

// ---- exercise every module's exported render/open functions ----
const probes = [
  ['jobs/detail: openJobDetail', async()=>{ const m=await import('./src/jobs/detail.mjs'); m.openJobDetail('j1'); }],
  ['jobs/jobForm: openJobForm(new)', async()=>{ const m=await import('./src/jobs/jobForm.mjs'); m.openJobForm(null); }],
  ['jobs/jobForm: openJobForm(edit)', async()=>{ const m=await import('./src/jobs/jobForm.mjs'); m.openJobForm('j1'); }],
  ['jobs/stageGate: openStageGateModal', async()=>{ const m=await import('./src/jobs/stageGate.mjs'); m.openStageGateModal('j1'); }],
  ['jobs/actions: openMover', async()=>{ const m=await import('./src/jobs/actions.mjs'); m.openMover('j1'); }],
  ['blockers: openBlockerForm', async()=>{ const m=await import('./src/blockers/index.mjs'); m.openBlockerForm('SC-4472'); }],
  ['notes: openNoteForm', async()=>{ const m=await import('./src/notes/index.mjs'); m.openNoteForm('SC-4472'); }],
  ['ui/settings: openSettingsModal', async()=>{ const m=await import('./src/ui/settings.mjs'); m.openSettingsModal(); }],
  ['blueprints/ui: openBlueprintModal', async()=>{ const m=await import('./src/blueprints/ui.mjs'); m.openBlueprintModal('j1'); }],
  ['blueprints/ui: openNewJobBlueprintModal', async()=>{ const m=await import('./src/blueprints/ui.mjs'); m.openNewJobBlueprintModal(); }],
  ['blueprints/ui: reviewPanelHtml', async()=>{ const m=await import('./src/blueprints/ui.mjs'); m.reviewPanelHtml(state.jobs[0]); }],
  ['blueprints/ui: engineeringPanelHtml', async()=>{ const m=await import('./src/blueprints/ui.mjs'); m.engineeringPanelHtml(state.jobs[0]); }],
  ['blueprints/ui: verificationReportHtml', async()=>{ const m=await import('./src/blueprints/ui.mjs'); m.verificationReportHtml(state.jobs[0]); }],
  ['blueprints/ui: openVersionHistory', async()=>{ const m=await import('./src/blueprints/ui.mjs'); await m.openVersionHistory('j1'); }],
  ['blueprints/bom: bomListHtml', async()=>{ const m=await import('./src/blueprints/bom.mjs'); m.bomListHtml(state.jobs[0]); }],
  ['admin/migrationDashboard: open', async()=>{ const m=await import('./src/admin/migrationDashboard.mjs'); m.openMigrationDashboard(); }],
  ['admin/healthDashboard: open', async()=>{ const m=await import('./src/admin/healthDashboard.mjs'); await m.openHealthDashboard(); }],
  ['activity: loadActivity', async()=>{ const m=await import('./src/activity/index.mjs'); await m.loadActivity(); }],
];
for(const [name, fn] of probes) await step(name, fn);

// ---- exercise mutations ----
await step('mutation: advance stage (gated, should be blocked)', async()=>{
  const m = await import('./src/jobs/actions.mjs');
  const before = state.jobs.find(j=>j.id==='j1').assemblyStatus;
  m.attemptAdvance('j1');
  await new Promise(r=>setTimeout(r,20));
});
await step('mutation: toggle checklist item', async()=>{
  const m = await import('./src/jobs/stageGate.mjs');
  m.toggleStageChecklistItem('j1','0-0');
  await new Promise(r=>setTimeout(r,20));
});
await step('mutation: move stage backward (always allowed)', async()=>{
  const m = await import('./src/jobs/actions.mjs');
  m.moveJobToStage('j2','ready');
  await new Promise(r=>setTimeout(r,20));
});
await step('mutation: persistJobs', async()=>{
  const m = await import('./src/db/repository.mjs');
  await m.persistJobs();
});

// ---- AI action layer ----
await step('AI: proposeActions (no execution)', async()=>{
  const m = await import('./src/ai/workflowExecutor.mjs');
  await m.proposeActions('move SC-4472 to layout');
});

console.error = origError;
console.log(JSON.stringify({results, errors: errors.slice(0,30)}, null, 1));

process.exit(0);
