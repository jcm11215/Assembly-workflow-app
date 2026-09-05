import './stub.mjs';
let ACTIVITY=[];
globalThis.fetch = async(url,opt={})=>{
  const u=String(url); const m=opt.method||'GET';
  const ok=d=>({ok:true,status:200,text:async()=>JSON.stringify(d),json:async()=>d});
  if(u.includes('/rest/v1/activity_log')){
    if(m==='POST'){ const body=JSON.parse(opt.body); const rows=Array.isArray(body)?body:[body];
      rows.forEach(r=>{r.id=ACTIVITY.length+1; ACTIVITY.push(r);}); return ok(rows); }
    return ok(ACTIVITY);
  }
  return ok([]);
};

const { initErrorHandlers, reportError, getErrorLog, clearErrorLog } = await import('./src/monitoring/errorHandler.mjs');

let pass=0, fail=0;
const t=(n,c)=>{c?(pass++,console.log('  PASS '+n)):(fail++,console.log('  FAIL '+n));};

console.log('=== global error handlers ===');
initErrorHandlers();
clearErrorLog();
window.dispatch('error', { message:'Cannot read property of undefined', filename:'app.mjs', lineno:12, colno:3 });
t('uncaught exception captured', getErrorLog().length===1);
t('captured entry has the right kind', getErrorLog()[0].kind==='uncaught exception');

window.dispatch('unhandledrejection', { reason: new Error('fetch failed') });
t('unhandled rejection captured', getErrorLog().length===2);
t('rejection kind labeled correctly', getErrorLog()[0].kind==='unhandled promise rejection');

console.log('\n=== rate limiting: repeated identical errors do not flood activity_log ===');
ACTIVITY = [];
clearErrorLog();
for(let i=0;i<10;i++){
  window.dispatch('error', { message:'Same error every time', filename:'x.mjs', lineno:1, colno:1,
    error:{ message:'Same error every time', stack:'Error: Same error every time\\n  at foo (x.mjs:1:1)' } });
}
await new Promise(r=>setTimeout(r, 20));   // let the fire-and-forget logActivity calls settle
t('all 10 occurrences captured in the in-memory ring', getErrorLog().length===10);
t('but only ONE server-side log entry was written (deduped)', ACTIVITY.length===1);

console.log('\n=== manual reportError() capture point ===');
clearErrorLog();
try { throw new Error('caught and reported manually'); }
catch(e){ reportError('manual test', e, { context:'unit test' }); }
t('manual report captured', getErrorLog().length===1 && getErrorLog()[0].kind==='manual test');

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail?1:0);
