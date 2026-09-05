-- =====================================================================
-- Phase 2: backfill app_data blobs -> normalized tables
-- Idempotent and re-runnable. Does NOT drop app_data.
-- Prereq: schema.sql applied.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Legacy identity placeholders
-- Historical rows carry free-text names with no auth user behind them.
-- We create inert placeholder profiles rather than inventing attribution
-- or discarding history. These are linked to real users during Phase 5.
-- ---------------------------------------------------------------------
create table if not exists legacy_actors (
  legacy_name text primary key,
  profile_id  uuid,        -- filled in manually when the real user is known
  seen_count  integer not null default 0
);

-- Source: the pre-migration activity_log, which stored a free-text `who`.
-- Guarded so this runs cleanly whether or not that column still exists.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_name='activity_log' and column_name='who') then
    execute $q$
      insert into legacy_actors (legacy_name, seen_count)
      select who, count(*) from activity_log
      where who is not null and who <> ''
      group by who
      on conflict (legacy_name) do update set seen_count = excluded.seen_count
    $q$;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. jobs
-- ---------------------------------------------------------------------
insert into jobs (
  job_number, customer, description, due_date, priority, stage,
  percent_complete, created_at, updated_at
)
select
  j->>'jobNumber',
  coalesce(j->>'customer',''),
  coalesce(j->>'description',''),
  nullif(j->>'dueDate','')::date,
  coalesce(nullif(j->>'priority','')::job_priority,'Medium'),
  coalesce(nullif(j->>'assemblyStatus','')::job_stage,'ready'),
  least(greatest(coalesce((j->>'percentComplete')::int,0),0),100),
  now(), now()
from app_data a, jsonb_array_elements(a.value) as j
where a.key = 'jobs' and coalesce(j->>'jobNumber','') <> ''
on conflict (job_number) do nothing;

-- ---------------------------------------------------------------------
-- 2. job_checklist  (checklist map {"si-ii": true} -> rows)
-- ---------------------------------------------------------------------
insert into job_checklist (job_id, step_index, item_index, done)
select
  jb.id,
  split_part(kv.key,'-',1)::smallint,
  split_part(kv.key,'-',2)::smallint,
  (kv.value)::text::boolean
from app_data a
cross join lateral jsonb_array_elements(a.value) as j
join jobs jb on jb.job_number = j->>'jobNumber'
cross join lateral jsonb_each(coalesce(j->'checklist','{}'::jsonb)) as kv
where a.key = 'jobs'
  and kv.key ~ '^[0-9]+-[0-9]+$'
on conflict (job_id, step_index, item_index) do update
  set done = excluded.done;

-- ---------------------------------------------------------------------
-- 3. blockers
-- ---------------------------------------------------------------------
insert into blockers (job_id, issue, department, severity, status, reported_at, resolved_at)
select
  jb.id,
  coalesce(b->>'issueDescription','(no description)'),
  coalesce(b->>'responsibleDepartment',''),
  coalesce(nullif(b->>'severity','')::blocker_sev,'Medium'),
  coalesce(nullif(b->>'status','')::blocker_status,'Open'),
  coalesce(nullif(b->>'dateReported','')::timestamptz, now()),
  case when b->>'status' = 'Resolved'
       then coalesce(nullif(b->>'dateReported','')::timestamptz, now()) end
from app_data a
cross join lateral jsonb_array_elements(a.value) as b
join jobs jb on jb.job_number = b->>'jobNumber'
where a.key = 'blockers'
  and coalesce(b->>'issueDescription','') <> '';

-- ---------------------------------------------------------------------
-- 4. notes  (job_id nullable: '' meant shop-wide)
-- ---------------------------------------------------------------------
insert into notes (job_id, note_type, body, note_date, created_at)
select
  jb.id,
  coalesce(nullif(n->>'noteType','')::note_type,'Progress'),
  n->>'notes',
  coalesce(nullif(n->>'date','')::date, current_date),
  now()
from app_data a
cross join lateral jsonb_array_elements(a.value) as n
left join jobs jb on jb.job_number = nullif(n->>'jobNumber','')
where a.key = 'notes'
  and coalesce(n->>'notes','') <> '';

-- ---------------------------------------------------------------------
-- 5. blueprints + components (spec/geometry carried across as-is)
-- ---------------------------------------------------------------------
insert into blueprints (job_id, spec, validation, conveyor_type, status, extracted_at)
select
  jb.id,
  j->'spec',
  j->'validation',
  j->'spec'->>'conveyorType',
  'approved',            -- pre-existing specs are grandfathered as approved
  coalesce(nullif(j->>'blueprintExtractedAt','')::timestamptz, now())
from app_data a
cross join lateral jsonb_array_elements(a.value) as j
join jobs jb on jb.job_number = j->>'jobNumber'
where a.key = 'jobs' and j ? 'spec' and j->'spec' <> 'null'::jsonb;

insert into blueprint_components (blueprint_id, item, specification, quantity, stage, source_page, confidence)
select
  bp.id,
  coalesce(c->>'item','Unspecified item'),
  coalesce(c->>'specification',''),
  nullif(c->>'quantity','')::int,
  coalesce(nullif(c->>'stage',''),'other'),
  nullif(c->>'source_page','')::smallint,
  nullif(c->>'confidence','')::numeric
from app_data a
cross join lateral jsonb_array_elements(a.value) as j
join jobs bpj on bpj.job_number = j->>'jobNumber'
join blueprints bp on bp.job_id = bpj.id
cross join lateral jsonb_array_elements(coalesce(j->'billOfMaterials','[]'::jsonb)) as c
where a.key = 'jobs';

-- ---------------------------------------------------------------------
-- 6. Verification -- run and eyeball BEFORE cutover
-- ---------------------------------------------------------------------
create or replace view migration_parity as
select 'jobs' as entity,
       (select jsonb_array_length(value) from app_data where key='jobs')      as blob_count,
       (select count(*) from jobs)                                            as table_count
union all
select 'blockers',
       (select jsonb_array_length(value) from app_data where key='blockers'),
       (select count(*) from blockers)
union all
select 'notes',
       (select jsonb_array_length(value) from app_data where key='notes'),
       (select count(*) from notes);

-- select * from migration_parity;   -- blob_count must equal table_count

-- ---------------------------------------------------------------------
-- 7. Retirement (Phase 8 ONLY -- after parity holds and reads are cut over)
-- ---------------------------------------------------------------------
-- alter table app_data rename to app_data_archived_20260830;
-- drop 30+ days later once backups confirm.
