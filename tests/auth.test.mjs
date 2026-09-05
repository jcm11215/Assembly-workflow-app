import './stub.mjs';
// Standalone Node test -- run with: node --input-type=module tests/auth.test.mjs
// (relative import paths assume this file sits at tests/auth.test.mjs and
// src/ modules are still .js; if run directly from repo root, first convert
// via the same .js->.mjs shim used in CI, or run through a bundler-less
// ESM test runner such as `node --test`.)

// ---- mock GoTrue + PostgREST ----
let PROFILES=[];
const NOW=Math.floor(Date.now()/1000);
globalThis.fetch=async(url,opt={})=>{
  const u=String(url); const m=opt.method||'GET';
  const body=opt.body?JSON.parse(opt.body):null;
  const ok=(d,status=200)=>({ok:true,status,text:async()=>JSON.stringify(d),json:async()=>d});
  const fail=(d,status=400)=>({ok:false,status,text:async()=>JSON.stringify(d),json:async()=>d});

  if(u.includes('/auth/v1/token?grant_type=password')){
    if(body.password!=='correct') return fail({error_description:'Invalid login credentials'},400);
    return ok({access_token:'tok-1',refresh_token:'ref-1',expires_in:3600,
               user:{id:'u1',email:body.email,user_metadata:{}}});
  }
  if(u.includes('/auth/v1/token?grant_type=refresh_token')){
    if(body.refresh_token!=='ref-1') return fail({error_description:'Invalid refresh token'},401);
    return ok({access_token:'tok-2',refresh_token:'ref-2',expires_in:3600,user:{id:'u1',email:'lead@shop.com'}});
  }
  if(u.includes('/auth/v1/logout')) return ok({},204);
  if(u.includes('/auth/v1/recover')) return ok({});

  if(u.includes('/rest/v1/profiles')){
    if(m==='GET'){
      const idMatch=u.match(/id=eq\.([\w-]+)/);
      const rows=idMatch?PROFILES.filter(p=>p.id===idMatch[1]):PROFILES;
      return ok(rows);
    }
    if(m==='POST'){
      const rows=Array.isArray(body)?body:[body];
      for(const r of rows){
        if(PROFILES.some(p=>p.id===r.id)) return fail({message:'duplicate key',code:'23505'},409);
        PROFILES.push(r);
      }
      return ok(rows);
    }
  }
  return ok([]);
};

const authService = await import('./src/auth/authService.mjs');
const sessionStore = await import('./src/auth/sessionStore.mjs');
const profileService = await import('./src/auth/profileService.mjs');
const permissions = await import('./src/auth/permissions.mjs');

let pass=0,fail=0; const t=(n,c)=>{c?(pass++,console.log('  PASS '+n)):(fail++,console.log('  FAIL '+n));};

console.log('=== login ===');
try{
  await authService.signIn('wrong@shop.com','bad');
  t('rejects bad credentials', false);
}catch(e){ t('rejects bad credentials', /Invalid/.test(e.message)); }

const session = await authService.signIn('lead@shop.com','correct');
t('sign-in returns a session', !!session && session.access_token==='tok-1');
t('session persisted to storage', sessionStore.getSession()?.access_token==='tok-1');
t('currentActorId returns auth.uid()', authService.currentActorId()==='u1');

console.log('\n=== profile creation ===');
t('profile auto-created on first sign-in', PROFILES.some(p=>p.id==='u1'));
t('default role is assembler', PROFILES.find(p=>p.id==='u1').role==='assembler');
t('cached profile populated', profileService.getCachedProfile()?.id==='u1');

console.log('\n=== role lookup + permission helpers ===');
t('currentRole reads cached profile', permissions.currentRole()==='assembler');
t('isAssembler true', permissions.isAssembler()===true);
t('canAssignJobs false for assembler', permissions.canAssignJobs()===false);
t('canMoveStages true for any signed-in role', permissions.canMoveStages()===true);
t('canManageUsers false for assembler', permissions.canManageUsers()===false);

// promote to admin and re-check
PROFILES.find(p=>p.id==='u1').role='admin';
await profileService.ensureProfile({id:'u1',email:'lead@shop.com'});
t('permissions follow role after promotion', permissions.canManageUsers()===true);
t('canApproveBlueprints true for admin', permissions.canApproveBlueprints()===true);

console.log('\n=== logout ===');
await authService.signOut();
t('session cleared', sessionStore.getSession()===null);
t('profile cache cleared', profileService.getCachedProfile()===null);
t('currentActorId null after sign-out', authService.currentActorId()===null);

console.log('\n=== session persistence / restore ===');
await authService.signIn('lead@shop.com','correct');
const before = sessionStore.getSession();
// Simulate a fresh page load: session lives in localStorage, nothing else does.
const restored = await authService.restoreSession();
t('restoreSession returns the still-valid session', restored?.access_token===before.access_token);

console.log('\n=== refresh on expiry ===');
sessionStore.setSession({...sessionStore.getSession(), expires_at: NOW - 10}); // force expired
const refreshed = await authService.restoreSession();
t('expired session is refreshed, not rejected', refreshed?.access_token==='tok-2');
t('refresh token rotated', sessionStore.getSession()?.refresh_token==='ref-2');

console.log('\n=== dead refresh token forces clean logout, not a loop ===');
sessionStore.setSession({...sessionStore.getSession(), refresh_token:'garbage', expires_at: NOW-10});
const failedRestore = await authService.restoreSession();
t('restoreSession returns null on dead refresh token', failedRestore===null);
t('session cleared rather than left corrupt', sessionStore.getSession()===null);

console.log('\n=== password reset ===');
let resetOk=false;
try{ resetOk = await authService.requestPasswordReset('lead@shop.com'); }catch(e){}
t('password reset request succeeds', resetOk===true);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail?1:0);
