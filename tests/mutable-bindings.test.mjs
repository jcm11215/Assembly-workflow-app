import './stub.mjs';
const geo = await import('./src/models/geometry.mjs');
const modal = await import('./src/ui/components/modal.mjs');
const store = await import('./src/state/store.mjs');

let pass=0, fail=0;
const t=(n,fn)=>{
  try { fn(); pass++; console.log('  PASS '+n); }
  catch(e){ fail++; console.log('  FAIL '+n+' -> '+e.constructor.name+': '+e.message); }
};

console.log('=== every previously-broken mutable binding, via its setter ===');
t('setModelMode(assembly)', ()=>{
  const r = geo.setModelMode(geo.MODEL_MODES.assembly);
  if(r !== geo.MODEL_MODES.assembly) throw new Error('value not applied');
});
t('setModelMode(engineering)', ()=>{
  const r = geo.setModelMode(geo.MODEL_MODES.engineering);
  if(r !== geo.MODEL_MODES.engineering) throw new Error('value not applied');
});
t('toggleShowDimensions returns new value', ()=>{
  const a = geo.toggleShowDimensions();
  const b = geo.toggleShowDimensions();
  if(a === b) throw new Error('toggle did not flip');
});
t('setShowDimensions(true)', ()=>{
  if(geo.setShowDimensions(true) !== true) throw new Error('not applied');
});
t('setModalRefresh(fn)', ()=>{
  const f = ()=>'x';
  if(modal.setModalRefresh(f) !== f) throw new Error('not applied');
});
t('setModalRefresh(null) clears', ()=>{
  if(modal.setModalRefresh(null) !== null) throw new Error('not cleared');
});
t('setCurrentJobId', ()=>{
  if(modal.setCurrentJobId('job-123') !== 'job-123') throw new Error('not applied');
});
t('setSelectedBlueprintFile (Phase 11 fix, still working)', ()=>{
  const f={name:'x.jpg'};
  store.setSelectedBlueprintFile(f);
  if(store.getSelectedBlueprintFile() !== f) throw new Error('not applied');
});

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail?1:0);
