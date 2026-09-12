-- =====================================================================
-- Phase 14: the drawing's item number and part number per component.
-- Additive only, same pattern as the other phase files.
-- =====================================================================

-- `balloon` is the ITEM/FIND number printed in the parts table's first
-- column and repeated inside the balloon markers on the assembly views.
-- It is what ties a table row to a place on the drawing: the scan now
-- reads the table and the balloons in two separate passes and joins them
-- on this number in code (src/blueprints/scanJoin.js), rather than
-- asking the model to do the matching -- which is a lookup with one
-- right answer, and the kind of thing a model gets confidently wrong.
--
-- Kept after the join, not discarded, because it is also how an
-- assembler cross-references a part back to the paper drawing ("item 15").
alter table blueprint_components add column if not exists balloon text;

-- The part/stock number cell from the parts table, where the drawing
-- carries one. Null on rows extracted before this, on drawings whose
-- table has no such column, and on hand-added components.
alter table blueprint_components add column if not exists part_number text;
