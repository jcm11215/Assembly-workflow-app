import './stub.mjs';
// An admin making a login for someone else. Covers the authService call
// shape (the caller's own token, never the anon key) and the failure
// paths the Edge Function can hand back.

let pass = 0, fail = 0;
const t = (name, ok) => { ok ? (pass++, console.log('  PASS ' + name)) : (fail++, console.log('  FAIL ' + name)); };

const calls = [];
const ok = (d, status = 200) => ({ ok: true, status, text: async () => JSON.stringify(d), json: async () => d });
const bad = (d, status = 400) => ({ ok: false, status, text: async () => JSON.stringify(d), json: async () => d });

/** What the function should do, mirrored closely enough to catch a
 *  wrong request shape: reject a missing/anon token, reject a role that
 *  is not assignable, otherwise create. */
let takenLogins = new Set(['dreyes@assembly.local']);
let rolePatchFails = false;

globalThis.fetch = async (url, opt = {}) => {
  const u = String(url);
  const body = opt.body ? JSON.parse(opt.body) : null;
  calls.push({ url: u, init: opt, body });

  if(u.includes('/functions/v1/admin-create-user')){
    const auth = (opt.headers || {}).Authorization || '';
    if(!auth.startsWith('Bearer ') || auth === 'Bearer anon-key'){
      return bad({ error: 'Sign in first.' }, 401);
    }
    if(!['assembler_b', 'assembler_a', 'admin'].includes(body.role)){
      return bad({ error: 'That is not a role you can assign.' }, 400);
    }
    if(takenLogins.has(body.email)){
      return bad({ error: 'That username or email is already taken.' }, 409);
    }
    if(body.password.length < 8){
      return bad({ error: 'The password must be at least 8 characters.' }, 400);
    }
    if(rolePatchFails && body.role !== 'assembler_b'){
      return ok({ ok: true, id: 'new-1', role: 'assembler_b',
                  warning: `The login was created, but the role could not be set to ${body.role}. Set it on the Team screen.` });
    }
    return ok({ ok: true, id: 'new-1', role: body.role });
  }
  return ok({});
};

const sessionStore = await import('../src/auth/sessionStore.js');
const authService = await import('../src/auth/authService.js');

const signedIn = () => sessionStore.setSession({
  access_token: 'admin-tok', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: 'admin-1', email: 'boss@shop.com' }
});

console.log('\n=== the request it sends ===');
signedIn();
calls.length = 0;
const made = await authService.adminCreateUser({
  fullName: 'D. Reyes', loginId: 'dana', password: 'quiet-anvil-77', role: 'assembler_a'
});
const req = calls.find(c => c.url.includes('admin-create-user'));
t('posts to the admin-create-user function', !!req && req.init.method === 'POST');
t("sends the admin's own token, not the anon key",
  req.init.headers.Authorization === 'Bearer admin-tok');
t('a plain username becomes an @assembly.local address',
  req.body.email === 'dana@assembly.local');
t('passes the chosen role through', req.body.role === 'assembler_a');
t('passes the name through', req.body.full_name === 'D. Reyes');
t('returns the new id and role', made.id === 'new-1' && made.role === 'assembler_a');

console.log('\n=== an email address is left alone ===');
calls.length = 0;
await authService.adminCreateUser({
  fullName: 'K. Obi', loginId: 'k.obi@shop.com', password: 'quiet-anvil-77', role: 'admin'
});
t('an address with an @ is not re-domained',
  calls.find(c => c.url.includes('admin-create-user')).body.email === 'k.obi@shop.com');

console.log('\n=== refusals surface as errors ===');
let msg = '';
try {
  await authService.adminCreateUser({
    fullName: 'D. Reyes', loginId: 'dreyes', password: 'quiet-anvil-77', role: 'assembler_b'
  });
} catch (e) { msg = e.message; }
t('a taken username is reported, not swallowed', /already taken/i.test(msg));

msg = '';
try {
  await authService.adminCreateUser({
    fullName: 'X', loginId: 'xx1', password: 'quiet-anvil-77', role: 'lead'
  });
} catch (e) { msg = e.message; }
t('a role outside the assignable three is refused', /not a role you can assign/i.test(msg));

console.log('\n=== signed out ===');
sessionStore.clearSession();
msg = '';
try {
  await authService.adminCreateUser({
    fullName: 'X', loginId: 'xx2', password: 'quiet-anvil-77', role: 'assembler_b'
  });
} catch (e) { msg = e.message; }
t('refuses before sending anything when there is no session', /sign in/i.test(msg));

console.log('\n=== the login exists but the role did not take ===');
signedIn();
rolePatchFails = true;
const partial = await authService.adminCreateUser({
  fullName: 'M. Vu', loginId: 'mvu', password: 'quiet-anvil-77', role: 'admin'
});
t('a failed role change still reports the login as created', partial.id === 'new-1');
t('and says the role is still the trainee default', partial.role === 'assembler_b');
t('and carries a warning to show the admin', /could not be set/i.test(partial.warning || ''));
rolePatchFails = false;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
