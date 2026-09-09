-- =====================================================================
-- Phase 2: Row Level Security
-- Prereq: triggers.sql (auth_role/is_admin/is_lead_or_admin helpers).
-- APPLY LAST. Verify against all three roles on a branch DB first --
-- a wrong policy locks the shop floor out.
-- =====================================================================

alter table profiles             enable row level security;
alter table jobs                 enable row level security;
alter table job_checklist        enable row level security;
alter table blockers             enable row level security;
alter table notes                enable row level security;
alter table blueprints           enable row level security;
alter table blueprint_components enable row level security;
alter table activity_log         enable row level security;

-- =====================  profiles  =====================
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles
  for select to authenticated using (true);          -- everyone sees the roster

drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- NOTE: role escalation is blocked by profiles_no_self_promote below.

drop policy if exists profiles_admin_all on profiles;
create policy profiles_admin_all on profiles
  for all to authenticated using (is_admin()) with check (is_admin());

-- A user may edit their own row but NOT their own role.
create or replace function block_self_promote()
returns trigger language plpgsql as $$
begin
  if new.role is distinct from old.role and not is_admin() then
    raise exception 'Only an admin may change roles'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
drop trigger if exists trg_no_self_promote on profiles;
create trigger trg_no_self_promote before update on profiles
  for each row execute function block_self_promote();

-- =====================  jobs  =====================
drop policy if exists jobs_select on jobs;
create policy jobs_select on jobs
  for select to authenticated using (true);          -- whole shop is visible

drop policy if exists jobs_update_assigned on jobs;
create policy jobs_update_assigned on jobs
  for update to authenticated
  using (
    is_lead_or_admin()
    or (auth_role() = 'assembler' and assigned_to = auth.uid())
  )
  with check (
    is_lead_or_admin()
    or (auth_role() = 'assembler' and assigned_to = auth.uid())
  );
-- Column scope for assemblers is enforced by trg_job_column_perms.
-- Stage legality is enforced by trg_stage_transition.

drop policy if exists jobs_insert_lead on jobs;
create policy jobs_insert_lead on jobs
  for insert to authenticated with check (is_lead_or_admin());

drop policy if exists jobs_delete_admin on jobs;
create policy jobs_delete_admin on jobs
  for delete to authenticated using (is_admin());

-- =====================  job_checklist  =====================
drop policy if exists checklist_select on job_checklist;
create policy checklist_select on job_checklist
  for select to authenticated using (true);

drop policy if exists checklist_write on job_checklist;
create policy checklist_write on job_checklist
  for insert to authenticated
  with check (
    is_lead_or_admin()
    or exists (select 1 from jobs j
               where j.id = job_id and j.assigned_to = auth.uid())
  );

drop policy if exists checklist_update on job_checklist;
create policy checklist_update on job_checklist
  for update to authenticated
  using (
    is_lead_or_admin()
    or exists (select 1 from jobs j
               where j.id = job_id and j.assigned_to = auth.uid())
  )
  with check (
    is_lead_or_admin()
    or exists (select 1 from jobs j
               where j.id = job_id and j.assigned_to = auth.uid())
  );

drop policy if exists checklist_delete_admin on job_checklist;
create policy checklist_delete_admin on job_checklist
  for delete to authenticated using (is_admin());

-- =====================  blockers  =====================
drop policy if exists blockers_select on blockers;
create policy blockers_select on blockers
  for select to authenticated using (true);

-- Anyone on the floor may raise a blocker -- surfacing problems must
-- never be gated.
drop policy if exists blockers_insert on blockers;
create policy blockers_insert on blockers
  for insert to authenticated with check (true);

drop policy if exists blockers_update_lead on blockers;
create policy blockers_update_lead on blockers
  for update to authenticated
  using (is_lead_or_admin()) with check (is_lead_or_admin());

drop policy if exists blockers_delete_admin on blockers;
create policy blockers_delete_admin on blockers
  for delete to authenticated using (is_admin());

-- =====================  notes  =====================
drop policy if exists notes_select on notes;
create policy notes_select on notes
  for select to authenticated using (true);

drop policy if exists notes_insert on notes;
create policy notes_insert on notes
  for insert to authenticated with check (author = auth.uid() or is_lead_or_admin());

-- Authors get a 15-minute correction window; leads may always edit.
drop policy if exists notes_update on notes;
create policy notes_update on notes
  for update to authenticated
  using (
    is_lead_or_admin()
    or (author = auth.uid() and created_at > now() - interval '15 minutes')
  )
  with check (
    is_lead_or_admin()
    or (author = auth.uid() and created_at > now() - interval '15 minutes')
  );

drop policy if exists notes_delete_lead on notes;
create policy notes_delete_lead on notes
  for delete to authenticated using (is_lead_or_admin());

-- =====================  blueprints  =====================
drop policy if exists blueprints_select on blueprints;
create policy blueprints_select on blueprints
  for select to authenticated using (true);

drop policy if exists blueprints_insert on blueprints;
create policy blueprints_insert on blueprints
  for insert to authenticated with check (is_lead_or_admin());

-- Only leads/admins approve an extraction -- engineering data reaching
-- the floor is a human decision, not an AI one.
drop policy if exists blueprints_update_lead on blueprints;
create policy blueprints_update_lead on blueprints
  for update to authenticated
  using (is_lead_or_admin()) with check (is_lead_or_admin());

drop policy if exists blueprints_delete_admin on blueprints;
create policy blueprints_delete_admin on blueprints
  for delete to authenticated using (is_admin());

-- =====================  blueprint_components  =====================
drop policy if exists bpc_select on blueprint_components;
create policy bpc_select on blueprint_components
  for select to authenticated using (true);

drop policy if exists bpc_write_lead on blueprint_components;
create policy bpc_write_lead on blueprint_components
  for all to authenticated
  using (is_lead_or_admin()) with check (is_lead_or_admin());

-- =====================  activity_log  =====================
-- Insert-only for everyone. Deliberately NO update or delete policy for
-- any role, including admin: an audit trail that can be edited is not an
-- audit trail. Corrections are new rows.
drop policy if exists activity_insert on activity_log;
create policy activity_insert on activity_log
  for insert to authenticated with check (true);   -- actor forced by trigger

drop policy if exists activity_select_own on activity_log;
create policy activity_select_own on activity_log
  for select to authenticated
  using (is_lead_or_admin() or actor = auth.uid());

-- =====================  role verification harness  =====================
-- Run as each role on a branch DB before applying to production.
--
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<assembler-uuid>"}';
--   select count(*) from jobs;                          -- expect: all
--   update jobs set priority='High' where id='<any>';   -- expect: FAIL
--   update jobs set stage='layout' where assigned_to <> auth.uid();
--                                                       -- expect: 0 rows
--   delete from activity_log where id = 1;              -- expect: 0 rows
