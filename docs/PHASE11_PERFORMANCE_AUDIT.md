# Performance Audit (Phase 11)

Extends Phase 10's Performance Review with the four specific measurements this phase asked for. All figures are from actually counting/grepping, not estimated.

## Largest render paths (unchanged from Phase 10, re-confirmed)
`jobs/dashboard.js`'s `updateDashboardList()` and the 3D model rebuild in `ui/components/modal.js`'s `refreshOpenModal()` remain the two largest per-call render costs — see Phase 10's Performance Review for the traced call chains. No change since Phase 10; nothing in Phases 10-11 touched either path's rendering logic.

## Largest state mutations
Full-array replacement of `state.jobs` happens in exactly 5 places, all legitimate:
- `db/repository.js`'s `loadAll()` (2 sites: legacy-mode load, relational-mode load) — a full replace is correct here, it's *the* initial load.
- `db/repository.js`'s no-Supabase-configured guard — correct, clearing state.
- `events.js`'s `delete-job` handler and `realtime/jobsRealtime.js`'s DELETE handler — both use `.filter()`, which is a full-array *rebuild*, not a targeted removal. At current scale (dozens of jobs) this is free; it's the same category of cost as the dashboard's render, and would matter at the same scale threshold (hundreds+ jobs) noted in Phase 10.

No mutation was found that rebuilds `state.jobs` unnecessarily on a hot path (e.g., on every render call) — all 5 sites are genuine load/delete events, not accidental over-triggering.

## Frequency of rerenders
29 call sites across the codebase call `render()`/`requestRender()`. This is expected for an app with no virtual-DOM diffing — every mutation (create, edit, delete, stage move, checklist toggle, blocker/note change, realtime patch) triggers exactly one full repaint of the current tab, by design since Phase 1. **Not a hotspot**: each individual call is cheap (see Phase 10's render-cost findings); the count itself (29 trigger points) reflects the number of distinct user/realtime actions in the app, not redundant re-triggering. Spot-checked several call sites (checklist toggle, job creation, realtime job patch) — each fires `render()` exactly once per logical event, no duplicate-trigger pattern found.

## Realtime subscription cost
Each client opens **exactly 4 channels** at boot (`jobs`, `blockers`, `notes`, `activity_log` — confirmed via `app.js`'s `startRealtime()`), consistent with Phase 7's design: one Phoenix channel per subscribed table, sharing a single WebSocket connection (confirmed in Phase 7's `realtimeClient.js` — multiple `subscribeTable()` calls share one socket, verified by test in Phase 7's `realtime-connection.test.mjs`). No table is subscribed to more than once, no redundant channels found. `job_checklist` remains unsubscribed (already flagged as a known limitation in Phase 10's Acceptance Report) — meaning realtime cost is intentionally *not* paid for checklist-level granularity, a deliberate scope decision, not an oversight.

**Cost at shop-floor scale:** 4 channels × however many devices are open simultaneously. For a dozen devices, that's 48 concurrent channel subscriptions server-side — well within Supabase's free-tier Realtime limits for a project this size. No concern identified.

## Overall conclusion
Phase 11 found no new performance issue beyond what Phase 10 already identified and scoped as "fine today, worth planning for at 10x scale." Nothing in this audit changes that conclusion or that scale threshold.
