# Production migration — existing `activity_log` + `app_data`

For a database where `schema.sql` failed with `column "actor" does not exist`
because a legacy `activity_log(id, at, who, action, detail)` table already
existed before this project's schema was ever applied.

## Root cause
`create table if not exists` no-ops the *entire* statement — including
column definitions and constraints — when the table already exists in any
form. It does not reconcile shape. The legacy table's missing `actor`
column then broke the very next statement, `create index ... (actor, ...)`.

## Order of operations

1. **Back up first.** `../scripts/nightly_export.sh ./pre-migration-backup`
2. `00_diagnostic.sql` — run and actually read the output. Don't skip this.
3. `01_reconcile_legacy_activity_log.sql` — adds the missing columns to
   the existing table, backfills `actor_name` from `who`, leaves `who` intact.
4. `../schema.sql` — now unmodified, run as-is. Creates every other table
   fresh; `activity_log`'s block correctly no-ops this time.
5. `../migration.sql` — now unmodified, run as-is. Backfills `jobs`,
   `blockers`, `notes`, `blueprints` from `app_data`; its `legacy_actors`
   step reads `who`, which step 3 preserved on purpose.
6. `03_add_activity_log_fk.sql` — adds the `actor -> profiles(id)` foreign
   key that schema.sql's skipped `CREATE TABLE` never applied.
7. `../triggers.sql`, then `../rls.sql` — **on a branch database first**,
   exactly as every prior phase's deployment checklist already says.
8. *(Optional, later)* `04_optional_drop_legacy_who.sql` — cleanup only,
   not required for correctness.

Every numbered script here is idempotent — safe to re-run if something
fails partway through step 4-6.
