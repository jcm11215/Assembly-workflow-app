-- =====================================================================
-- Assembly Workflow Tracker -- Phase 2: normalized schema
-- Run order: schema.sql -> migration.sql -> triggers.sql -> rls.sql
-- Idempotent: safe to re-run.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------- enums ----------
do $$ begin
  create type user_role      as enum ('assembler','lead','admin');
  create type job_priority   as enum ('High','Medium','Low');
  create type job_stage      as enum ('ready','layout','bearings','drive','final','testing','qc','complete');
  create type blocker_sev    as enum ('Critical','High','Medium','Low');
  create type blocker_status as enum ('Open','In Progress','Resolved');
  create type note_type      as enum ('Progress','Issue','NextSteps');
  create type bp_status      as enum ('extracted','under_review','approved','rejected');
exception when duplicate_object then null; end $$;

-- ---------- profiles ----------
-- One row per auth user. role drives every RLS policy.
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null check (length(trim(full_name)) > 0),
  role        user_role not null default 'assembler',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- jobs ----------
-- `version` gives optimistic concurrency: a stale client write is rejected
-- rather than silently overwriting a newer one (the core blob-storage bug).
create table if not exists jobs (
  id                uuid primary key default gen_random_uuid(),
  job_number        text not null,
  customer          text not null default '',
  description       text not null default '',
  due_date          date,
  priority          job_priority not null default 'Medium',
  stage             job_stage not null default 'ready',
  percent_complete  smallint not null default 0
                      check (percent_complete between 0 and 100),
  assigned_to       uuid references profiles(id) on delete set null,
  created_by        uuid references profiles(id) on delete set null,
  last_moved_by     uuid references profiles(id) on delete set null,
  version           integer not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint jobs_job_number_key unique (job_number)
);
create index if not exists jobs_stage_idx       on jobs(stage);
create index if not exists jobs_due_date_idx    on jobs(due_date);
create index if not exists jobs_assigned_to_idx on jobs(assigned_to);
create index if not exists jobs_open_idx        on jobs(due_date) where stage <> 'complete';

-- ---------- job_checklist ----------
-- One row per procedure item. This is what eliminates the highest-volume
-- overwrite risk: two assemblers checking different items are now two
-- independent upserts instead of one whole-array write.
create table if not exists job_checklist (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references jobs(id) on delete cascade,
  step_index   smallint not null check (step_index >= 0),
  item_index   smallint not null check (item_index >= 0),
  done         boolean not null default false,
  done_by      uuid references profiles(id) on delete set null,
  done_at      timestamptz,
  constraint job_checklist_unique unique (job_id, step_index, item_index)
);
create index if not exists job_checklist_job_idx on job_checklist(job_id);
create index if not exists job_checklist_done_idx on job_checklist(job_id) where done;

-- ---------- blockers ----------
create table if not exists blockers (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references jobs(id) on delete cascade,
  issue         text not null check (length(trim(issue)) > 0),
  department    text not null default '',
  severity      blocker_sev not null default 'Medium',
  status        blocker_status not null default 'Open',
  reported_by   uuid references profiles(id) on delete set null,
  resolved_by   uuid references profiles(id) on delete set null,
  reported_at   timestamptz not null default now(),
  resolved_at   timestamptz,
  constraint blockers_resolved_consistent
    check ((status = 'Resolved') = (resolved_at is not null))
);
create index if not exists blockers_job_idx  on blockers(job_id);
create index if not exists blockers_open_idx on blockers(job_id) where status <> 'Resolved';

-- ---------- notes ----------
create table if not exists notes (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid references jobs(id) on delete cascade,   -- null = shop-wide
  note_type  note_type not null default 'Progress',
  body       text not null check (length(trim(body)) > 0),
  author     uuid references profiles(id) on delete set null,
  note_date  date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists notes_job_idx  on notes(job_id, note_date desc);
create index if not exists notes_date_idx on notes(note_date desc);

-- ---------- blueprints ----------
-- Image bytes live in Supabase Storage; only the path is stored here.
-- spec/validation stay jsonb: they are a document by nature, read whole.
create table if not exists blueprints (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references jobs(id) on delete cascade,
  storage_path  text,
  page_count    smallint check (page_count is null or page_count > 0),
  conveyor_type text,
  spec          jsonb,
  validation    jsonb,
  status        bp_status not null default 'extracted',
  extracted_by  uuid references profiles(id) on delete set null,
  extracted_at  timestamptz not null default now(),
  reviewed_by   uuid references profiles(id) on delete set null,
  reviewed_at   timestamptz,
  constraint blueprints_reviewed_consistent
    check ((status in ('approved','rejected')) = (reviewed_at is not null))
);
create index if not exists blueprints_job_idx    on blueprints(job_id);
create index if not exists blueprints_status_idx on blueprints(status) where status <> 'approved';

-- ---------- blueprint_components ----------
-- Normalized BOM so hardware is queryable across jobs.
create table if not exists blueprint_components (
  id            uuid primary key default gen_random_uuid(),
  blueprint_id  uuid not null references blueprints(id) on delete cascade,
  item          text not null,
  specification text not null default '',
  quantity      integer check (quantity is null or quantity >= 0),
  stage         text not null default 'other',
  source_page   smallint,
  confidence    numeric(3,2) check (confidence is null or confidence between 0 and 1)
);
create index if not exists bp_components_bp_idx   on blueprint_components(blueprint_id);
create index if not exists bp_components_item_idx on blueprint_components(lower(item));

-- ---------- activity_log ----------
-- APPEND-ONLY. No update/delete policy exists for any role, including
-- admin -- immutability is the entire value of an audit trail.
create table if not exists activity_log (
  id          bigserial primary key,
  actor       uuid references profiles(id) on delete set null,
  actor_name  text,                       -- denormalized for legacy rows
  action      text not null,
  entity_type text,
  entity_id   uuid,
  detail      jsonb not null default '{}'::jsonb,
  at          timestamptz not null default now()   -- SERVER time, not client
);
create index if not exists activity_at_idx     on activity_log(at desc);
create index if not exists activity_actor_idx  on activity_log(actor, at desc);
create index if not exists activity_entity_idx on activity_log(entity_type, entity_id, at desc);
