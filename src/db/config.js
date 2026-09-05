/**
 * Supabase connection. The anon/publishable key is intentionally public --
 * access control lives in database policies, not in hiding this value.
<<<<<<< HEAD
 * Points at the "Assembly Workflow Production" project.
 */

export const SUPABASE_URL = 'https://ljxwmjahmmrchmomkjqj.supabase.co';

export const SUPABASE_ANON_KEY = 'sb_publishable_TiPFbIBMRpLblE7RXfzSSg_-FH4ZMr4';
=======
 */

//    project's values (Project Settings -> API).
export const SUPABASE_URL = 'https://cxzogbtjxcfzgybtquwd.supabase.co';

export const SUPABASE_ANON_KEY = 'sb_publishable_kSu43otuTKZTtjeLPmuT3g_Kop5RzGz';
>>>>>>> db48dc20230f1294f6d23dbafbfaa176e2b7be0c

export function supabaseReady(){
  return !!(SUPABASE_URL && SUPABASE_URL !== 'SUPABASE_URL_HERE' && SUPABASE_ANON_KEY && SUPABASE_ANON_KEY !== 'SUPABASE_ANON_KEY_HERE');
}

export function supabaseHeaders(extra){
  return {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    ...(extra||{})
  };
}
