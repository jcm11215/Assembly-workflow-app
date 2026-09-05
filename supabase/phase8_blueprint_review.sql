-- =====================================================================
-- Phase 8: Blueprint extraction reliability + review workflow.
-- Additive only -- no Phase 2 table is dropped or renamed. Existing
-- 'extracted' status rows remain valid; new code uses the new statuses.
-- =====================================================================

-- New workflow statuses. ADD VALUE is safe to re-run (IF NOT EXISTS) and
-- cannot run inside the same transaction that uses the new value, so run
-- this file as top-level statements (Supabase SQL editor does this by
-- default -- do not wrap it in an explicit BEGIN/COMMIT).
alter type bp_status add value if not exists 'uploaded';
alter type bp_status add value if not exists 'processing';
alter type bp_status add value if not exists 'review_required';

-- ---------- blueprints: versioning + aggregate confidence ----------
alter table blueprints add column if not exists version integer not null default 1;
alter table blueprints add column if not exists confidence numeric(3,2)
  check (confidence is null or confidence between 0 and 1);
alter table blueprints add column if not exists review_urgency text
  check (review_urgency is null or review_urgency in ('suggested','required'));
alter table blueprints add column if not exists reviewed_note text;
alter table blueprints add column if not exists auto_approved boolean not null default false;

create unique index if not exists blueprints_job_version_idx
  on blueprints(job_id, version);
create index if not exists blueprints_job_status_idx
  on blueprints(job_id, status);

-- ---------- blueprint_components: extraction provenance ----------
alter table blueprint_components add column if not exists installation_location text
  check (installation_location in
    ('drive_end','tail_end','trough','screw','hanger','other','unknown'));
alter table blueprint_components add column if not exists source_callout text;
alter table blueprint_components add column if not exists extraction_method text
  check (extraction_method is null or extraction_method in
    ('bom_table','callout','detail_view','general_assembly','inferred'));

-- Backfill: existing rows have `stage` but not `installation_location`.
-- Map the coarse legacy stage back to a location value so old data
-- doesn't show as 'unknown' after this migration. Not exact (stage was
-- always the lossy side of this relationship) but strictly better than
-- leaving it null.
update blueprint_components
set installation_location = case stage
  when 'drive'    then 'drive_end'
  when 'tail'     then 'tail_end'
  when 'bearings' then 'hanger'
  when 'trough'   then 'trough'
  when 'screw'    then 'screw'
  else 'unknown'
end
where installation_location is null;

comment on column blueprint_components.stage is
  'Derived in application code from installation_location -- never set directly by extraction. See src/blueprints/spec.js stageForLocation().';
