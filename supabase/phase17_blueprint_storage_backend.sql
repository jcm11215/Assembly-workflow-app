-- =====================================================================
-- Records which backend actually holds a blueprint's original file --
-- Supabase Storage (the default, unchanged) or a folder on the shop's
-- own server (new: local file storage, src/db/localFileStore.js).
-- storage_path alone is ambiguous once a second backend exists, since
-- both use it as a relative path.
--
-- Already applied directly to Production (ljxwmjahmmrchmomkjqj); kept
-- here, like the other phaseN files, as the record of what ran.
-- Idempotent: safe to re-run.
-- =====================================================================

alter table blueprints
  add column if not exists storage_backend text not null default 'supabase';

alter table blueprints
  drop constraint if exists blueprints_storage_backend_check;
alter table blueprints
  add constraint blueprints_storage_backend_check
  check (storage_backend in ('supabase', 'local'));
