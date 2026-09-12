-- =====================================================================
-- Phase 13: keep the drawing's own wording for each component.
-- Additive only, same pattern as the other phase files.
-- =====================================================================

-- `item` is the category name from the shop's fixed part list ("Hanger
-- Bearing"), which is what groups and colour-codes the part. It is
-- deliberately normalized, and normalizing loses the wording actually
-- printed on the drawing ("HNGR BRG ASSY 2-7/16") -- which is what an
-- assembler is matching against the paper in front of them. This keeps
-- that wording verbatim next to the category instead of choosing one.
--
-- Null/'' on rows extracted before this, and on hand-added components
-- that were never on a drawing at all; the UI falls back to `item`.
alter table blueprint_components add column if not exists item_as_drawn text;
