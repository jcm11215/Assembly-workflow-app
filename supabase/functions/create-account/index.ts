/**
 * create-account -- the only way a new account gets made.
 *
 * GoTrue's own /signup is disabled on this project. The app is served
 * from a public URL, so an open signup endpoint would let anyone who
 * found the link read the whole shop's job data. This function checks a
 * shop access code first, and creates the user with the service role so
 * the browser never holds a key that could do this on its own.
 *
 * Runs with verify_jwt off, because by definition the caller has no
 * account yet. The access code IS the authentication here.
 */
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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

async function codeIsValid(code: string){
  const url = `${SUPABASE_URL}/rest/v1/signup_codes`
    + `?select=code&active=is.true&code=eq.${encodeURIComponent(code)}`;
  const res = await fetch(url, { headers: serviceHeaders() });
  if(!res.ok) return false;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
}

Deno.serve(async (req) => {
  if(req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if(req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: Record<string, string>;
  try { body = await req.json(); }
  catch { return json({ error: 'Malformed request.' }, 400); }

  const fullName = String(body.full_name ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const accessCode = String(body.access_code ?? '').trim();

  if(!fullName) return json({ error: 'Enter your name.' }, 400);
  if(!EMAIL_RE.test(email)) return json({ error: 'That username or email is not valid.' }, 400);
  if(password.length < MIN_PASSWORD){
    return json({ error: `Password must be at least ${MIN_PASSWORD} characters.` }, 400);
  }

  // Deliberately the same vague message for a wrong code as for a missing
  // one: this endpoint is public, so it should not help anyone probe it.
  if(!accessCode || !(await codeIsValid(accessCode))){
    return json({ error: 'That shop access code is not valid. Check with your supervisor.' }, 403);
  }

  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,             // no inbox to confirm from for username accounts
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
    return json({ error: 'Could not create the account. Try again, or ask a supervisor.' }, 500);
  }

  // The role is NOT taken from this response or the request: the
  // handle_new_user trigger has already created the profile as an
  // 'assembler', and only an admin can change that afterward.
  return json({ ok: true, id: data.id });
});
