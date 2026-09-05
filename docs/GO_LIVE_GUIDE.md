# Go Live — Full Setup Walkthrough

**Where you actually stand right now**, before reading any further:
- Your Supabase project already exists and is already wired into the code (`db/config.js` has your real project URL and key)
- Your database has legacy tables from the original single-file app (`activity_log`, `app_data`) — the modularized app's full schema hasn't been applied yet
- `AUTH_ENABLED = false` — the app currently runs in legacy/no-login mode
- The code itself is production-ready (verified by an actual runtime harness, not just review)

What's left is entirely **setup and deployment**, not more code. Seven phases, in order. Don't skip the order — several steps depend on the one before it.

---

## Phase 1 — Push the code to GitHub

You need a real git repository now — the old copy-paste-a-single-file workflow doesn't apply anymore, since this app is 75 separate ES module files that must be served together as real files, not embedded in one blob.

1. If you don't already have one: create a new GitHub repository (e.g. `assembly-workflow-tracker`).
2. On your computer, in the folder containing `index.html`, `src/`, `supabase/`, etc.:
   ```bash
   git init
   git add .
   git commit -m "Initial modularized app"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```
3. **GitHub → your repo → Settings → Pages**:
   - Source: **Deploy from a branch**
   - Branch: `main`, folder `/ (root)`
   - Save
4. Wait ~60 seconds, then open `https://YOUR_USERNAME.github.io/YOUR_REPO/`

**You will see the "Setup Needed" banner or a blank shell right now — that's expected.** The database isn't ready yet. Don't troubleshoot the frontend until Phase 2 is done.

---

## Phase 2 — Bring the database up to date

Your database has the *original* app's tables, not the modularized app's full schema. This is exactly the situation `supabase/production_migration/` was built for. Do not run `schema.sql` directly — it will fail with the same errors you already hit.

Open **Supabase Dashboard → SQL Editor** for each of these, run one at a time, read the output before moving to the next:

| Step | File | What it does |
|---|---|---|
| 1 | `supabase/production_migration/00_diagnostic.sql` | Confirms your actual current state |
| 2 | `supabase/production_migration/01_reconcile_legacy_activity_log.sql` | Adds the columns the new schema needs to your *existing* activity_log, without dropping anything |
| 3 | `supabase/schema.sql` | Now runs clean — creates every other table fresh |
| 4 | `supabase/production_migration/05_fix_blueprints_migration_insert.sql` | Runs **instead of** migration.sql's blueprints section (the corrected version) |
| 5 | The rest of `supabase/migration.sql` (everything except the blueprints section you just ran) | Backfills jobs/blockers/notes from your old `app_data` |
| 6 | `supabase/production_migration/03_add_activity_log_fk.sql` | Adds the foreign key that step 3's `CREATE TABLE IF NOT EXISTS` silently skipped |
| 7 | `supabase/production_migration/06_verify_blueprints_constraint.sql` | Confirms step 4/5 landed cleanly — all queries should return 0 rows / clean counts |
| 8 | `supabase/phase8_blueprint_review.sql` | Adds the blueprint review-workflow columns |
| 9 | `supabase/storage.sql` | Creates the private bucket for blueprint images |
| 10 | `supabase/triggers.sql` | Adds the checklist-gate and audit-integrity enforcement |

**Do not run `rls.sql` yet.** That's Phase 4, after real accounts exist — applying it now would lock everyone out, since there's no `auth.uid()` for it to check against.

After step 10, refresh your GitHub Pages URL. The app should now load and show real data.

---

## Phase 3 — Verify the app actually works against your real database

Before inviting anyone else:

1. Create a test job, move it through stages, check off checklist items.
2. Report and resolve a blocker.
3. **Try uploading a blueprint** — this needs an AI key first (next step), so you may hit a "Setup Needed" banner in the Assistant/Blueprint area. That's expected.
4. Open **Settings → gear icon** → add your own Google Gemini key (free, from **aistudio.google.com**) so blueprint scanning and the AI Assistant work. This is a **per-device** setting — everyone who uses the app enters their own key here, once.
5. Re-test blueprint upload now that a key is set.

If anything breaks here, it's a real bug worth stopping for — don't proceed to inviting your team until this phase is clean.

---

