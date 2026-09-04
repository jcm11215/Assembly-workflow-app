// Regression test for a critical bug found during Phase 11's dead-code
// audit: state/store.js's selectedBlueprintFile was being reassigned
// directly from other modules via a named import -- illegal in ES
// modules (imported bindings are read-only to the importer). This threw
// `TypeError: Assignment to constant variable` the moment anyone
// selected a blueprint file, at runtime only (never caught by module
// parsing or boot-time checks across ten prior phases). Fixed by
// routing every read/write through the setSelectedBlueprintFile() /
// getSelectedBlueprintFile() functions that already existed for exactly
// this purpose but weren't being used by later phases' code.
//
// Run via the same .js -> .mjs conversion used elsewhere in tests/.
const store = require('../src/state/store.js');   // adapt path/extension to your test runner

let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log('  FAIL ' + n)); };

const fakeFile = { name: 'blueprint.jpg', type: 'image/jpeg' };
let threw = null;
try { store.setSelectedBlueprintFile(fakeFile); }
catch (e) { threw = e; }

t('setSelectedBlueprintFile does not throw', threw === null);
t('value is correctly stored and retrievable', store.getSelectedBlueprintFile() === fakeFile);

store.setSelectedBlueprintFile(null);
t('clearing the selection works', store.getSelectedBlueprintFile() === null);

console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
