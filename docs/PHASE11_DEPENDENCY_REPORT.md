# Module Dependency Report

Generated from the actual import graph (75 modules, 305 edges, 0 cycles — cycle-checked after every phase since Phase 1).

## Totals
- **75 modules, 8,484 total lines** (avg 113 lines/module)
- **305 import edges**, average fan-out 4.1 imports/module — a shallow, non-tangled graph for its size

## 10 largest modules
```
483  models/geometry.js       -- deterministic 3D generator (Phase 8): inherently large,
                                  one function per subassembly, low coupling (4 deps, 5 importers)
469  blueprints/ui.js         -- review/version/compare UI (Phase 8): template-heavy, expected
406  blueprints/spec.js       -- extraction schema + validation engine: dense but self-contained
395  ai/toolRegistry.js       -- 13 actions, each with resolve/validate/run/preview: linear, not tangled
326  app/events.js            -- the global event router: see "most coupled" below
321  db/parity.js             -- 5 verifiers + orphan sweep (Phase 4): scheduled for removal, see legacy review
305  db/repository.js         -- migration adapter: shrinking as direct repo imports replace it
259  admin/migrationDashboard.js -- same removal timeline as parity.js
212  db/jobsRepo.js
211  db/blueprintsRepo.js
```

## Most depended-upon modules (highest fan-in — changing these has the widest blast radius)
```
26  state/store.js           -- expected: the single shared state object
19  utils/dom.js              -- escapeHtml() etc, used everywhere
14  db/repository.js
13  ui/components/modal.js, ui/components/toast.js, app/bus.js
12  db/supabaseClient.js, auth/authService.js
```
No surprises here — every high-fan-in module is a foundational leaf (state, utils, the render bus) or an intentional single choke point (auth, the DB client). None of them import much themselves (`supabaseClient.js` has 1 dependency), which is exactly the shape you want for something 12+ other files rely on.

## Most coupled (highest fan-out — most likely to break from someone else's change)
```
31  app/events.js       -- the global click-delegation router; imports from nearly every feature area by design
18  blueprints/extract.js
16  app/app.js          -- the bootstrap sequence
14  db/repository.js
```
`app/events.js`'s 31 imports is structural, not accidental — Phase 1 established it as the single delegation point for every `data-action` in the app, and every phase since has added its own actions there rather than inventing a second event-handling pattern. This is the file most likely to need updating when *anything* changes, which is a known, accepted tradeoff of the pattern, not an oversight.

## Refactor candidates, and why most aren't actually urgent
Cross-referencing size against actual coupling (not just line count):

- **`db/repository.js`** (305 lines, 14 importers) — the strongest real candidate. It's both large and heavily depended-upon, and roughly a third of it (per the Legacy Compatibility Review) is scheduled for removal on the production-rollout timeline anyway. **Recommendation: don't refactor now — let the legacy-removal timeline shrink it naturally, then reassess.**
- **`models/geometry.js`** (483 lines, only 5 importers, 4 deps) — large but genuinely low-coupling; it's one cohesive domain (3D generation) with a naturally long function-per-part-type body. Splitting it would mean splitting an inherently sequential build process across files for no coupling benefit. **Not a real candidate.**
- **`ai/toolRegistry.js`** (395 lines, 3 importers) — large by design (13 actions × 4 methods each), but each action's block is independent and already reads like 13 small modules concatenated. Could be split into `toolRegistry/*.js` per-action files if it keeps growing past ~20 actions; not warranted at 13.
- **`app/events.js`** (326 lines, 1 importer, 31 deps) — high fan-out is structural (see above), not a code smell. Splitting it into per-domain event routers would trade "one big file" for "harder to find where an action is handled," a net loss for a codebase this size.

**Bottom line: no module in this codebase currently warrants a refactor purely for size or coupling.** The one real opportunity (`repository.js`) resolves itself via already-scheduled legacy removal rather than needing a deliberate refactor effort.
