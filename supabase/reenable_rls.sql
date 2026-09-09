-- =====================================================================
-- Re-enable RLS after deployment. Run this ONLY when BOTH are true:
--   1. An admin account exists (check: select * from profiles;)
--   2. The AUTH_ENABLED=true build is deployed and you can log in
--
-- All 27 policies are still in place -- they were never dropped, only
-- enforcement was paused. This just switches it back on.
-- =====================================================================
alter table profiles             enable row level security;
alter table jobs                 enable row level security;
alter table job_checklist        enable row level security;
alter table blockers             enable row level security;
alter table notes                enable row level security;
alter table blueprints           enable row level security;
alter table blueprint_components enable row level security;
alter table activity_log         enable row level security;

-- Verify: should list 8 tables, all with rowsecurity = true
select tablename, rowsecurity from pg_tables
where schemaname='public' order by tablename;
