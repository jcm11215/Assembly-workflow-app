/**
 * admin-create-user -- an admin makes a login for someone else.
 *
 * The other way in is create-account, where the shop access code is the
 * authentication because the caller has no account yet. Here the caller
 * is a signed-in admin, so the code plays no part: the caller's own JWT
 * is the authentication, and it is checked against profiles before
 * anything is created.
 *
 * Why the role is set in a second request, as the caller:
 *   handle_new_user makes every profile an 'assembler_b'; it ignores
 *   raw_user_meta_data on purpose, since the browser controls that and
 *   reading a role from it would be a privilege escalation. So a new
 *   account starts as a trainee whatever was asked for. Rather than give
 *   this function a service-role back door around block_self_promote,
 *   the role change is sent with the ADMIN'S OWN token, through normal
 *   PostgREST. The database applies profiles_admin_all and
 *   trg_no_self_promote to it exactly as it would to the Team screen.
 *   A non-admin who reached this function still could not change a role.
 *
 * Runs with verify_jwt off -- matching create-account, so a CORS
 * preflight is never rejected by the platform before it reaches the
 * handler -- and verifies the caller here instead. An unauthenticated
 * request gets no further than the two checks at the top.
 */
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** The same three the Team screen offers. 'assembler' and 'lead' are
 *  deliberately absent: both are legacy, and neither should be handed to
 *  a new account. */
const ASSIGNABLE_ROLES = ['assembler_b', 'assembler_a', 'admin'];

/** What handle_new_user creates. Asking for this needs no second request. */
const DEFAULT_ROLE = 'assembler_b';

function json(body: unknown, status = 200){
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}

function serviceHeaders(){
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  };
}

/**
 * The caller's id, or null. Asks GoTrue rather than decoding the JWT
 * here: a signature this function does not verify is not a fact.
 */
async function callerId(token: string){
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` }
  });
  if(!res.ok) return null;
  const user = await res.json().catch(() => null);
  return user && user.id ? String(user.id) : null;
}

/** An admin whose account is still active. Read with the service role so
 *  the answer does not itself depend on the caller's RLS view. */
async function isActiveAdmin(userId: string){
  const url = `${SUPABASE_URL}/rest/v1/profiles`
    + `?select=role,active&id=eq.${encodeURIComponent(userId)}`;
  const res = await fetch(url, { headers: serviceHeaders() });
  if(!res.ok) return false;
  const rows = await res.json().catch(() => []);
  const row = Array.isArray(rows) ? rows[0] : null;
  return !!row && row.role === 'admin' && row.active === true;
}

Deno.serve(async (req) => {
  if(req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if(req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // ---------- who is asking ----------
  const auth = req.headers.get('Authorization') || '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  // The anon key is a valid JWT but identifies nobody; without this it
  // would sail through to callerId() and simply fail there. Named here so
  // the reason is obvious.
  if(!token || token === ANON_KEY) return json({ error: 'Sign in first.' }, 401);

  const uid = await callerId(token);
  if(!uid) return json({ error: 'Your session has expired. Sign in again.' }, 401);

  if(!(await isActiveAdmin(uid))){
    return json({ error: 'Only an admin can create logins.' }, 403);
  }

  // ---------- what they asked for ----------
  let body: Record<string, string>;
  try { body = await req.json(); }
  catch { return json({ error: 'Malformed request.' }, 400); }

  const fullName = String(body.full_name ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const role = String(body.role ?? DEFAULT_ROLE).trim();

  if(!fullName) return json({ error: 'Enter their name.' }, 400);
  if(!EMAIL_RE.test(email)) return json({ error: 'That username or email is not valid.' }, 400);
  if(password.length < MIN_PASSWORD){
    return json({ error: `The password must be at least ${MIN_PASSWORD} characters.` }, 400);
  }
  if(!ASSIGNABLE_ROLES.includes(role)){
    return json({ error: 'That is not a role you can assign.' }, 400);
  }

  // ---------- create ----------
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,             // @assembly.local has no inbox to confirm from
      user_metadata: { full_name: fullName }
    })
  });

  const data = await res.json().catch(() => ({}));
  if(!res.ok){
    const msg = String(data.msg ?? data.error_description ?? data.error ?? '');
    if(res.status === 422 || /already/i.test(msg)){
      return json({ error: 'That username or email is already taken.' }, 409);
    }
    console.error('admin createUser failed', res.status, msg);
    return json({ error: 'Could not create the account. Try again.' }, 500);
  }

  const newId = String(data.id);

  // ---------- the role, as the admin ----------
  // Anything other than the trainee default needs a second request, sent
  // with the caller's token so the database's own guards decide it.
  if(role === DEFAULT_ROLE) return json({ ok: true, id: newId, role });

  const patch = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(newId)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify({ role })
    }
  );

  if(!patch.ok){
    // The login exists and works -- it is just still a trainee. Say so
    // precisely rather than failing the whole call, because deleting the
    // account to make this atomic would be the worse outcome: the admin
    // would have no idea whether the name was now taken.
    const detail = await patch.text().catch(() => '');
    console.error('role assignment failed', patch.status, detail);
    return json({
      ok: true,
      id: newId,
      role: DEFAULT_ROLE,
      warning: `The login was created, but the role could not be set to ${role}. `
             + 'Set it on the Team screen.'
    });
  }

  return json({ ok: true, id: newId, role });
});
