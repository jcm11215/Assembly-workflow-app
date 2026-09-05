# Realtime Validation

All scenarios below were run as executable tests (`tests/realtime-multiuser.test.mjs`, `tests/connection-monitor.test.mjs`), not manually reasoned through. 11/11 assertions passing.

## Multiple assemblers, different jobs
Two simulated devices patch different jobs concurrently via `postgres_changes` events. **Result:** each job updates independently; one device's event stream never touches the other's job state. Confirmed via direct assertion on `state.jobs` after interleaved events.

## Multiple leads, conflicting writes to the same job
Simulated: Lead A's write lands first (server assigns it version 2, matching Phase 3's optimistic-concurrency scheme). Lead B's device had also started from version 1 — its write would be **rejected server-side** before any realtime event for it is ever broadcast (this is Phase 3's `StaleWriteError` mechanism, unchanged, "not revisited"). The test specifically checks the remaining risk: does a stale, out-of-order network replay of the *losing* write's old version-1 data roll back the already-applied version-2 state? **Result: no.** The version guard in `jobsRealtime.js` (Phase 7) drops any incoming event whose version is not newer than what's already local.

## Reconnect after a dropped connection
Verified the exact logic `app.js` uses: a `'connected'` event is treated as a real reconnect (triggering a full catch-up reload) **only if** a `'disconnected'` event preceded it. A normal startup connect does not trigger a redundant reload; a genuine drop-then-recover does, exactly once, even if multiple `'connected'` events fire in a row afterward (guards against double-reloading on flaky reconnect handshakes).

## Offline recovery
Same mechanism as above — the "gap" during an outage (any writes from other devices that happened while this one was disconnected) is closed by the one full `loadAll()` reload triggered on reconnect, after which incremental patch-by-id resumes. Not separately tested beyond confirming the trigger logic fires correctly; the reload itself reuses `loadAll()`, already covered by Phase 3/4's test suites.

## What this validation does NOT cover
These tests run against a mocked WebSocket and mocked PostgREST responses — they prove the **client-side reconciliation logic** is correct, not that Supabase's actual Realtime service behaves exactly as the protocol implementation in `realtimeClient.js` assumes. Phase 7's own notes flagged this: the wire protocol has only been exercised against a mock, not a live Supabase project. **This remains true after Phase 10** — a smoke test against a real project is still recommended before relying on this in production, and is listed as a deployment risk below.
