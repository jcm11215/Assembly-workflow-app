-- =====================================================================
-- Phase 2: triggers -- server-side enforcement of business rules.
-- These make the rules unbypassable regardless of client code path,
-- which is the durable fix for the checklist bypass class of bug.
-- =====================================================================

-- ---------- helper: current user's role ----------
-- SECURITY DEFINER so it can read profiles without RLS recursion.
create or replace function auth_role()
returns user_role
language sql stable security definer set search_path = public
as $$ select role from profiles where id = auth.uid() $$;

create or replace function is_admin() returns boolean
language sql stable as $$ select auth_role() = 'admin' $$;
create or replace function is_lead_or_admin() returns boolean
language sql stable as $$ select auth_role() in ('lead','admin') $$;

-- ---------- stage order + checklist mapping ----------
-- Mirrors STAGES / STAGE_PROCEDURE in src/jobs/procedure.js.
-- Keep the two in sync; this is the authoritative copy.
create or replace function stage_ordinal(s job_stage)
returns integer language sql immutable as $$
  select case s
    when 'ready' then 0 when 'layout' then 1 when 'bearings' then 2
    when 'drive' then 3 when 'final'  then 4 when 'testing'  then 5
    when 'qc'    then 6 when 'complete' then 7 end
$$;

-- Which procedure step indexes gate each stage.
create or replace function stage_steps(s job_stage)
returns smallint[] language sql immutable as $$
  select case s
    when 'ready'    then array[0,1]::smallint[]
    when 'layout'   then array[2,3]::smallint[]
    when 'bearings' then array[5]::smallint[]
    when 'drive'    then array[4]::smallint[]
    when 'final'    then array[6]::smallint[]
    else array[]::smallint[] end
$$;

-- Expected item counts per procedure step (PROCEDURE[i].items.length).
create or replace function step_item_count(step smallint)
returns integer language sql immutable as $$
  select case step
    when 0 then 5 when 1 then 5 when 2 then 5
    when 3 then 6 when 4 then 5 when 5 then 7 when 6 then 5
    else 0 end
$$;

-- ---------- ENFORCE: stage transitions ----------
-- Same rules as validateStageTransition() in src/jobs/transitions.js:
--   backward: always allowed
--   forward >1 stage: rejected
--   forward 1 stage: current stage's checklist must be complete
create or replace function enforce_stage_transition()
returns trigger language plpgsql as $$
declare
  from_ord int; to_ord int;
  steps smallint[]; expected int := 0; actual int := 0;
begin
  if new.stage = old.stage then return new; end if;

  from_ord := stage_ordinal(old.stage);
  to_ord   := stage_ordinal(new.stage);

  if to_ord < from_ord then
    return new;                                 -- corrections always allowed
  end if;

  if to_ord > from_ord + 1 then
    raise exception 'Cannot skip stages: % -> % (advance one at a time)',
      old.stage, new.stage using errcode = 'check_violation';
  end if;

  steps := stage_steps(old.stage);
  if array_length(steps,1) is null then
    return new;                                 -- sign-off stage, no checklist
  end if;

  select coalesce(sum(step_item_count(s)),0) into expected
  from unnest(steps) as s;

  select count(*) into actual
  from job_checklist c
  where c.job_id = new.id and c.done and c.step_index = any(steps);

  if actual < expected then
    raise exception 'Checklist incomplete for %: %/% items done',
      old.stage, actual, expected using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists trg_stage_transition on jobs;
create trigger trg_stage_transition
  before update of stage on jobs
  for each row execute function enforce_stage_transition();

-- ---------- ENFORCE: assemblers may only touch operational columns ----------
-- RLS cannot scope columns, so this closes that gap.
create or replace function enforce_job_column_perms()
returns trigger language plpgsql as $$
begin
  if is_lead_or_admin() then return new; end if;

  if new.job_number  is distinct from old.job_number
  or new.customer    is distinct from old.customer
  or new.description is distinct from old.description
  or new.due_date    is distinct from old.due_date
  or new.priority    is distinct from old.priority
  or new.assigned_to is distinct from old.assigned_to then
    raise exception 'Assemblers may only update stage and progress'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

drop trigger if exists trg_job_column_perms on jobs;
create trigger trg_job_column_perms
  before update on jobs
  for each row execute function enforce_job_column_perms();

-- ---------- optimistic concurrency + updated_at ----------
create or replace function bump_version()
returns trigger language plpgsql as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_jobs_version on jobs;
create trigger trg_jobs_version
  before update on jobs
  for each row execute function bump_version();

create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists trg_profiles_touch on profiles;
create trigger trg_profiles_touch before update on profiles
  for each row execute function touch_updated_at();

-- ---------- checklist attribution ----------
create or replace function stamp_checklist()
returns trigger language plpgsql as $$
begin
  if new.done and (tg_op = 'INSERT' or not old.done) then
    new.done_by := auth.uid();
    new.done_at := now();
  elsif not new.done then
    new.done_by := null; new.done_at := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_checklist_stamp on job_checklist;
create trigger trg_checklist_stamp
  before insert or update on job_checklist
  for each row execute function stamp_checklist();

-- ---------- blocker resolution attribution ----------
create or replace function stamp_blocker()
returns trigger language plpgsql as $$
begin
  if new.status = 'Resolved' and old.status <> 'Resolved' then
    new.resolved_by := auth.uid(); new.resolved_at := now();
  elsif new.status <> 'Resolved' then
    new.resolved_by := null; new.resolved_at := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_blocker_stamp on blockers;
create trigger trg_blocker_stamp before update on blockers
  for each row execute function stamp_blocker();

-- ---------- activity log: server-owned identity + time ----------
-- Actor and timestamp are overwritten server-side, so a client cannot
-- forge either. This is what makes the log evidence rather than a claim.
create or replace function stamp_activity()
returns trigger language plpgsql as $$
begin
  new.actor := auth.uid();
  new.at := now();
  new.actor_name := coalesce(
    (select full_name from profiles where id = auth.uid()),
    new.actor_name);
  return new;
end $$;

drop trigger if exists trg_activity_stamp on activity_log;
create trigger trg_activity_stamp before insert on activity_log
  for each row execute function stamp_activity();

-- ---------- auto-create profile on signup ----------
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, role)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
          coalesce((new.raw_user_meta_data->>'role')::user_role, 'assembler'))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
