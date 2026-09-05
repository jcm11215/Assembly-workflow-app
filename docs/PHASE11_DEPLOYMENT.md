# Production Cutover Checklist

## Deployment order

1. **Confirm Phase 2-4 SQL is applied and clean**: `schema.sql` → `migration.sql` → `triggers.sql` → `storage.sql`, Phase 4's parity dashboard showing a clean `Relational Only` state.
2. **Provision real Supabase Auth accounts** for the team; confirm `handle_new_user()` (triggers.sql) correctly creates `profiles` rows on signup.
3. **On a branch database**: apply `rls.sql`, then run `role_harness.sql` to completion — must print `ALL CHECKS PASSED` with zero exceptions.
4. **Deploy this build** (includes Phase 11's two bug fixes — see below, both must ship together, not separately, since the persistJobs/persistBlockers fix and the blueprint file-select fix are independent but both correctness-critical).
5. **Flip `AUTH_ENABLED = true`** in `src/auth/authService.js`, redeploy. Users now see the login screen.
6. **Apply `rls.sql` to production** — only after step 5 is live (RLS depends on real `auth.uid()` values existing; applying it before real sessions exist locks assemblers out entirely).
7. **Enable Realtime replication** in the Supabase dashboard (Database → Replication) for `jobs`, `blockers`, `notes`, `activity_log` — this build's realtime channels are inert without it.
8. **Smoke-test against the real Supabase project** (see below) before telling the whole shop to switch over.

## Rollback plan

- **If RLS misbehaves**: `alter table <name> disable row level security;` per table — instant, no data risk.
- **If Realtime misbehaves**: this build's `reloadFromStorage()` manual-sync path still exists untouched; the app degrades to a manual-refresh experience, not to nothing.
- **If Auth misbehaves**: flip `AUTH_ENABLED` back to `false`, redeploy — legacy identity resumes exactly as before; no session/profile data is deleted, just unused.
- **If the Phase 11 bug fixes cause an unexpected regression**: both are isolated, single-function changes (`persistJobs`/`persistBlockers` in `db/repository.js`; the four `selectedBlueprintFile` call sites) — revert `db/repository.js` and/or the three blueprint files independently; nothing else in this build depends on either fix.

## Smoke tests (run after deployment, before wide rollout)

- [ ] Sign in as each of the three roles (assembler, lead, admin) — confirm the login screen appears and each role lands in the app correctly.
- [ ] **Create a job, then delete it. Confirm it's actually gone after a hard page refresh** — this is the exact scenario Phase 11's fix addresses; don't skip this one.
- [ ] Report a blocker, then resolve it, then delete it (as a lead). Confirm deletion survives a refresh — same fix, second table.
- [ ] **Select a blueprint image/PDF to scan.** This is the exact previously-broken path (`TypeError: Assignment to constant variable`) — confirm the file picker works and a scan actually runs to completion.
- [ ] Move a job through two stages, confirming the checklist gate blocks a skip and a second browser tab sees the move via Realtime within a few seconds.
- [ ] Open the AI Assistant, type an action request ("move SC-XXXX to layout"), confirm the review card appears **before** anything changes, then confirm.
- [ ] Approve a blueprint extraction as a lead; confirm it appears in the Activity tab (this exact path was a Phase 10 audit gap, now fixed).
- [ ] Open the Health Dashboard; confirm Realtime shows "Connected" and repository stale-conflict/failure counts are at zero.

## Post-deployment validation (first 48 hours)

- [ ] Health Dashboard checked at least twice — Realtime connection stability, any stale-write conflicts, any AI action or blueprint scan failures.
- [ ] `nightly_export.sh` confirmed to have actually run (check the log file, not just the cron entry) at least once.
- [ ] Spot-check the `activity_log` table directly for a sample of the day's mutations — confirm real names/roles are attributed (post-`AUTH_ENABLED` flip), not the legacy "Unknown" fallback.
- [ ] Ask the team directly whether anything feels broken or different — the smoke tests cover what we thought to check; shop-floor use will find what we didn't.
