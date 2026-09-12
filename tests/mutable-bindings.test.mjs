// ES module imports are read-only to the importer, so a module that
// exports mutable state has to export a setter for it too -- reassigning
// the imported binding directly throws `TypeError: Assignment to constant
// variable` at runtime, which module parsing and boot-time checks never
// catch (Phase 11 found exactly that bug in the blueprint file picker).
// This checks every such setter still applies its value.
//
// The geometry/model-mode setters this file also used to cover are gone
// with the 3D view itself -- src/models/geometry.js no longer exists.
import './stub.mjs';
const modal = await import('../src/ui/components/modal.js');
const store = await import('../src/state/store.js');

let pass=0, fail=0;
const t=(n,fn)=>{
  try { fn(); pass++; console.log('  PASS '+n); }
  catch(e){ fail++; console.log('  FAIL '+n+' -> '+e.constructor.name+': '+e.message); }
};

console.log('=== every mutable binding, via its setter ===');
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
t('setSelectedBlueprintFile(null) clears', ()=>{
  store.setSelectedBlueprintFile(null);
  if(store.getSelectedBlueprintFile() !== null) throw new Error('not cleared');
});

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail?1:0);
