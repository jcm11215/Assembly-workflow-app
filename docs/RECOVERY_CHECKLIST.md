# Recovery Checklist

Read this **before** you need it. The middle of an incident is a bad time to be reading a recovery procedure for the first time.

## 1. Assess before you act
- [ ] Determine what actually happened: bad migration, accidental deletion, corrupted data from a bug, or full project loss (Supabase account issue, etc.)? The right recovery path is different for each, and the wrong one can make things worse.
- [ ] If data is still partially present, **do not** run destructive commands (deletes, truncates, further migrations) until you've taken a fresh snapshot of the current (damaged) state — you may need to diff against it later, and you can't un-take a snapshot you skipped.

## 2. Point-in-time recovery (Supabase paid plans, preferred when available)
- [ ] Dashboard → Database → Backups → restore to a timestamp just before the incident.
- [ ] This restores the **entire** database — understand that anything written after your chosen restore point is gone. If real work happened between the incident and your restore, you will lose it; there is no partial-restore option here.
- [ ] After restoring: re-run `role_harness.sql` (Phase 6) to confirm RLS/triggers survived the restore correctly before letting anyone back into the app.

## 3. Restore from `nightly_export.sh` output (when point-in-time isn't available, or for a targeted restore)
- [ ] On a **fresh, empty branch database first** — never restore directly into a production database you haven't verified the dump against.
  ```
  gunzip -c awt_backup_TIMESTAMP.sql.gz | psql "$SUPABASE_DB_URL"
  ```
- [ ] Run `role_harness.sql` against the restored branch to confirm the schema, triggers, and RLS policies all came back intact — a plain data restore does not include Phase 2/6's triggers or policies unless they were also captured (they should be, since `nightly_export.sh` dumps the whole `public` schema, not just table rows).
- [ ] Only after the branch checks out clean, point production at it (or restore into production directly if you're confident).

## 4. Blueprint images (Storage bucket)
- [ ] If `nightly_export.sh`'s Storage export ran successfully, restore via `supabase storage cp` in reverse.
- [ ] If it didn't (CLI not installed, not authenticated) — blueprint **images** may be unrecoverable even though the extracted spec/BOM data (in the database) survives. This is a known gap; see the Final Acceptance Report.

## 5. Partial data loss (a bad migration, not a full outage)
- [ ] Identify exactly which rows/tables are affected before attempting any fix — use `migration_parity`-style comparison queries (see `supabase/migration.sql`'s pattern) against your last known-good backup to find the actual diff, rather than restoring everything and losing unrelated good work.
- [ ] If only a handful of rows are wrong, hand-correct them from the backup rather than a full restore — full restores are blunt instruments.

## 6. After any recovery
- [ ] Run the full test suite (`tests/*.test.mjs`) against the recovered state where practical.
- [ ] Post a plain-language note to the team: what happened, what was lost (if anything), what's been done. Shop-floor users trust the tool less after a silent data loss than after an honest "we lost the last hour of Tuesday's notes, sorry" — say the second thing.
- [ ] Write down what actually happened and what you'd do differently — add it to this checklist if the checklist was wrong or incomplete.
