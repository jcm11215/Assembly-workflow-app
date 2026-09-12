-- =====================================================================
-- Phase 12: Component positions for the 2D "where this goes" map.
-- Additive only, same pattern as phase8_blueprint_review.sql -- no
-- existing column is dropped or renamed, and every extraction that
-- predates this still reads back fine (position_x/position_y are null,
-- so that component is simply left off the map, not shown wrong).
-- =====================================================================

-- Normalized fraction of the SOURCE PAGE image the component was read
-- from (0 = left/top edge, 1 = right/bottom edge), not of the whole
-- original file -- a PDF's pages differ in orientation/size, and the
-- component already carries which page (source_page) this is relative
-- to. Null means "not visually pinpointed" (e.g. read from a BOM table
-- row rather than a callout) -- that is a normal, expected outcome, not
-- a missing-data defect the way a null dimension would be.
alter table blueprint_components add column if not exists position_x numeric(6,5)
  check (position_x is null or position_x between 0 and 1);
alter table blueprint_components add column if not exists position_y numeric(6,5)
  check (position_y is null or position_y between 0 and 1);
