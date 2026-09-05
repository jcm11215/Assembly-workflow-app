import './stub.mjs';
globalThis.fetch = async()=>({ok:true,status:200,text:async()=>'[]',json:async()=>[]});

const { checkActionPermission, PERMISSION } = await import('./src/ai/permissionAdapter.mjs');
const authService = await import('./src/auth/authService.mjs');
const sessionStore = await import('./src/auth/sessionStore.mjs');
const profileService = await import('./src/auth/profileService.mjs');

let pass=0, fail=0;
const t = (n,c) => { c ? (pass++, console.log('  PASS '+n)) : (fail++, console.log('  FAIL '+n)); };

// This module reads AUTH_ENABLED at import time as a const, so to test
// authenticated-mode scoping we do what earlier phases' tests already
// do: flip the flag in this test-only copy, not the shipped source.
sessionStore.setSession({ access_token:'t', refresh_token:'r', expires_at: Math.floor(Date.now()/1000)+3600, user:{id:'assembler-1', email:'a@shop.com'} });
profileService.setCachedProfile({ id:'assembler-1', full_name:'Alex Assembler', role:'assembler' });

console.log('=== ASSIGNED_OR_LEAD: assembler scoped to their own job ===');
const myJob = { assignedTo:'assembler-1', jobNumber:'SC-1' };
const otherJob = { assignedTo:'someone-else', jobNumber:'SC-2' };
t('assembler allowed on their own assigned job', checkActionPermission(PERMISSION.ASSIGNED_OR_LEAD,{job:myJob}).allowed===true);
t('assembler blocked on a job assigned to someone else', checkActionPermission(PERMISSION.ASSIGNED_OR_LEAD,{job:otherJob}).allowed===false);

console.log('\n=== PROGRESS_ONLY_OR_LEAD: assembler may only touch percentComplete ===');
t('assembler allowed: progress-only change on own job',
  checkActionPermission(PERMISSION.PROGRESS_ONLY_OR_LEAD,{job:myJob, changedFields:['percentComplete']}).allowed===true);
const r = checkActionPermission(PERMISSION.PROGRESS_ONLY_OR_LEAD,{job:myJob, changedFields:['priority']});
t('assembler blocked: non-progress field change', r.allowed===false);
t('rejection names the offending field', /priority/i.test(r.reason));

console.log('\n=== LEAD_OR_ADMIN: assembler blocked entirely ===');
t('assembler blocked from a lead-only action', checkActionPermission(PERMISSION.LEAD_OR_ADMIN,{}).allowed===false);

console.log('\n=== role escalation: same checks pass once promoted to lead ===');
profileService.setCachedProfile({ id:'assembler-1', full_name:'Alex Assembler', role:'lead' });
t('promoted user now passes LEAD_OR_ADMIN', checkActionPermission(PERMISSION.LEAD_OR_ADMIN,{}).allowed===true);
t('promoted lead is not job-scoped (can act on any job)', checkActionPermission(PERMISSION.ASSIGNED_OR_LEAD,{job:otherJob}).allowed===true);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail?1:0);
