# Phase 4 — Deployment & Rollback Checklists

## Pre-conditions
- Phase 2 SQL applied (`schema.sql`, `migration.sql`, `triggers.sql`, `storage.sql`). **`rls.sql` NOT yet applied** — Phase 4 runs before RLS/Auth by design.
- Phase 3 repositories deployed and in production for at least one full shift, writing successfully.
- `app_data` blob still present and untouched (writes never target it after Phase 3).

---

## Deployment Checklist

**1. Confirm dual-write is real, not assumed**
- [ ] Open Settings → Data Migration → Migration Diagnostics
- [ ] Confirm mode shows **"Legacy Reads + Dual Writes"** (the safe default — `getMode()` returns this if never set)
- [ ] Create one test job, tick one checklist item, add one note
- [ ] Confirm the write succeeded (no toast error) — this is a relational write happening while the UI still reads legacy

**2. Run parity — expect it to fail once, harmlessly**
- [ ] Tap **Run Parity Check**
- [ ] The job just created in step 1 will show as `missing` (legacy blob wasn't touched, relational was) — **this is expected**, not a bug
- [ ] Confirm no *other* discrepancies exist beyond that expected one

**3. Backfill and re-verify**
- [ ] Run `migration.sql` in Supabase SQL editor (idempotent — safe even if run before)
- [ ] Re-run Parity Check
- [ ] Confirm **verdict: PASS**, `safeToCutover: true`, `orphanCount: 0`

**4. Dry-run the cutover**
- [ ] Tap **Dry Run**
- [ ] Confirm `identical: true`
- [ ] Read the visible-differences lists — both must be empty

**5. Flip reads on one device first**
- [ ] Switch mode to **Relational Reads + Dual Writes**
- [ ] Manually verify the dashboard/board/blockers/notes render identically to what you saw a moment ago
- [ ] Use the app normally for 15–30 minutes: create a job, move a stage, tick checklist items, add a blocker
- [ ] Recheck Telemetry — `failures: 0`, `staleConflicts` only appears if you genuinely tested concurrent edits

**6. Roll out to the rest of the shop**
- [ ] Only after step 5 holds clean, tell other devices to switch to Relational Reads (each device sets it independently in its own Settings)
- [ ] Monitor Telemetry across the fleet for the rest of the shift

**7. Commit to Relational Only (irreversible without redeploy)**
- [ ] Only after Relational Reads has been stable for a full day minimum
- [ ] The dashboard **blocks this switch** unless the last parity check passed — do not work around that gate
- [ ] Confirm with the team that no one needs legacy data visible anymore
- [ ] Switch mode to **Relational Only**

**8. Do NOT yet**
- [ ] Do not apply `rls.sql` (Phase 6)
- [ ] Do not archive/drop `app_data` (Phase 8, only after Relational Only has run clean for 30+ days)
- [ ] Do not begin Supabase Auth (Phase 5)

---

## Rollback Checklist

**If in Legacy Reads mode:** nothing to roll back — the UI was never reading relational data. Fix the relational issue and re-run parity when ready.

**If in Relational Reads mode:**
- [ ] Open Migration Diagnostics → tap **Revert to Legacy Reads** (also reachable as `revertToLegacy()` directly, one call, instant)
- [ ] Confirm the toast: "Reverted to legacy reads"
- [ ] Confirm the dashboard renders again — this should be instant, no data movement occurred
- [ ] Writes continue to relational tables throughout — nothing was lost or needs replaying
- [ ] Investigate the parity/telemetry evidence that triggered the rollback before attempting cutover again

**If in Relational Only mode:**
- [ ] This is the one mode without a one-tap revert, by design (requirement 6 describes dry-run + instant revert for the *reversible* modes; committing past that point is deliberate)
- [ ] Rollback here means: set mode back to `RELATIONAL_READS` or `LEGACY_READS` via Settings, then confirm `app_data` still holds usable data (it does, unless Phase 8 already archived it)
- [ ] If `app_data` was already archived (`app_data_archived_*`), rename it back: `alter table app_data_archived_YYYYMMDD rename to app_data;`
- [ ] This scenario is why Phase 8 (blob retirement) requires 30 days of clean Relational Only operation first — don't shortcut that wait

**Emergency: relational layer is down, legacy still needed**
- [ ] Set mode to Legacy Reads on every device (Settings, per device — there is no fleet-wide kill switch yet, that's a Phase 5+ concern once Auth gives us a shared config channel)
- [ ] Confirm `USE_LEGACY_FALLBACK()` returns true in that mode — `loadAll()` will read `app_data` even if relational reads/writes are failing
