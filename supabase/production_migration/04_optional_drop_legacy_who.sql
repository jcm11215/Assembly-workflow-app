-- =====================================================================
-- OPTIONAL. Run only after 01, schema.sql, migration.sql, and 03 have
-- ALL completed successfully, and you've confirmed activity_log.actor
-- and activity_log.actor_name are correctly populated going forward.
--
-- Not required -- `who` sitting unused alongside the new columns is
-- harmless. This is pure cleanup, not a correctness fix.
-- =====================================================================

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_name='activity_log' and column_name='who') then
    alter table activity_log drop column who;
    raise notice 'dropped legacy activity_log.who';
  else
    raise notice 'who already absent -- nothing to do';
  end if;
end $$;
