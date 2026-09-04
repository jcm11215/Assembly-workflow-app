# Performance Review

Findings below are from actually reading the render code, not general advice. Each includes the specific file/line pattern found.

## Hotspots identified

### 1. Job list: full re-render on every state change (`jobs/dashboard.js`)
`updateDashboardList()` filters, sorts, and re-stringifies the **entire** job list into HTML on every call — search keystrokes, filter taps, and every Realtime `UPDATE` event (Phase 7) all trigger this. No memoization, no incremental DOM patching, no virtualization.
- **Current scale:** fine. A shop running dozens of jobs re-renders in low single-digit milliseconds.
- **Where it breaks:** several hundred jobs, especially combined with fast typing in the search box (each keystroke = full re-render) or a busy Realtime period (several devices moving stages in quick succession, each triggering a full list rebuild via `requestRender()`).
- **Recommendation, not yet implemented:** debounce the search input's re-render (currently fires on every keystroke), and/or move to keyed row patching for the job cards specifically, since jobs is the one collection actually likely to grow past a few hundred rows.

### 2. 3D model: full WebGL rebuild on every checklist toggle (`ui/components/modal.js` + `jobs/stageGate.js`)
`toggleStageChecklistItem()` → `refreshOpenModal()` → rebuilds the **entire job detail modal's HTML**, and if a 3D model was open, calls `buildModel()` again — disposing and reconstructing the whole THREE.js scene (geometry, materials, camera, listeners) from scratch, confirmed by tracing the actual call chain.
- **Impact:** every single checkbox tap on a job with an open 3D view pays the full scene-rebuild cost, not just a checklist-row repaint. Phase 0 already fixed the *leak* (proper `disposeModel()` cleanup), but not the *redundant work*.
- **Recommendation, not yet implemented:** skip the 3D rebuild specifically when a refresh was triggered by a checklist change unrelated to geometry — the model doesn't need to change when a checkbox is ticked. Requires threading a "reason" through `refreshOpenModal()`, a real code change deferred as out of scope for a hardening pass with "no major features."

### 3. Activity log: unbounded client-side array with full re-render (`activity/index.js`)
Confirmed via grep: rendering does a plain `.map()` over the full loaded list on every render. `db/activityRepo.js` caps server fetches at a default `limit=300`, and `realtime/activityRealtime.js` (Phase 7) caps the client-side array at 300 — so this is bounded in practice, not unbounded. Listed here because it's the kind of thing that looks unbounded at a glance; confirming the actual cap exists is itself a useful finding.

### 4. Blueprint image loading: one full base64 round-trip per view (`blueprints/images.js`)
`fetchBlueprintImage()` downloads the full image from Storage and base64-encodes it in JS on every job-detail open (cached afterward via `blueprintImageCache`, so this is a one-time cost per job per session, not per-render). Acceptable at current scale; would matter if blueprint images were large (multi-MB) scans rather than the compressed JPEGs the extraction pipeline already produces.

## Not hotspots (checked, found fine)
- **Blocker/note rendering:** same full-re-render pattern as jobs, but these lists are inherently small (blockers especially — a shop rarely has more than a handful open at once) and not a concern at any realistic scale.
- **Realtime patch-by-id (Phase 7):** correctly avoids the "reload everything on every event" trap — confirmed jobs/blockers/notes are patched individually, not replaced wholesale.

## Overall assessment
Nothing here is broken today. The list-rendering pattern (full `innerHTML` replace) is a deliberate simplicity tradeoff made from Phase 1 onward and holds up fine at shop-floor scale (dozens of jobs, single-digit concurrent users). The two items worth planning for, if the shop or team ever grows an order of magnitude: keyed job-list patching, and skipping unnecessary 3D rebuilds on non-geometry-affecting refreshes.
