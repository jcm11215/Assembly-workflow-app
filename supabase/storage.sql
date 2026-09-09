-- =====================================================================
-- Phase 3: Storage bucket for blueprint images
-- Run after schema.sql. Images no longer live in the database.
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('blueprints', 'blueprints', false)
on conflict (id) do nothing;

-- Private bucket: reads go through an authenticated request, so a
-- blueprint URL alone is not enough to view shop drawings.
drop policy if exists blueprints_read on storage.objects;
create policy blueprints_read on storage.objects
  for select to authenticated
  using (bucket_id = 'blueprints');

drop policy if exists blueprints_write on storage.objects;
create policy blueprints_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'blueprints' and is_lead_or_admin());

drop policy if exists blueprints_update on storage.objects;
create policy blueprints_update on storage.objects
  for update to authenticated
  using (bucket_id = 'blueprints' and is_lead_or_admin());

drop policy if exists blueprints_delete on storage.objects;
create policy blueprints_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'blueprints' and is_admin());
