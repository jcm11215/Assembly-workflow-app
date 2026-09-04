# Audit Review

## 1. Every mutation generates an activity_log entry

Verified by counting `logActivity()` call sites against known mutation points:
```
src/jobs/actions.js:    2 calls  (stage moves)
src/jobs/jobForm.js:    3 calls  (create, edit, delete)
src/jobs/stageGate.js:  2 calls  (checklist check/uncheck)
src/notes/index.js:     2 calls  (create, and one other path)
src/blockers/index.js:  2 calls  (create, status change)
```

**One gap found and fixed during this review:** `blueprintsRepo.js`'s `approveVersion()`/`rejectVersion()` (Phase 8) stamp `reviewed_by`/`reviewed_at` on the row itself, but neither the repository nor the UI handlers that called them (`events.js`'s `bp-approve`/`bp-reject` cases) ever called `logActivity()`. Human blueprint approvals were invisible in the audit trail — only AI-driven approvals (via Phase 9's `approve_blueprint` tool, which always audits through `actionAudit.js`) were logged. **Fixed in this phase**: both handlers now log `'Blueprint approved'` / `'Blueprint rejected'` with the job number, version, and `{type:'blueprint', id}` entity — matching the pattern every other mutation already follows.

## 2. AI actions generate audit entries

Confirmed already correct, not newly added: `workflowExecutor.js`'s `confirmAndExecute()` calls `logAiAction()` on **every** step outcome — success, permission rejection, validation rejection, and execution failure alike (verified: 4 separate call sites in that function, one per outcome type). Every entry carries `detail.action_source: 'ai'`, the tool name, and the resolved parameters. Verified functionally in Phase 9's test suite (`ai-action-layer.test.mjs`: "each of the 3 steps produced its own audit entry").

## 3. Blueprint approvals generate audit entries

Now true for both paths after this phase's fix:
- **Human approval** (UI): `events.js`'s `bp-approve`/`bp-reject` → `logActivity()` (fixed this phase)
- **AI approval** (chat action layer): `toolRegistry.js`'s `approve_blueprint`/`reject_blueprint` → `workflowExecutor.js` → `logAiAction()` (already correct, Phase 9)

## 4. New in this phase: client-side error and connection events are also now audited

Not originally required by earlier phases, but consistent with "every mutation-adjacent event should leave a trace": `monitoring/errorHandler.js` writes a rate-limited entry for uncaught exceptions and unhandled rejections; `monitoring/connectionMonitor.js` writes an entry on every Realtime disconnect and reconnect (with downtime duration). Both are genuinely new observability, not gap-fixes — flagged here for completeness of what the audit trail now covers versus what it covered before Phase 10.

## Residual gap, not fixed this phase

Blueprint **scan failures** (the extraction attempt itself failing — bad photo, network error, AI provider error) are now logged (`extract.js`'s catch blocks, fixed this phase) but **blueprint version deletion is not implemented at all** — there's no delete path for a blueprint version anywhere in the codebase, so there's nothing to audit there. Not a bug; just noting the audit trail's coverage is bounded by what mutations actually exist.
