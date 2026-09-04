# Legacy Compatibility Review

Every transitional/phase-bridging mechanism in the codebase, classified by when it's actually safe to remove.

| Mechanism | File(s) | Classification | Why |
|---|---|---|---|
| `AUTH_ENABLED` flag + legacy name-gate | `auth/authService.js`, `auth/nameGate.js`, `auth/identity.js` | **Keep** | Not temporary scaffolding — this is the deliberate, permanent rollout switch. Remove only if you decide to drop legacy-identity support entirely as a product decision, not as cleanup. |
| Legacy-mode fail-open in permission checks | `auth/permissions.js`, `ai/permissionAdapter.js` | **Keep**, tied to the flag above | Correctly scoped: fails open only while `AUTH_ENABLED=false` (the documented transitional state), fails closed the moment it's `true`. Removing this without removing the flag itself would break legacy mode. |
| Cutover modes (`Legacy Reads` / `Relational Reads` / `Relational Only`) | `db/cutover.js` | **Remove after production rollout** | Once you've confirmed `Relational Only` has run clean for 30+ days in production (per Phase 4's own deployment checklist), the other two modes and the mode-switching UI are no longer needed. Not urgent — leaving it costs nothing but a Settings menu item. |
| `app_data` blob table + `migration.sql`'s backfill | Supabase schema | **Remove after production rollout**, per Phase 4/8's own stated 30-day-clean rule | Already scheduled for this; Phase 11 found no reason to move the timeline earlier or later. |
| `legacy_actors` placeholder profiles | `supabase/migration.sql` | **Remove after 30 days**, once real accounts are linked | Only useful during the identity-migration window (Phase 5's manual linking step). Harmless to leave, actively confusing to keep past that point. |
| Migration diagnostics dashboard | `admin/migrationDashboard.js` | **Remove after production rollout** | Same timeline as the cutover modes it controls — it's the UI for a decision that will already be made and settled. |
| `db/parity.js` (blob-vs-relational comparison) | `db/parity.js` | **Remove after production rollout** | Compares against `app_data`, which is itself scheduled for removal on the same timeline — these two are coupled and should go together. |

## What Phase 11 found that wasn't already tracked

Nothing new needed adding to this list — every temporary mechanism found during this sweep was already correctly identified and scheduled in an earlier phase's own documentation (Phase 4's deployment checklist, Phase 8's blueprint review timeline). The one thing worth calling out explicitly: **none of these are urgent**. The two items actually removed this phase (`storageGet`/`storageSet` stubs, the repository namespace re-exports) were confirmed-complete migration debt with zero remaining callers — a different, lower-risk category than anything on this list, which all still have a live purpose until their stated trigger condition (30 days clean, or a rollout decision) is met.
