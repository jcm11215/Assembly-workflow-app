# Final Acceptance Report — Phase 10

**75 modules · 0 circular dependencies · 10 test files, 200+ assertions across all phases, all passing at time of writing.**

## Known bugs

None currently open. Every bug discovered during this project's phases was fixed in the same phase it was found, verified by an executable test, and is listed here only for the historical record:

- **Phase 0:** checklist-gate bypass via drag-and-drop and the stage-picker; stale modal object references; a debounce promise leak; 3D viewer listener/GPU leaks.
- **Phase 8:** a dead-variable `ReferenceError` that would crash every existing-job blueprint re-scan; a foreign-key-ordering defect where "New Job from Blueprint" tried to save against a job id that didn't exist in the database yet.
- **Phase 10:** blueprint approvals/rejections via the UI were not written to `activity_log` (AI-driven approvals were; human ones weren't) — fixed, see Audit Review.

## Known limitations (not bugs — things the system deliberately does not do)

- **No presence system.** "Active users" on the Health Dashboard is an approximation (distinct actors in the last 15 minutes of activity_log), not real-time presence. Supabase Presence was never implemented; Phase 7 scoped Realtime to `postgres_changes` only.
- **No UI-level permission gating.** Buttons for actions a user's role can't perform are still shown; the rejection happens on attempt (server-side RLS, or `permissionAdapter.js` for AI actions), not by hiding the option. Documented as deliberate in Phase 5, re-confirmed in this phase's Security Review.
- **No delete workflow for blueprint versions.** Versions accumulate; nothing prunes or deletes them. Not a bug, just unimplemented.
- **Checklist changes have no dedicated Realtime channel.** Phase 7 built `jobs/blockers/notes/activity` realtime modules, not `job_checklist` — a checklist tick by another device is only reflected after that job's next full patch or the next reconnect-triggered reload, not instantly.
- **The Realtime wire protocol has only been tested against a mock WebSocket**, never a live Supabase connection. The client-side reconciliation logic (patch-by-id, stale-version rejection, reconnect handling) is thoroughly tested; the actual Phoenix Channels protocol implementation is not proven against the real service.
- **Page classification (Phase 8) is a second AI call per blueprint scan** — added latency and cost, not free.

## Deployment risks, ordered by severity

1. **`AUTH_ENABLED = false` in production.** Every device currently shares one public anon key with full write access to every table (mitigated only by not having applied `rls.sql` yet, which itself depends on real accounts existing). This is the single most important thing to resolve before this app handles anything you'd be upset to lose or have tampered with. The path out is fully built (Phase 5 Auth, Phase 6 RLS, Phase 2's `role_harness.sql`) — it requires a deliberate cutover, not new code.
2. **No verified live Realtime connection.** Smoke-test against your actual Supabase project before depending on it — see Realtime Validation's closing note.
3. **Free-tier Supabase has no automatic backups.** If you're on the free tier, `scripts/nightly_export.sh` running on a schedule is your only safety net, not a supplement to one. Confirm the cron job is actually running, not just written.
4. **Blueprint Storage images aren't covered by the backup script unless the Supabase CLI is installed and authenticated on whatever machine runs it** — the database rows (spec, BOM, validation) back up regardless; the actual scanned images may not.

## Recommended future improvements, roughly in priority order

1. Flip `AUTH_ENABLED` and apply `rls.sql` — the highest-leverage single change available, closing risk #1 above.
2. Live Realtime smoke test against production Supabase.
3. Wire `auth/permissions.js` into UI button visibility — a usability improvement, not a security one (the enforcement already holds without it).
4. `job_checklist` Realtime channel, for true live checklist sync.
5. Job-list keyed DOM patching, if the shop ever approaches hundreds of concurrent jobs (Performance Review, item 1).
6. Presence-based "active users" instead of the activity-log approximation, if that distinction starts to matter operationally.

## What Phase 10 actually verified, not just documented

Every claim above with a specific number or "verified" attached to it was checked against running code during this phase — permission coverage was counted programmatically (13/13), legacy identity confinement was re-grepped (not assumed unchanged from Phase 5), the audit gap was found by tracing actual call sites, and the Realtime multi-actor/conflict/reconnect scenarios were executed as tests, not reasoned about in prose.
