# Architecture

Assembly Workflow Tracker — a shop-floor screw-conveyor assembly tracker. Vanilla ES modules, no build step, deployed as static files (GitHub Pages) against a Supabase backend. 75 modules, 0 circular dependencies, ~8,500 lines.

```
                              ┌─────────────────┐
                              │   index.html    │  thin bootstrap shell
                              └────────┬────────┘
                                       │
                              ┌────────▼────────┐
                              │   src/app/       │  boot, event router, render bus
                              └────────┬────────┘
           ┌───────────────────────────┼───────────────────────────┐
           │                           │                           │
    ┌──────▼──────┐            ┌───────▼───────┐           ┌───────▼───────┐
    │  src/auth/   │            │  src/jobs/     │           │  src/ai/       │
    │              │            │  blockers/     │           │                │
    │  Supabase    │            │  notes/        │           │  Action Layer  │
    │  Auth        │            │  activity/     │           │  (chat → tools)│
    └──────┬───────┘            └───────┬────────┘           └───────┬────────┘
           │                            │                            │
           │                    ┌───────▼────────┐                  │
           │                    │  blueprints/    │                  │
           │                    │  models/        │                  │
           │                    │  (3D + review)  │                  │
           │                    └───────┬────────┘                  │
           └────────────────────────────┼───────────────────────────┘
                                         │
                              ┌──────────▼──────────┐
                              │      src/db/         │  the ONLY layer
                              │  (repositories +      │  that touches
                              │   supabaseClient)      │  Supabase
                              └──────────┬──────────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    │                    │                    │
             ┌──────▼──────┐     ┌───────▼───────┐    ┌───────▼───────┐
             │  Postgres    │     │  Realtime      │    │  Storage      │
             │  (RLS +      │     │  (Phoenix      │    │  (blueprint   │
             │  triggers)   │     │  Channels)     │    │  images)      │
             └──────────────┘     └───────┬────────┘    └───────────────┘
                                          │
                                  ┌───────▼────────┐
                                  │ src/realtime/   │  patches state
                                  │ (patch-by-id)   │  by id, never
                                  └────────────────┘  wholesale reload
```

## Auth (`src/auth/`)

Supabase Auth via plain `fetch` against the GoTrue REST API — no SDK, consistent with the rest of the app. Governed by one flag: `AUTH_ENABLED` (`authService.js`), currently `false` in production.

- **`sessionStore.js`** — pure data + pub/sub, zero dependencies (deliberately, to avoid a cycle with `authService.js`)
- **`authService.js`** — login/logout/refresh/password-reset, and the **identity bridge**: `currentActorId()`/`currentActorName()` are what every repository and UI form calls, resolving to either a real `auth.uid()` (when `AUTH_ENABLED`) or the legacy device-local name (when not) — the one switch that governs the whole transition
- **`permissions.js`** — synchronous role checks (`isAssembler()`, `isLeadOrAdmin()`, etc.), reading a cached profile so the UI never awaits a network call just to decide what to show
- **`profileService.js`** — profile lookup/creation, defaulting every new signup to `assembler`
- **`nameGate.js`** / **`loginView.js`** — the two mutually-exclusive first-run UIs, selected by `AUTH_ENABLED`

