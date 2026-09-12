-- =====================================================================
-- Reconciliation: columns the app has been reading and writing in
-- production for some time that no file in this directory ever defined.
--
-- These were added directly against the database (Supabase SQL editor)
-- rather than through a committed migration, so schema.sql + the phase
-- files could not rebuild a working database from scratch -- every
-- blueprint query names these columns and would have failed against a
-- database built purely from this repo. Verified against the live
-- "Assembly Workflow Production" project and written to match exactly
-- what is already there, so running this changes nothing on a database
-- that already has them.
--
-- Additive and idempotent, same pattern as the other phase files.
-- =====================================================================

-- ---------- blueprints: the original uploaded file, kept verbatim ----------
-- The stored file is whatever was uploaded (a PDF or a photo), not a
-- recompressed preview, so the UI needs the real filename and mime type
-- to decide between an inline image and "Open PDF". The thumbnail is a
-- separately-shrunk few-KB jpeg used on job cards, base64 inline rather
-- than a second storage round trip for something that small.
alter table blueprints add column if not exists original_filename  text;
alter table blueprints add column if not exists original_mime_type text;
alter table blueprints add column if not exists thumbnail_base64   text;

-- ---------- blueprint_components: manual ordering ----------
-- Components are reorderable by hand after a scan (the AI's order is not
-- always the order an assembler wants to work in), so display order is
-- persisted rather than derived.
alter table blueprint_components add column if not exists sort_order integer not null default 0;
