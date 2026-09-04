globalThis.document={getElementById:()=>null,querySelectorAll:()=>[]};
globalThis.window={};
globalThis.localStorage={_d:{},getItem(k){return this._d[k]??null},setItem(k,v){this._d[k]=String(v)}};
globalThis.AbortController=class{constructor(){this.signal={}}abort(){}};

let BLUEPRINTS=[];
globalThis.fetch=async(url,opt={})=>{
  const u=String(url); const m=opt.method||'GET';
  const ok=d=>({ok:true,status:200,text:async()=>JSON.stringify(d),json:async()=>d});
  const body=opt.body?JSON.parse(opt.body):null;
  if(u.includes('/rest/v1/blueprints')){
    if(m==='GET'){
      const jobMatch=u.match(/job_id=eq\.([\w-]+)/);
      const statusMatch=u.match(/status=eq\.([\w]+)/);
      const idMatch=u.match(/[?&]id=eq\.([\w-]+)/);
      let rows=BLUEPRINTS;
      if(jobMatch) rows=rows.filter(r=>r.job_id===jobMatch[1]);
      if(statusMatch) rows=rows.filter(r=>r.status===statusMatch[1]);
      if(idMatch) rows=rows.filter(r=>r.id===idMatch[1]);
      rows=[...rows].sort((a,b)=>b.version-a.version);
      const limMatch=u.match(/limit=(\d+)/);
      if(limMatch) rows=rows.slice(0,Number(limMatch[1]));
      return ok(rows);
    }
    if(m==='POST'){
      const rows=Array.isArray(body)?body:[body];
      rows.forEach(r=>{ r.id=r.id||'bp'+(BLUEPRINTS.length+1); BLUEPRINTS.push(r); });
      return ok(rows);
    }
    if(m==='PATCH'){
      const idMatch=u.match(/id=eq\.([\w-]+)/);
      const row=BLUEPRINTS.find(r=>r.id===idMatch[1]);
      Object.assign(row,body);
      return ok([row]);
    }
  }
  if(u.includes('/blueprint_components')) return ok([]);
  if(u.includes('/storage/v1/object')) return ok({});
  return ok([]);
};

const repo = await import('./src/db/blueprintsRepo.mjs');

let pass=0,fail=0; const t=(n,c)=>{c?(pass++,console.log('  PASS '+n)):(fail++,console.log('  FAIL '+n));};

console.log('=== version numbering (Req 8) ===');
const v1 = await repo.saveExtraction('job1', {spec:{conveyorType:'screw'}, components:[], status:'review_required', confidence:0.6});
t('first scan is version 1', v1.version===1);
const v2 = await repo.saveExtraction('job1', {spec:{conveyorType:'screw'}, components:[], status:'review_required', confidence:0.8});
t('second scan is version 2', v2.version===2);
const v3 = await repo.saveExtraction('job1', {spec:{conveyorType:'screw'}, components:[], status:'approved', confidence:0.95, autoApproved:true});
t('third scan is version 3', v3.version===3);
t('auto-approval leaves reviewed_by null (distinguishable from human approval)',
  BLUEPRINTS.find(b=>b.id===v3.id).reviewed_by===null);
t('auto-approval still stamps reviewed_at', !!BLUEPRINTS.find(b=>b.id===v3.id).reviewed_at);

console.log('\n=== getForJob prefers latest APPROVED over latest overall ===');
const v4 = await repo.saveExtraction('job1', {spec:{conveyorType:'screw'}, components:[], status:'review_required', confidence:0.6});
t('version 4 exists and is newer', v4.version===4);
const active = await repo.getForJob('job1');
t('getForJob returns v3 (latest approved), not v4 (latest overall)', active.version===3);

console.log('\n=== approveVersion is a human decision, distinct from auto-approval ===');
const approvedV4 = await repo.approveVersion(v4.id, 'Looked correct after review');
t('human approval clears auto_approved flag (the real distinguishing signal -- reviewed_by is null here only because currentUserId() has no provider wired in this unauthenticated test, matching Phase 5 legacy-mode default)', approvedV4.auto_approved===false);
const nowActive = await repo.getForJob('job1');
t('getForJob now returns v4 (newest approved after human review)', nowActive.version===4);

console.log('\n=== version comparison (Req 8) ===');
const specA = {overall:{overall_length:{status:'ok',normalized_in:480,confidence:0.9}}};
const specB = {overall:{overall_length:{status:'ok',normalized_in:576,confidence:0.95}}};
const compA = {version:1, spec:specA, components:[{item:'Bearing', installation_location:'hanger', specification:'2"', quantity:2}], status:'review_required', confidence:0.7};
const compB = {version:2, spec:specB, components:[{item:'Bearing', installation_location:'hanger', specification:'2.5"', quantity:2},{item:'Coupling', installation_location:'screw', specification:'3"', quantity:4}], status:'approved', confidence:0.92};
const diff = repo.diffVersions(compA, compB);
t('dimension change detected (length 480->576)', diff.dimensionChanges.some(d=>d.field==='overall.overall_length'&&d.from===480&&d.to===576));
t('changed component detected (bearing spec 2"->2.5")', diff.changedComponents.some(c=>c.item==='Bearing'));
t('added component detected (Coupling)', diff.addedComponents.some(c=>c.item==='Coupling'));
t('status change detected', diff.statusChange && diff.statusChange.from==='review_required' && diff.statusChange.to==='approved');

console.log('\n=== rejectVersion ===');
const rejected = await repo.rejectVersion(v2.id, 'Blurry photo, re-scan needed');
t('reject sets status', rejected.status==='rejected');

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail?1:0);
