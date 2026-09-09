-- =====================================================================
-- Run after 05_fix_blueprints_migration_insert.sql. All three queries
-- must return zero rows / TRUE before continuing to triggers.sql/rls.sql.
-- =====================================================================

-- 1. No invalid rows remain (approved/rejected without a review timestamp).
--    Must return 0 rows.
select id, job_id, status, reviewed_by, reviewed_at
from blueprints
where status in ('approved','rejected') and reviewed_at is null;

-- 2. Constraint itself is satisfiable -- re-affirm it's actually attached
--    and enforced (catches the case where it was dropped or never
--    applied due to an earlier partial run).
select conname, convalidated
from pg_constraint
where conrelid = 'blueprints'::regclass
  and conname = 'blueprints_reviewed_consistent';
--    Expect one row, convalidated = true. If convalidated is false,
--    the constraint exists but Postgres hasn't confirmed all existing
--    rows satisfy it -- run: alter table blueprints validate constraint
--    blueprints_reviewed_consistent;

-- 3. Row counts, so you can confirm the migration actually inserted
--    the data you expect (not silently zero rows from a join mismatch).
select
  status,
  count(*) as row_count,
  count(*) filter (where reviewed_at is not null) as with_reviewed_at
from blueprints
group by status
order by status;

-- 4. Sanity check specific to this fix: confirm historical rows landed
--    as review_required (or approved+reviewed_at, if you used the
--    alternative), not silently dropped by the join to `jobs`.
select count(*) as historical_specs_in_app_data
from app_data a
cross join lateral jsonb_array_elements(a.value) as j
where a.key = 'jobs' and j ? 'spec' and j->'spec' <> 'null'::jsonb;
--    Compare this count against the total row_count from query 3 above --
--    they should match (or query 3's total should be <= this, if some
--    jobNumbers didn't find a matching row in `jobs`, worth investigating
--    separately rather than assuming).
