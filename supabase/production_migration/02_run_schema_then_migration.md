# Step 2 of 3 — run the existing scripts, unmodified

After `01_reconcile_legacy_activity_log.sql` completes successfully:

1. **Run `supabase/schema.sql` exactly as-is.** No edits needed. It will now:
   - Create `profiles`, `jobs`, `job_checklist`, `blockers`, `notes`, `blueprints`, `blueprint_components` fresh (none of these exist yet in this database)
   - Reach `activity_log`'s `create table if not exists` and correctly no-op (the table exists, columns already match)
   - Reach the three `create index` statements and succeed — `actor` now exists

   Confirm it completed with no errors before proceeding.

2. **Run `supabase/migration.sql` exactly as-is.** This can only succeed *after* step above, since it backfills `jobs`/`blockers`/`notes`/`blueprints` from `app_data`, and those tables didn't exist before now. Its `legacy_actors` step will also correctly read the `who` column, which step 1 preserved on purpose.

3. **Run `supabase/triggers.sql`, then `supabase/rls.sql`** (on a branch first, per every prior phase's own guidance — this hasn't changed).

Do not run `schema.sql`/`migration.sql` before step 1 above completes — you'll hit the exact same `column "actor" does not exist` error again.
