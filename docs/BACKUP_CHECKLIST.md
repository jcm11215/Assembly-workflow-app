# Backup Checklist

## Weekly (or before any risky change: a migration, an RLS edit, a schema change)
- [ ] Confirm Supabase's automatic backups are enabled and recent: Dashboard → Database → Backups. Free tier has no automatic backups — if you're on it, `nightly_export.sh` is your **only** backup, not a supplement.
- [ ] Run `nightly_export.sh` manually once and confirm the output file is non-trivial in size (the script itself checks this and exits with an error if the file looks too small — don't ignore that).
- [ ] Confirm the export actually contains recent data: `zcat awt_backup_*.sql.gz | grep -c "INSERT INTO jobs"` (or open it and eyeball a few rows) — a backup that runs successfully but captures stale/empty data is worse than no backup, because it creates false confidence.

## Nightly (automated via cron, per the script's header)
- [ ] `nightly_export.sh` runs and logs to a file you actually check occasionally — a silently-failing cron job is the most common way backups quietly stop existing.
- [ ] Backups land somewhere **not** on the same machine/account as production — a local disk next to the app server doesn't protect against the failure modes that matter (account compromise, disk failure, accidental `rm -rf`). Off-machine storage (a separate cloud bucket, at minimum a different physical disk) is not optional.

## Before any schema migration (Phase 2-style `.sql` files)
- [ ] Fresh backup taken **immediately before** running the migration — not "this week's," a fresh one.
- [ ] Migration tested on a Supabase branch database first (every phase's SQL in this project was written to be run this way).
- [ ] Have the rollback statement/procedure for the migration written down **before** running it forward — writing it after something goes wrong is writing it under pressure.

## What is and isn't covered
- **Covered by `nightly_export.sh`:** all `public` schema tables (jobs, blockers, notes, activity_log, blueprints, blueprint_components, job_checklist, profiles) and, if the Supabase CLI is available and authenticated, the `blueprints` Storage bucket.
- **NOT covered, and Supabase-managed:** `auth.users` (Supabase Auth's own tables), Realtime configuration, project-level settings (API keys, RLS policy definitions themselves — those live in your `supabase/*.sql` files in this repo, which is its own form of backup as long as the repo itself is backed up).
- **Recommendation:** back up this repository (including `supabase/*.sql`) with the same seriousness as the database — the RLS policies and triggers are not stored anywhere else, and recreating them from memory after a loss would be a bad day.