## Phase 4 — Turn on real logins (recommended before wider rollout)

Right now, everyone shares one anonymous connection to your database with full write access. This works, but it means there's no real per-person accountability and no way to restrict what an assembler vs. a lead can do. Flipping this on closes that gap — it's the single most important step for anything beyond you personally using the app.

1. **Supabase Dashboard → Authentication → Providers** — confirm **Email** is enabled.
2. **Authentication → Settings** — turn **off** "Allow new users to sign up" (you'll create accounts yourself, not let anyone self-register).
3. **Create your team's accounts**: Authentication → Users → **Add user**, one per person, with a temporary password you give them directly (not email-based, unless you'd rather set up email delivery).
4. In the code, edit `src/auth/authService.js`:
   ```js
   export const AUTH_ENABLED = false;
   ```
   change to:
   ```js
   export const AUTH_ENABLED = true;
   ```
5. Commit and push this change to GitHub (same as Phase 1 — `git add`, `git commit`, `git push`).
6. Reload the app. You should now see a **login screen** instead of the app.
7. Sign in with one of the accounts you created. Confirm it works.
8. **Assign roles**: every new account defaults to `assembler`. To make someone a `lead` or `admin`, run in SQL Editor:
   ```sql
   update profiles set role = 'lead' where id = (
     select id from auth.users where email = 'their-email@example.com'
   );
   ```

---

## Phase 5 — Apply real permission enforcement (do this right after Phase 4, not before)

1. **Strongly recommended**: Supabase Dashboard → your project → **Database → Branches** → create a branch. Run everything below on the branch first.
2. Run `supabase/rls.sql`.
3. Run `supabase/role_harness.sql` — this is a self-testing script. It must print `=== ROLE HARNESS: ALL CHECKS PASSED ===` at the end with no errors. If it fails, **do not proceed** — something about your roles/data doesn't match what the policies expect; fix that before touching production.
4. Once the branch passes cleanly, run `rls.sql` against production for real.

---

## Phase 6 — Turn on live sync between devices

1. **Supabase Dashboard → Database → Replication**.
2. Enable replication for exactly these four tables: `jobs`, `blockers`, `notes`, `activity_log`.
3. Reload the app on two different devices/browsers at once. Move a job's stage on one — confirm it updates on the other within a few seconds, with no manual refresh.

**This is the one part of the whole system that has never been tested against your actual Supabase project** — only against a simulated connection. If step 3 doesn't work, check **Settings → System Health** in the app (the Health Dashboard) for the Realtime connection status first.

---

## Phase 7 — Protect yourself against losing data

1. On any computer with `pg_dump` available (or install PostgreSQL client tools):
   ```bash
   export SUPABASE_DB_URL="postgresql://postgres:[your-db-password]@[your-project-host]:5432/postgres"
   ```
   (Get this exact connection string from **Supabase Dashboard → Project Settings → Database → Connection string → URI**.)
2. Run `scripts/nightly_export.sh ./backups` once manually — confirm it produces a real, non-trivial backup file.
3. Set it up to run automatically every night (cron, a scheduled task, or a CI job — whatever you have available). The script itself won't do this for you; it just needs to be *called* on a schedule.
4. Read `docs/BACKUP_CHECKLIST.md` and `docs/RECOVERY_CHECKLIST.md` once now, while nothing is on fire — not later, when something is.

---

## Before you tell your team it's live

Run through `docs/UAT_TEST_PLAN.md` — at minimum, the sections on Job Creation, Stage Movement, Blueprint Extraction, and (if you completed Phase 4-6) Auth, Roles, and Realtime Updates. It has a pass/fail box for each test and a sign-off table at the end.

## If something breaks partway through

- **Phase 2 SQL fails on a step**: stop, don't improvise past it — every script in `production_migration/` is idempotent, so re-running from the failed step after fixing the underlying issue is safe.
- **Phase 4/5 locks people out**: flip `AUTH_ENABLED` back to `false` in the code, push, and you're back to exactly how things worked before — no data is lost, RLS can be disabled per-table instantly (`alter table X disable row level security;`) if needed.
- **Phase 6 doesn't sync**: the app still works fine without it — `reloadFromStorage()` (the manual sync button) covers you until it's sorted out.
