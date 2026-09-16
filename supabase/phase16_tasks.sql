-- =====================================================================
-- Phase 16: daily tasks.
--
-- The fourth thing a job can have written against it, and deliberately
-- not any of the other three. A blocker is work STOPPED. An error is a
-- defect that already happened. A note is a record of what went on. A
-- task is work OWED: someone has to do it, by a day, and it is either
-- done or it is not.
--
-- Two tables, because a recurring task is one instruction and many days.
-- "Sweep the bays every weekday" is a single row people edit or stop;
-- what gets ticked off is the pair (task, date), which lives in
-- shop_task_completions. Folding it into a `done` flag on the task would
-- be overwritten every morning, and the question this whole feature
-- exists to answer -- did Tuesday get skipped? -- would have no answer.
--
-- Nothing generates future rows. There is no scheduler in this app, so
-- a generator would have nowhere to run; the day's list is worked out
-- from the rule in the app (src/models/taskMeta.js). That also means
-- changing a recurring task changes it everywhere at once, rather than
-- leaving a tail of already-generated rows behind it.
-- =====================================================================

create table if not exists shop_tasks (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (length(trim(title)) > 0),
  details       text,
  -- Null = a shop task that belongs to no job, the same convention
  -- `notes.job_id` already uses. Cascade: a task to do ON a job has no
  -- meaning once that job is gone.
  job_id        uuid references jobs(id) on delete cascade,
  -- Null = nobody in particular; anyone can pick it up. Set null rather
  -- than cascade on a departing worker, so the task itself survives them.
  assigned_to   uuid references profiles(id) on delete set null,
  recurrence    text not null default 'none'
                  check (recurrence in ('none','daily','weekdays','weekly')),
  -- One-offs only. A recurring task has no single due date.
  due_date      date,
  -- Weekly only: 0 = Sunday .. 6 = Saturday, matching JS getDay().
  weekday       smallint check (weekday is null or (weekday between 0 and 6)),
  -- Recurring only. Without it, a rule added today would read as missed
  -- on every day the shop has ever been open.
  starts_on     date,
  -- Stopping a recurring task must not delete it: the completion history
  -- behind it is a record of work done and has to stay.
  active        boolean not null default true,
  created_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  -- The shape rules for each kind of task, enforced here rather than
  -- trusted from the client: a one-off needs its date, a weekly needs
  -- its day, and a recurring task needs a start.
  constraint shop_tasks_oneoff_has_date
    check (recurrence <> 'none' or due_date is not null),
  constraint shop_tasks_weekly_has_weekday
    check (recurrence <> 'weekly' or weekday is not null),
  constraint shop_tasks_recurring_has_start
    check (recurrence = 'none' or starts_on is not null)
);

create index if not exists shop_tasks_active_idx   on shop_tasks(active) where active;
create index if not exists shop_tasks_job_idx      on shop_tasks(job_id);
create index if not exists shop_tasks_assignee_idx on shop_tasks(assigned_to);
create index if not exists shop_tasks_due_idx      on shop_tasks(due_date) where recurrence = 'none';

-- ---------------------------------------------------------------
-- One row per occurrence actually completed. The absence of a row is
-- what "not done" means, so nothing has to be pre-created for a day
-- before that day arrives.
-- ---------------------------------------------------------------
create table if not exists shop_task_completions (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references shop_tasks(id) on delete cascade,
  -- The day this tick is FOR, which is not always the day it was made:
  -- a late Friday tick on Saturday morning still belongs to Friday.
  due_on      date not null,
  done_by     uuid references profiles(id) on delete set null,
  done_at     timestamptz not null default now(),
  -- Ticking twice is the same fact, not two. This is also what lets the
  -- app upsert a tick without first checking whether one exists.
  unique (task_id, due_on)
);

create index if not exists shop_task_completions_day_idx on shop_task_completions(due_on desc);

-- ---------------------------------------------------------------
-- RLS.
--
-- Handing out work is the lead's job, so creating, editing and stopping
-- tasks is theirs. Completing one is not: anyone active ticks off what
-- they did, including tasks assigned to somebody else -- work covered
-- for a colleague is still work done, and a tick that needed permission
-- would just go unrecorded.
--
-- A tick can be taken back (mis-tap on a phone is the common case) but
-- only by whoever made it, so one worker cannot quietly undo another's
-- record. Leads and admins can clear any of them.
-- ---------------------------------------------------------------
alter table shop_tasks enable row level security;

drop policy if exists shop_tasks_select on shop_tasks;
create policy shop_tasks_select on shop_tasks
  for select to authenticated using (is_active());

drop policy if exists shop_tasks_insert_lead on shop_tasks;
create policy shop_tasks_insert_lead on shop_tasks
  for insert to authenticated with check (is_lead_or_admin());

drop policy if exists shop_tasks_update_lead on shop_tasks;
create policy shop_tasks_update_lead on shop_tasks
  for update to authenticated
  using (is_lead_or_admin()) with check (is_lead_or_admin());

drop policy if exists shop_tasks_delete_admin on shop_tasks;
create policy shop_tasks_delete_admin on shop_tasks
  for delete to authenticated using (is_admin());

alter table shop_task_completions enable row level security;

drop policy if exists shop_task_completions_select on shop_task_completions;
create policy shop_task_completions_select on shop_task_completions
  for select to authenticated using (is_active());

drop policy if exists shop_task_completions_insert on shop_task_completions;
create policy shop_task_completions_insert on shop_task_completions
  for insert to authenticated with check (is_active());

drop policy if exists shop_task_completions_delete on shop_task_completions;
create policy shop_task_completions_delete on shop_task_completions
  for delete to authenticated
  using (done_by = auth.uid() or is_lead_or_admin());

-- ---------------------------------------------------------------
-- Realtime. A lead adds tomorrow's list from the office while the floor
-- has the app open; a tick made on one phone should grey the row out on
-- the others. Guarded because re-adding a table already in the
-- publication is an error, not a no-op.
-- ---------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'shop_tasks'
  ) then
    alter publication supabase_realtime add table shop_tasks;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'shop_task_completions'
  ) then
    alter publication supabase_realtime add table shop_task_completions;
  end if;
end $$;
