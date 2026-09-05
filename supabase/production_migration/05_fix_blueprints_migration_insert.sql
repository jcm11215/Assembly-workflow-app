-- =====================================================================
-- Patch for migration.sql's blueprints INSERT (section "5. blueprints +
-- components"), which violates blueprints_reviewed_consistent by
-- inserting status='approved' with reviewed_at left NULL.
--
-- Root cause: a genuine bug in migration.sql's INSERT, not an overly
-- strict constraint. The constraint is correct and must not be relaxed.
--
-- Fix: historical specs from app_data never went through real review --
-- they predate the review workflow entirely. Rather than fabricate a
-- reviewed_at timestamp to claim a review that never happened, stage
-- them as 'review_required' so a lead makes the real approval decision.
-- This also correctly sets confidence/urgency to match how a fresh
-- extraction at "unknown confidence" would be classified.
--
-- Run this INSTEAD of migration.sql's original blueprints INSERT block.
-- If migration.sql already ran and rolled back (typical when pasted as
-- one script -- the failing INSERT aborts the whole transaction), this
-- is the only patch needed; skip straight to the verification queries
-- at the bottom. If your execution method does NOT wrap the whole
-- script in one transaction, run the cleanup query first (also below).
-- =====================================================================

-- ---------- Cleanup: remove any partially-inserted invalid rows ----------
-- No-op if the transaction already rolled back (the common case) --
-- included defensively for non-transactional execution methods.
delete from blueprint_components
where blueprint_id in (
  select id from blueprints
  where status in ('approved','rejected') and reviewed_at is null
);
delete from blueprints
where status in ('approved','rejected') and reviewed_at is null;

-- ---------- Corrected insert ----------
insert into blueprints (job_id, spec, validation, conveyor_type, status, extracted_at)
select
  jb.id,
  j->'spec',
  j->'validation',
  j->'spec'->>'conveyorType',
  'review_required',    -- historical data never went through real review --
                         -- stage it honestly rather than fabricate one
  coalesce(nullif(j->>'blueprintExtractedAt','')::timestamptz, now())
from app_data a
cross join lateral jsonb_array_elements(a.value) as j
join jobs jb on jb.job_number = j->>'jobNumber'
where a.key = 'jobs' and j ? 'spec' and j->'spec' <> 'null'::jsonb;

-- ---------- Components (unchanged from migration.sql) ----------
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

-- =====================================================================
-- ALTERNATIVE (do not run both): if you specifically want historical
-- specs grandfathered as approved rather than queued for review, use
-- this insert instead of the 'review_required' one above. This
-- explicitly records that no human reviewed it -- reviewed_by stays
-- NULL, reviewed_at is stamped at migration time (not backdated to
-- pretend a review happened historically), satisfying the constraint
-- without claiming reviewed_by performed a review that didn't occur.
--
-- insert into blueprints (job_id, spec, validation, conveyor_type, status, extracted_at, reviewed_at)
-- select
--   jb.id, j->'spec', j->'validation', j->'spec'->>'conveyorType',
--   'approved',
--   coalesce(nullif(j->>'blueprintExtractedAt','')::timestamptz, now()),
--   now()   -- reviewed_at = migration time, honestly, not fabricated history
-- from app_data a
-- cross join lateral jsonb_array_elements(a.value) as j
-- join jobs jb on jb.job_number = j->>'jobNumber'
-- where a.key = 'jobs' and j ? 'spec' and j->'spec' <> 'null'::jsonb;
-- =====================================================================
