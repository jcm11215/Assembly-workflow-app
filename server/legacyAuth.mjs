/**
 * One-time password carry-over from the old Supabase app.
 *
 * Supabase does not hand out password hashes, so imported accounts
 * arrive without a password. While `legacyAuth` is set (the importer
 * sets it), the first sign-in on this server checks the password against
 * the old project; if it is right, it becomes this account's password
 * and the old project is never asked about that person again.
 *
 * Remove it with `node server/cli.mjs legacy-auth off` once everyone
 * has signed in once, or when the old project is shut down.
 */
export async function verifyLegacyPassword(legacy, email, password){
  if(!legacy || !legacy.url || !legacy.anonKey || !email || !password) return false;
  try {
    const res = await fetch(`${legacy.url.replace(/\/+$/, '')}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: legacy.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(10000)
    });
    return res.ok;
  } catch {
    return false;
  }
}
