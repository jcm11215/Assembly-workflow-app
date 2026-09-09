-- =====================================================================
-- Run this FIRST and read the output before anything else. Confirms
-- the actual current state rather than assuming it matches what was
-- reported -- if anything here surprises you, stop and reconcile
-- before running 01/02/03.
-- =====================================================================

select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;

select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_name = 'activity_log'
order by ordinal_position;

select column_name, data_type
from information_schema.columns
where table_name = 'app_data'
order by ordinal_position;

-- Row counts, so you know what you're working with.
select 'activity_log' as t, count(*) from activity_log
union all
select 'app_data', count(*) from app_data;