**Enforcement is layered, not single-point**: `permissions.js` is advisory (UI hints, not gates — buttons aren't hidden); the real enforcement is Postgres RLS policies and triggers, which hold regardless of what the client does.

## Repositories (`src/db/`)

**The only layer permitted to talk to Supabase.** Nothing outside `src/db/` issues a raw `fetch` to Postgrest, Storage, or Realtime's REST surface.

- **`supabaseClient.js`** — the PostgREST/Storage fetch wrapper, typed `DbError`, and the `currentUserId()` provider-injection seam (wired from `app.js`, avoiding a cycle back to `authService.js`)
- **`mappers.js`** — the *only* place the relational (snake_case) row shape and the UI's (camelCase) object shape are translated — this is what let every later phase change the storage layer without touching UI code
- **One file per table**: `jobsRepo.js`, `blockersRepo.js`, `notesRepo.js`, `checklistRepo.js`, `blueprintsRepo.js`, `activityRepo.js` — each does CRUD only, no cross-cutting concerns
- **`repository.js`** — the Phase 3 migration adapter, presenting old blob-API function names (`loadAll`, `persistJobs`, etc.) backed by the relational repos underneath; shrinking as later phases increasingly import repos directly (see Dependency Report)
- **`telemetry.js`, `cutover.js`, `parity.js`, `dryRun.js`** — the Phase 4 migration-verification toolkit (parity checking, dual-write cutover modes); scheduled for removal after 30 days of clean production `Relational Only` operation

## Database (`supabase/*.sql`)

Normalized relational schema (`schema.sql`): `profiles`, `jobs`, `job_checklist`, `blockers`, `notes`, `blueprints`, `blueprint_components`, `activity_log` — the last being **append-only for every role, including admin**; corrections are new rows, never edits. `triggers.sql` enforces the checklist-gate and no-stage-skipping rule **server-side** (mirroring `jobs/transitions.js`'s client-side check exactly, so there's one source of truth for the rule, verified in two places). `rls.sql` implements assembler/lead/admin policies per table; `role_harness.sql` is an executable test that impersonates each role and asserts the real access boundaries hold.

## Realtime (`src/realtime/`)

Plain WebSocket against Supabase's Phoenix Channels protocol (`realtimeClient.js`) — one socket, one channel per subscribed table, exponential-backoff reconnect. Four channels per client: `jobs`, `blockers`, `notes`, `activity_log` (not `job_checklist` — a known scope gap, see Acceptance Report). Every table's realtime module **patches state by id**, never reloads wholesale; `jobsRealtime.js` additionally enforces version-ordering so a stale or out-of-order event can never regress state already advanced by a newer write. On reconnect after a genuine drop, `app.js` triggers exactly one full catch-up reload to close the gap, then resumes incremental patching.

## Blueprint workflow (`src/blueprints/`, `src/models/`)

PDF/image → page classification (cheap AI call) → main extraction (page-role-aware prompt) → `spec.js` normalizes every dimension with full provenance (`value`, `unit`, `source_page`, `confidence`, `method`) and **never lets the AI assign a component's assembly stage directly** — it reports `installation_location`, and `stageForLocation()` maps that to a stage in code, which is the specific fix for a drive/tail-end misclassification bug found in Phase 8. `validateExtraction()` composes spec-level and component-level checks (drive/tail swaps, bore inconsistency, missing critical parts). Every scan is a new **version**, never an overwrite; `getForJob()` serves the latest *approved* version, falling back to latest-overall only if nothing's been approved yet. `models/geometry.js` builds the 3D view from the validated spec only — every dimension used traces to a blueprint callout, or is explicitly rendered as a marked placeholder, never invented.

## AI Action Layer (`src/ai/`)

Natural language → structured, reviewable, permission-checked repository calls. **Never touches the database directly** — every one of 13 registered actions (`toolRegistry.js`) resolves against already-loaded state, checks permission (`permissionAdapter.js`, bridging to `auth/permissions.js`), re-validates business rules by calling the *same* functions the human UI calls (e.g. `jobs/transitions.js`'s `validateStageTransition`, not a reimplementation), and only then calls a repository function. Two-phase by design (`workflowExecutor.js`): `proposeActions()` does all of the above and produces a human-readable preview with **zero writes**; nothing executes until `confirmAndExecute()` is called with that proposal's id, and permission/validation are re-checked at that point too, since state can change between propose and confirm. Every outcome — success, permission denial, validation failure, execution error — is logged via `actionAudit.js` with `action_source: 'ai'`.

## Monitoring (`src/monitoring/`, `src/admin/`)

`errorHandler.js`/`connectionMonitor.js` observe (never modify) the app's global error events and Realtime's connection state, writing rate-limited traces to the same `activity_log` every other mutation uses. `healthDashboard.js` reads from these plus `telemetry.js`, `cutover.js`, and `authService.js` — no metric is tracked twice in two places.

## The one architectural rule that held across all 11 phases

**UI never talks to Supabase.** Every mutation, human or AI-driven, goes: UI/tool → repository function → Supabase. This is what let Auth (Phase 5), RLS (Phase 6), Realtime (Phase 7), the review workflow (Phase 8), and the AI Action Layer (Phase 9) each land without rewriting anything upstream of the repository layer.
