# Security Audit

Every item below was checked with a real grep/inspection against the current codebase, commands shown for reproducibility. This extends Phase 10's Security Review with the specific items Phase 11 was asked to re-check.

## Bypassable permissions
`grep -n "catch" src/ai/permissionAdapter.js` → no `try/catch` in that file at all; every branch returns an explicit `{allowed:true}` or `{allowed:false, reason}`. There is no code path that can throw past a permission check and accidentally proceed. `currentRole()` returns `null` (not a role) for "signed in, no profile yet" — every `is*()` helper built on top correctly treats `null` as "deny," not "allow." **No bypass found.**

## Direct repository access paths (outside approved layers)
`grep -rln "supabaseClient" src/ai/` → empty. The AI Action Layer touches only `jobsRepo`, `blockersRepo`, `notesRepo`, `checklistRepo`, `blueprintsRepo`, `profileService` — never the raw Postgrest client. Re-verified after Phase 10/11's edits; unchanged from Phase 9's original audit.

## Debug flags
`grep -rniE "debug\s*[:=]\s*true|console\.(log|debug)\(" src` → zero matches outside `console.error`/`console.warn`, which are legitimate error-path logging, not debug scaffolding. **Nothing to remove.**

## Hardcoded credentials
`grep -rniE "api[_-]?key\s*=\s*['\"]|password\s*=\s*['\"]|secret\s*=\s*['\"]" src` → one real finding, precisely characterized below.

**`db/config.js` contains a real, live `SUPABASE_URL` and `SUPABASE_ANON_KEY`, not placeholders.** This is *not* a traditional leaked secret — Supabase's own security model treats the publishable/anon key as safe for public/client-side exposure by design, with access control meant to happen entirely through RLS policies (Phase 2/6). That said, two things are worth being precise about:
1. It is a hardcoded pointer to one specific real Supabase project, committed to source. Anyone with this repo (or the deployed page's source) can find and query that exact project.
2. **Its actual safety depends entirely on `rls.sql` being applied and `AUTH_ENABLED` being `true`** — which Phase 10's Security Review already flagged as the #1 deployment risk, still true today. This finding doesn't add a new risk; it sharpens the existing one: the key itself isn't the vulnerability, the *absence of RLS behind it* is.

No `service_role` key, database password, or provider API key (Gemini/OpenRouter) was found hardcoded anywhere — those are correctly kept in `localStorage` per-device (`ai/keys.js`), never in source.

## Unsafe fallbacks
Checked every permission-adjacent fail path for fail-open behavior. Found exactly two, both deliberate and correctly scoped:
- `permissions.js`'s `currentRole()`: returns `'lead'` (unrestricted) **only** when `AUTH_ENABLED === false` — the documented transitional legacy state, not a fallback triggered by an error.
- `permissionAdapter.js`'s `ASSIGNED_OR_LEAD` check: same `if(!AUTH_ENABLED) return {allowed:true}` pattern, same scoping.

Neither fires on an error condition (a failed fetch, a missing profile while authenticated, etc.) — those paths correctly return `null`/deny. No unsafe fallback found beyond the already-tracked `AUTH_ENABLED` transitional state.

## Summary

| Check | Result |
|---|---|
| Bypassable permissions | None found |
| Direct repository access bypass | None found |
| Debug flags | None found |
| Hardcoded credentials | One (anon key) — safe by Supabase's design, risk is contingent on RLS being applied |
| Unsafe fallbacks | None beyond the already-tracked, correctly-scoped `AUTH_ENABLED` transitional state |
