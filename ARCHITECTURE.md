# Architecture

One Node.js process serves both the app and its API. The database is one
SQLite file, and the drawings are files in a folder beside it. The server
runs on the shop's Linux machine, bound to localhost; `tailscale serve`
publishes it to the tailnet over HTTPS. Nothing is installed from npm to run
it: SQLite is built into Node 22, and the browser libraries are vendored.

```
 phones / tablets / PCs  ──tailnet (HTTPS, *.ts.net)──▶  tailscale serve
                                                              │
                                                              ▼ 127.0.0.1:8080
┌──────────────────────────── server/ (Node.js) ─────────────────────────────┐
│  http.mjs     router, JSON, static files, security headers                  │
│  auth.mjs     scrypt passwords, cookie sessions (hash stored), throttling   │
│  routes/*     one file per area; permissions checked per handler            │
│  records.mjs  rows → the exact objects the app renders                      │
│  live.mjs     Server-Sent Events: every change pushed to every open app     │
│  ai.mjs       Gemini / OpenRouter / local AI, keys held here                │
│  files.mjs    drawings on disk, a folder per job                            │
│  backup.mjs   nightly VACUUM INTO copies                                    │
└───────────────┬──────────────────────────────────────┬──────────────────────┘
                ▼                                      ▼
     data/assembly.db (SQLite)              data/files/<job>/<drawing>
```

## Folders

| Folder | What's there |
| --- | --- |
| `shared/` | Pure rules both sides import: stages, the checklist and the stage-move rule (`procedure.js`), roles and permissions (`roles.js`), task recurrence, the error vocabulary and its rollups, calendar dates. |
| `server/` | The server. `main.mjs` starts it; `app.mjs` builds the handler (tests run it on an in-memory database); `cli.mjs` is the admin tool; `import-supabase.mjs` is the one-time migration. |
| `web/` | The app. Preact + htm, vendored in `web/vendor/` with pdf.js and the Barlow fonts; plain ES modules, no build step. |
| `web/lib/` | `api.js` (fetch), `store.js` (one state object + `useStore`), `actions.js` (every change, one function each), `live.js` (SSE), `router.js` (hash routes). |
| `web/screens/` | One file per screen. `web/jobs/` holds the pieces shared between job screens. |
| `web/scan/` | Reading drawings: the four-reading pipeline (`pipeline.js`) and its tested building blocks (prompts, JSON repair, balloon joining, layout). |
| `web/assistant/` | The assistant's tool list and its propose-then-confirm flow. |
| `deploy/` | systemd unit, install and update scripts. |
| `tests/` | `node:test` suites for the server, shared rules and app logic; an optional browser suite. |

## How a change flows

1. A screen calls one function in `web/lib/actions.js`, e.g. `moveStage(job, 'layout')`.
2. That sends one request (`POST /api/jobs/:id/stage { from, to }`).
3. The route checks the signed-in person's permission (`shared/roles.js`)
   and the business rule (`shared/procedure.js`'s `checkStageMove`), writes,
   logs to the activity table, and pushes the updated job to every open app
   over SSE.
4. The response carries the same updated record, which the store merges by
   id. The live echo arriving a moment later changes nothing.

Jobs carry two counters. `version` is bumped by edits and stage moves; an
edit sent against an old version is refused with the current job ("someone
else changed this"). `rev` is bumped by every change, so the app drops a
copy older than the one it holds when a response and a live event cross.

## Rules live in one place

The stage gate (one stage at a time, the current stage's checklist
finished, trainees can't sign into QC or Complete, backwards always
allowed) is `checkStageMove` in `shared/procedure.js`. The server enforces
it; the app runs the same function to explain a refusal before sending
anything; the assistant runs it to show which steps it can't do.

Permissions are the table in `shared/roles.js`. The server checks it on
every request; the app uses it to decide which buttons to show.

## Sign-in

Usernames or emails with passwords (scrypt). A session is a random token in
an HttpOnly cookie; the database stores only its SHA-256. Sessions last 30
days and extend as they're used. Every write needs an `X-Requested-With`
header, which another site can't send without a CORS preflight the server
never approves. Switching someone off ends their sessions and closes their
live stream immediately.

## Drawings

A scan is saved in two requests: the parts list and a thumbnail as JSON,
then the original file as raw bytes (`PUT /api/blueprints/:id/file`). Every
scan is kept as a new version; the newest drives the job. Files are named
the way they were uploaded, in a folder per job number, so they can be
found on the server without the app.

## AI

The app never talks to an AI provider directly. It sends a prompt and
content blocks to `POST /api/ai/chat`, and the server calls whichever
provider an admin set up, with retries: it waits out rate limits, switches
away from an overloaded Gemini model, and falls back from the local AI to
OpenRouter if allowed. A substitution is reported, never silent.
