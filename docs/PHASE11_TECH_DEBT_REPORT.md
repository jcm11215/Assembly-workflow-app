# Final Technical Debt Report

## Immediate (fixed this phase, not carried forward)

Three defects found and fixed during Phase 11's dead-code investigation — listed here for the record, not as open debt:
1. `persistJobs()` never detected or persisted job deletions — a "deleted" job silently reappeared on next reload.
2. `persistBlockers()` had the identical flaw for the single-deletion case.
3. Blueprint file selection threw `TypeError: Assignment to constant variable` on every attempt — the entire blueprint-scanning feature (Phases 8-9) was unreachable via the UI.

All three are covered by new permanent regression tests (13 assertions) and confirmed fixed against the actual failure pattern, not just patched and assumed working.

## Immediate (open — not fixed this phase, action recommended before/at production cutover)

1. **`AUTH_ENABLED = false` in production** — the single highest-priority item across Phases 10 and 11. Every write is currently attributable only to a shared anon key. The path out is fully built; it requires a deliberate, scheduled cutover (see `PHASE11_DEPLOYMENT.md`), not more code.
2. **Realtime has never been smoke-tested against a live Supabase project** — only against a mocked WebSocket, across Phases 7, 10, and 11. Do this before wide rollout.

## Short-term (30-60 days)

1. **Legacy compatibility removal**, per `PHASE11_LEGACY_COMPATIBILITY_REVIEW.md`: cutover modes, `app_data` blob table, `migration.sql`'s backfill, `legacy_actors`, the migration diagnostics dashboard, `db/parity.js` — all scheduled on the "30 days clean in `Relational Only`" timeline already established in Phase 4.
2. **`job_checklist` has no Realtime channel** — a checklist tick by another device isn't reflected until the next full reload. Low urgency (checklist state is per-job and low-frequency compared to stage moves), but worth closing the gap for full parity with the other four tables.
3. **UI-level permission gating** — buttons for actions a role can't perform are still shown; rejection happens on attempt, not by hiding the option. A usability fix, not a security one (server-side enforcement is already correct and complete).

## Long-term (only if the shop/team scale changes materially)

1. **Job-list rendering** — full `innerHTML` replace on every keystroke/event. Fine at dozens of jobs; would want keyed DOM patching in the hundreds.
2. **3D model rebuild on every checklist toggle** — correctly leak-free (Phase 0) but does more work than necessary; worth skipping when a refresh is checklist-only, not geometry-affecting.
3. **`db/repository.js`'s migration-adapter role** will naturally shrink as more code imports repositories directly (already the dominant pattern per the Dependency Report) — no deliberate refactor needed, just let it happen.

## What this report deliberately does not include

Every module-size and coupling figure in the Dependency Report was checked against actual fan-in/fan-out, not flagged by line count alone — `models/geometry.js` is the largest file in the codebase and is **not** listed as debt, because it's large due to inherent domain complexity (one function per physical subassembly) with low coupling, not tangled design. Padding this report with "consider splitting this 400-line file" for files that don't actually need it would be noise, not signal.

## Overall assessment

Eleven phases in, the codebase's technical debt is smaller and more precisely bounded than is typical for a project this size — a direct result of every phase verifying its own work with executable tests rather than trusting review alone. The two bugs found this phase (job/blocker deletion, blueprint file selection) are the kind that specifically evade static analysis and parse-time checks; finding them required investigating *why* code looked unused rather than trusting that "unused" meant "safe to delete." That's the audit method worth carrying into whatever comes after Phase 11, more than any specific finding in this report.
