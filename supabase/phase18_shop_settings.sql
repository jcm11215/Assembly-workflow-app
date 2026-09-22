-- =====================================================================
-- Shop-wide settings: set once by an admin, read by every signed-in
-- device, so nobody has to type the local server's address into each
-- phone and tablet. Keys in use (src/db/shopSettings.js):
--   local_server_url     the desktop's https .ts.net address
--   default_ai_provider  'gemini' | 'openrouter' | 'local'
--   blueprint_storage    'supabase' | 'local'
--
-- Not for secrets -- every signed-in user can read every row.
-- Already applied directly to Production (ljxwmjahmmrchmomkjqj); kept
-- here as the record. Idempotent: safe to re-run.
-- =====================================================================
create table if not exists shop_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);

alter table shop_settings enable row level security;

drop policy if exists shop_settings_read on shop_settings;
create policy shop_settings_read on shop_settings
  for select to authenticated using (true);

drop policy if exists shop_settings_admin on shop_settings;
create policy shop_settings_admin on shop_settings
  for all to authenticated using (is_admin()) with check (is_admin());
