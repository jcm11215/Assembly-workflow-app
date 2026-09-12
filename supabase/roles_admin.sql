-- =====================================================================
-- Assembler tiers + admin screen support.
--
-- Run AFTER schema.sql / triggers.sql / rls.sql / signup.sql.
-- Idempotent: safe to re-run.
--
-- MUST be run as two separate statements batches, in this order:
--   PART 1 adds the enum values.
--   PART 2 uses them.
-- Postgres refuses to use an enum value that was added in the same
-- transaction, so running the whole file inside one transaction fails.
-- =====================================================================

-- =====================  PART 1  =====================
-- Two tiers of assembler:
--   assembler_a  experienced -- full assembly work, including sign-off
--   assembler_b  trainee     -- same work, but may not sign a job into
--                               QC or Complete
-- 'assembler' and 'lead' stay in the type: 'assembler' so existing rows
-- remain valid until backfilled, 'lead' because policies still name it
-- (the owner is admin, so nobody is assigned lead today).
alter type user_role add value if not exists 'assembler_a';
alter type user_role add value if not exists 'assembler_b';

-- =====================  PART 2  =====================

-- Anyone still on the old flat role becomes experienced, not a trainee:
-- silently downgrading someone's permissions is the worse failure.
update profiles set role = 'assembler_a' where role = 'assembler';

alter table profiles alter column role set default 'assembler_b';

-- ---------- role helpers ----------
create or replace function is_assembler() returns boolean
language sql stable as $$
  select auth_role() in ('assembler','assembler_a','assembler_b')
$$;

-- A trainee may not put a job into a sign-off stage.
create or replace function can_sign_off() returns boolean
language sql stable as $$ select coalesce(auth_role() <> 'assembler_b', false) $$;

-- Pinned so a search_path swap in the calling session can't redirect
-- these onto a look-alike function in another schema.
alter function is_assembler() set search_path = public;
alter function can_sign_off() set search_path = public;

revoke execute on function is_assembler() from public, anon;
revoke execute on function can_sign_off() from public, anon;
grant execute on function is_assembler() to authenticated;
grant execute on function can_sign_off() to authenticated;

-- ---------- jobs: both tiers count as assemblers ----------
-- Unchanged in intent from rls.sql; widened from the single 'assembler'
-- literal to every assembler tier.
drop policy if exists jobs_update_assigned on jobs;
create policy jobs_update_assigned on jobs
  for update to authenticated
  using (
    is_lead_or_admin()
    or (is_assembler() and assigned_to = auth.uid())
  )
  with check (
    is_lead_or_admin()
    or (is_assembler() and assigned_to = auth.uid())
  );

-- ---------- ENFORCE: trainees cannot sign off ----------
-- Mirrors validateStageTransition() in src/jobs/transitions.js. Server
-- side is the one that counts: the client rule is only there to explain
-- the refusal before the round trip.
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

  if new.stage in ('qc','complete') and not can_sign_off() then
    raise exception 'Trainees (Assembler B) cannot move a job into %. Ask an experienced assembler or the lead.',
      new.stage using errcode = 'insufficient_privilege';
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

alter function enforce_stage_transition() set search_path = public;

-- ---------- new accounts start as trainees ----------
-- Replaces signup.sql's version. Same hardening: the role is never read
-- from raw_user_meta_data, which the browser controls. The owner's
-- address is still seeded admin at INSERT time.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, role)
  values (new.id,
          coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
                   split_part(new.email, '@', 1)),
          case when lower(new.email) = 'justinmckinney@iscmfg.com'
               then 'admin'::user_role
               else 'assembler_b'::user_role end)
  on conflict (id) do nothing;
  return new;
end $$;

-- ---------- signup_codes: readable and manageable by admins ----------
-- Was RLS-on-with-no-policies, i.e. service-role only. The admin screen
-- needs to show and rotate the code; everyone else still sees nothing,
-- and the create-account Edge Function keeps using the service role.
drop policy if exists signup_codes_admin on signup_codes;
create policy signup_codes_admin on signup_codes
  for all to authenticated using (is_admin()) with check (is_admin());
