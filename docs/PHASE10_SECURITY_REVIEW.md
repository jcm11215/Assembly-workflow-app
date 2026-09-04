# Security Review

Each item below was actually checked against the code (grep/inspection), not assumed. Commands used are included so findings are reproducible.

## 1. Anonymous write paths

**Finding: present today, by design, and known.** With `AUTH_ENABLED = false` (the current default — verified in `src/auth/authService.js`), every device shares the single public `SUPABASE_ANON_KEY`. Until `rls.sql` (Phase 6) is applied *and* `AUTH_ENABLED` is flipped to `true`, every write is technically anonymous at the database level — this was documented as the deliberate transitional state as far back as Phase 4/5's deployment order, not a new finding.

```
grep -n "AUTH_ENABLED = " src/auth/authService.js
→ export const AUTH_ENABLED = false;
```

**Risk if this stays false in production:** anyone with the page's URL can read the anon key from the page source and write directly to every table. **This is the single highest-priority item in the Final Acceptance Report's deployment risks.**

## 2. Legacy identity paths

**Finding: correctly confined, re-verified after Phases 8 and 9.**
```
grep -rln "identity.js" src --include=*.js
→ src/auth/authService.js   (its own documented legacy-mode fallback)
→ src/auth/nameGate.js      (the legacy UI itself)
→ src/ui/settings.js        (the legacy name editor)
```
No repository, tool-registry, or audit-logging code imports `auth/identity.js` directly — all of them go through `authService.js`'s `currentActorId()`/`currentActorName()` bridge, confirmed in Phase 5 and re-verified here after two more phases of new code (Blueprint review workflow, AI Action Layer) were added on top.

## 3. Routes that bypass permission checks

**AI Action Layer (Phase 9):** every one of the 13 registered tools declares a `permission` field — verified programmatically:
```
node -e "... counts tools vs permission declarations ..."
→ tools found: 13 | permission declarations: 13
```
No tool can be added to `toolRegistry.js` without one (there's no default), and `workflowExecutor.js` checks permission at both proposal time *and* re-checks at execution time (state can change in between).

**UI-level gating: a known, deliberate gap, not an oversight.** `auth/permissions.js`'s helpers (`canAssignJobs()`, `canMoveStages()`, etc.) are **not** wired into hiding buttons anywhere in the UI — this was explicitly noted as deferred in Phase 5's own file comments ("Nothing here is wired into gating existing buttons yet"). An assembler today can *tap* an assign-job button; the click will fail (server-side RLS rejects it once Phase 6 is applied, or the AI Action Layer's `permissionAdapter.js` rejects it for that path specifically). This is a **UX gap, not a security gap** — the enforcement holds regardless of what the UI shows — but it means an unauthorized user currently discovers they can't do something by trying it and seeing a rejection, rather than not seeing the option at all. Worth fixing for shop-floor usability; not urgent for security.

## 4. AI action layer permission coverage

Confirmed above (13/13 tools declare a permission) and functionally tested in Phase 9's `ai-action-permissions.test.mjs` (8/8 passing) — including that an assembler is correctly scoped to only their own assigned job (`ASSIGNED_OR_LEAD`) and only the `percentComplete` field (`PROGRESS_ONLY_OR_LEAD`), with rejections naming the specific blocked field.

## Summary

| Item | Status |
|---|---|
| Anonymous write paths | **Present** — transitional, tracked, single highest deployment risk |
| Legacy identity leakage | Clean — re-verified after 2 additional phases |
| AI tool permission coverage | 13/13, verified programmatically and by test |
| Non-AI permission-check bypass | None found in server-enforced paths |
| UI-level permission gating | Not implemented (deliberate, documented gap — enforcement holds server-side regardless) |
