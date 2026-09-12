-- =====================================================================
-- Phase 15: logged engineering / purchasing errors.
--
-- Separate from `blockers` on purpose. A blocker is about now -- work is
-- stopped, get it unstuck, Open -> Resolved. An error is a fact about a
-- defect: which department made it, which stage caught it, and what it
-- cost to put right. Most errors never block anything, and the value of
-- recording them is the pattern ACROSS jobs, which a per-job blocker
-- list cannot show.
--
-- Categories are a fixed vocabulary (src/models/errorMeta.js) rather
-- than free text, because free text cannot be counted: "wrong bore",
-- "bore size wrong" and "brg bore mismatch" are three rows and one
-- problem. Validated in the app rather than by a CHECK constraint so
-- the list can grow without a migration; `department` IS constrained,
-- since the whole log is grouped by it.
-- =====================================================================

create table if not exists job_errors (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references jobs(id) on delete cascade,
  department    text not null check (department in ('engineering','purchasing','other')),
  category      text not null default 'other',
  description   text not null check (length(trim(description)) > 0),
  -- The stage the error was CAUGHT at, not the stage it was made in.
  -- This is the expensive fact: the same wrong dimension costs minutes
  -- at layout and a teardown at final assembly.
  found_at_stage text not null default 'unknown',
  rework_hours  numeric(6,2) check (rework_hours is null or rework_hours >= 0),
  caused_delay  boolean not null default false,
  scrapped      boolean not null default false,
  status        text not null default 'Open' check (status in ('Open','Corrected')),
  correction    text,
  -- Where an error did stop work, the blocker it caused. Nulled rather
  -- than cascaded if that blocker is later deleted: the error happened
  -- either way and must not disappear with it.
  blocker_id    uuid references blockers(id) on delete set null,
  reported_by   uuid references profiles(id) on delete set null,
  reported_at   timestamptz not null default now(),
  corrected_at  timestamptz,
  constraint job_errors_corrected_consistent
    check ((status = 'Corrected') = (corrected_at is not null))
);

create index if not exists job_errors_job_idx  on job_errors(job_id);
create index if not exists job_errors_dept_idx on job_errors(department, reported_at desc);
create index if not exists job_errors_open_idx on job_errors(job_id) where status <> 'Corrected';

-- Keeps corrected_at in step with status so the constraint above can't
-- be tripped by a plain status update from the app.
create or replace function stamp_error_correction()
returns trigger language plpgsql as $$
begin
  if new.status = 'Corrected' and new.corrected_at is null then
    new.corrected_at := now();
  elsif new.status <> 'Corrected' then
    new.corrected_at := null;
  end if;
  return new;
end $$;

drop trigger if exists job_errors_stamp_correction on job_errors;
create trigger job_errors_stamp_correction
  before insert or update on job_errors
  for each row execute function stamp_error_correction();

-- ---------------------------------------------------------------
-- RLS: same shape as blockers. Recording a mistake must never be
-- gated -- an error log people cannot write to is an empty one -- so
-- any active user may log one and everyone can read the whole log.
-- Editing and deleting stay with leads and admins respectively, so a
-- record cannot be quietly walked back by whoever it reflects on.
-- ---------------------------------------------------------------
alter table job_errors enable row level security;

drop policy if exists job_errors_select on job_errors;
create policy job_errors_select on job_errors
  for select to authenticated using (is_active());

drop policy if exists job_errors_insert on job_errors;
create policy job_errors_insert on job_errors
  for insert to authenticated with check (is_active());

drop policy if exists job_errors_update_lead on job_errors;
create policy job_errors_update_lead on job_errors
  for update to authenticated
  using (is_lead_or_admin()) with check (is_lead_or_admin());

drop policy if exists job_errors_delete_admin on job_errors;
create policy job_errors_delete_admin on job_errors
  for delete to authenticated using (is_admin());

-- ---------------------------------------------------------------
-- Realtime. Errors get logged from a phone on the floor while a lead
-- has the same job open at a desk, so the log has to arrive without a
-- refresh, the same as blockers do. Guarded because re-adding a table
-- already in the publication is an error, not a no-op.
-- ---------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'job_errors'
  ) then
    alter publication supabase_realtime add table job_errors;
  end if;
end $$;
