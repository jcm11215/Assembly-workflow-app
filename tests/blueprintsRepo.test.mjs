globalThis.document={getElementById:()=>null,querySelectorAll:()=>[]};
globalThis.window={};
globalThis.localStorage={_d:{},getItem(k){return this._d[k]??null},setItem(k,v){this._d[k]=String(v)}};
globalThis.AbortController=class{constructor(){this.signal={}}abort(){}};

let BLUEPRINTS=[];
let COMPONENTS=[];
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
  if(u.includes('/blueprint_components')){
    if(m==='POST'){
      const rows=Array.isArray(body)?body:[body];
      rows.forEach(r=>{ r.id=r.id||'c'+(COMPONENTS.length+1); COMPONENTS.push(r); });
      return ok(rows);
    }
    const bpMatch=u.match(/blueprint_id=eq\.([\w-]+)/);
    return ok(bpMatch ? COMPONENTS.filter(c=>c.blueprint_id===bpMatch[1]) : COMPONENTS);
  }
  if(u.includes('/storage/v1/object')) return ok({});
  return ok([]);
};

const repo = await import('../src/db/blueprintsRepo.js');

let pass=0,fail=0; const t=(n,c)=>{c?(pass++,console.log('  PASS '+n)):(fail++,console.log('  FAIL '+n));};

console.log('=== version numbering: every scan is a new version, never an overwrite ===');
const v1 = await repo.saveExtraction('job1', {components:[]});
t('first scan is version 1', v1.version===1);
const v2 = await repo.saveExtraction('job1', {components:[]});
t('second scan is version 2', v2.version===2);
const v3 = await repo.saveExtraction('job1', {components:[]});
t('third scan is version 3', v3.version===3);
t('the earlier versions are still there, not overwritten', BLUEPRINTS.filter(b=>b.job_id==='job1').length===3);

console.log('\n=== getForJob serves the latest scan ===');
// There is no approval step to defer to anymore -- a re-scan is what the
// floor sees as soon as it finishes. (This used to prefer the latest
// APPROVED version; that workflow was removed from the scan pipeline.)
const active = await repo.getForJob('job1');
t('getForJob returns the newest version', active.version===3);
const v4 = await repo.saveExtraction('job1', {components:[]});
t('a newer scan becomes the active one immediately', (await repo.getForJob('job1')).version===4 && v4.version===4);

console.log('\n=== saveExtraction records only what survives a scan ===');
// spec/validation/confidence/status are deliberately not persisted -- the
// components list and the original file are the whole output of a scan.
const savedRow = BLUEPRINTS.find(b=>b.id===v4.id);
t('status is always the plain extracted state', savedRow.status==='extracted');
t('no confidence is recorded', savedRow.confidence===undefined || savedRow.confidence===null);
t('no spec blob is recorded', savedRow.spec===undefined || savedRow.spec===null);

console.log('\n=== component positions round-trip (component map) ===');
const withPins = await repo.saveExtraction('job2', {components:[
  {item:'Drive', item_as_drawn:'SCREW CONV DRIVE, 3/4HP', stage:'drive', installation_location:'drive_end', source_page:1, position:{x:0.25, y:0.75}},
  {item:'Reducer', stage:'drive', installation_location:'drive_end', source_page:1, position:null}
]});
const pinRows = COMPONENTS.filter(c=>c.blueprint_id===withPins.id);
t('the drawing\'s own wording is persisted verbatim next to the category',
  (await repo.listComponents(withPins.id)).some(c=>c.item==='Drive' && c.item_as_drawn==='SCREW CONV DRIVE, 3/4HP'));
t('a pinned component stores its x/y', pinRows.some(c=>c.item==='Drive' && Number(c.position_x)===0.25 && Number(c.position_y)===0.75));
t('an unpinned component stores nulls, not a guess', pinRows.some(c=>c.item==='Reducer' && c.position_x===null && c.position_y===null));

console.log('\n=== version comparison ===');
const specA = {overall:{overall_length:{status:'ok',normalized_in:480,confidence:0.9}}};
const specB = {overall:{overall_length:{status:'ok',normalized_in:576,confidence:0.95}}};
const compA = {version:1, spec:specA, components:[{item:'Bearing', installation_location:'hanger', specification:'2"', quantity:2}]};
const compB = {version:2, spec:specB, components:[{item:'Bearing', installation_location:'hanger', specification:'2.5"', quantity:2},{item:'Coupling', installation_location:'screw', specification:'3"', quantity:4}]};
const diff = repo.diffVersions(compA, compB);
t('dimension change detected (length 480->576)', diff.dimensionChanges.some(d=>d.field==='overall.overall_length'&&d.from===480&&d.to===576));
t('changed component detected (bearing spec 2"->2.5")', diff.changedComponents.some(c=>c.item==='Bearing'));
t('added component detected (Coupling)', diff.addedComponents.some(c=>c.item==='Coupling'));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail?1:0);
