-- =====================================================================
-- Step 1 of 3. Brings the EXISTING legacy activity_log(id, at, who,
-- action, detail) up to the column shape schema.sql expects, WITHOUT
-- touching app_data and WITHOUT dropping `who` (migration.sql's
-- legacy_actors step still reads it -- see comment near the bottom).
--
-- Idempotent: every ALTER is guarded, safe to re-run if interrupted.
-- No foreign key to profiles(id) is added here, deliberately --
-- profiles doesn't exist yet in this database. That constraint is
-- added in step 03, after schema.sql has created profiles.
-- =====================================================================

do $$
begin
  if to_regclass('public.activity_log') is null then
    raise exception 'activity_log does not exist -- this script assumes the legacy table is present. Run schema.sql directly instead.';
  end if;

  -- actor: plain uuid for now, no FK yet (see 03).
  if not exists (select 1 from information_schema.columns
                 where table_name='activity_log' and column_name='actor') then
    alter table activity_log add column actor uuid;
    raise notice 'added activity_log.actor';
  end if;

  if not exists (select 1 from information_schema.columns
                 where table_name='activity_log' and column_name='actor_name') then
    alter table activity_log add column actor_name text;
    raise notice 'added activity_log.actor_name';
  end if;

  if not exists (select 1 from information_schema.columns
                 where table_name='activity_log' and column_name='entity_type') then
    alter table activity_log add column entity_type text;
    raise notice 'added activity_log.entity_type';
  end if;

  if not exists (select 1 from information_schema.columns
                 where table_name='activity_log' and column_name='entity_id') then
    alter table activity_log add column entity_id uuid;
    raise notice 'added activity_log.entity_id';
  end if;

  -- Backfill actor_name from the legacy free-text `who` column. Only
  -- fills rows that don't already have one -- safe to re-run, and
  -- won't overwrite anything a later real migration already set.
  if exists (select 1 from information_schema.columns
             where table_name='activity_log' and column_name='who') then
    update activity_log
    set actor_name = who
    where actor_name is null and who is not null;
    raise notice 'backfilled actor_name from who';
  end if;

  -- detail: schema.sql wants `not null default '{}'::jsonb`. Backfill
  -- any nulls before adding the constraint, or the ALTER below fails.
  update activity_log set detail = '{}'::jsonb where detail is null;
  begin
    alter table activity_log alter column detail set default '{}'::jsonb;
    alter table activity_log alter column detail set not null;
  exception when others then
    raise notice 'Could not enforce detail NOT NULL -- check for remaining nulls: %', sqlerrm;
  end;

  -- action: schema.sql wants `not null`. Guard against any legacy nulls.
  update activity_log set action = 'unknown (legacy row)' where action is null;
  begin
    alter table activity_log alter column action set not null;
  exception when others then
    raise notice 'Could not enforce action NOT NULL: %', sqlerrm;
  end;

end $$;

-- NOTE: `who` is intentionally NOT dropped here. migration.sql's
-- legacy_actors backfill (Phase 2/8) reads `who` directly to build
-- placeholder profiles for historical log entries. Drop it only after
-- migration.sql has run successfully and you've confirmed you don't
-- need it -- see 04_optional_drop_legacy_who.sql.

select 'activity_log reconciled -- now safe to run schema.sql' as status;
