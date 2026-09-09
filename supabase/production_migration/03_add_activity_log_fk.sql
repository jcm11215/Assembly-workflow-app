-- =====================================================================
-- Step 3 of 3. Run AFTER schema.sql has successfully created `profiles`.
--
-- schema.sql's inline `actor uuid references profiles(id) on delete
-- set null` is part of the CREATE TABLE statement -- since that whole
-- statement was skipped (table already existed), the foreign key
-- constraint was never applied by schema.sql itself. This adds it
-- explicitly now that profiles is guaranteed to exist.
--
-- Idempotent: checks for the constraint before adding it.
-- =====================================================================

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'profiles does not exist yet -- run schema.sql (step 2) first.';
  end if;

  if not exists (
    select 1 from information_schema.table_constraints
    where table_name = 'activity_log'
      and constraint_type = 'FOREIGN KEY'
      and constraint_name = 'activity_log_actor_fkey'
  ) then
    -- Any existing actor values that don't match a real profiles.id
    -- would make this ALTER fail -- null them out first (they were
    -- backfilled from legacy `who` text in step 1 and were never real
    -- uuids to begin with, so this is expected and safe).
    update activity_log
    set actor = null
    where actor is not null
      and not exists (select 1 from profiles p where p.id = activity_log.actor);

    alter table activity_log
      add constraint activity_log_actor_fkey
      foreign key (actor) references profiles(id) on delete set null;

    raise notice 'added FK activity_log.actor -> profiles(id)';
  else
    raise notice 'FK already present -- nothing to do';
  end if;
end $$;

select 'activity_log fully reconciled with schema.sql' as status;
