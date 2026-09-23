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
│  ai.mjs       AI settings, and asking the local AI                          │
│  ollama.mjs   the local models: chat, drawings, embeddings, downloads       │
│  scans.mjs    reading drawings in the background, one at a time             │
│  knowledge.mjs  documents + corrections the assistant searches              │
│  files.mjs    drawings on disk, a folder per job                            │
│  backup.mjs   nightly VACUUM INTO copies                                    │
└───────────────┬──────────────────────────────────────┬──────────────────────┘
                ▼                                      ▼
     data/assembly.db (SQLite)              data/files/<job>/<drawing>
                                            data/files/knowledge/<doc>
                ▲
                └── Ollama on 127.0.0.1:11434 (or another tailnet machine)
```

## Folders

| Folder | What's there |
| --- | --- |
| `shared/` | Pure rules both sides import: stages, the checklist and the stage-move rule (`procedure.js`), roles and permissions (`roles.js`), task recurrence, the error vocabulary and its rollups, calendar dates. |
| `server/` | The server. `main.mjs` starts it; `app.mjs` builds the handler (tests run it on an in-memory database); `cli.mjs` is the admin tool; `models.mjs` picks and downloads the AI models; `import-supabase.mjs` and `import-localai.mjs` are one-time migrations. |
| `web/` | The app. Preact + htm, vendored in `web/vendor/` with pdf.js and the Rubik and Mulish fonts (ISC's typefaces); plain ES modules, no build step. Dark by default, light per device in Settings (`theme-boot.js`, `lib/theme.js`). |
| `web/lib/` | `api.js` (fetch), `store.js` (one state object + `useStore`), `actions.js` (every change, one function each), `live.js` (SSE), `router.js` (hash routes), `dashboard.js` (the Home dashboard's numbers: one set of filters shared by every chart). |
| `web/screens/` | One file per screen. `web/jobs/` holds the pieces shared between job screens; `web/ui/` the shared building blocks, including the dashboard's charts (`charts.js`). |
| `web/scan/` | Reading drawings (`pipeline.js`), one sheet per request. A CAD PDF's own text (or free Tesseract OCR, vendored in `web/vendor/tesseract`, for scans and photos) finds the parts table -- read straight from the text when it's clean (`tableText.js`, types from `categories.js`), else sent to the AI as an enlarged crop -- and where the item numbers sit on the views. Then the balloons for exactly those item numbers, which end each is at, and a join (`scanJoin.js`) that keeps each table row once -- a table repeated on every sheet is read once, and a part ballooned in several views is one part -- sharing its quantity out over the ends it was seen at, never adding to it; corrections learned from earlier edits; a sort by location. Each scan records which scanner read it (`SCANNER`), so a list from the old scanner, which counted a part again in every view, can be told apart. The illustration tags each part with the drawing's own item number. |
| `web/assistant/` | The assistant's tool list and its propose-then-confirm flow. |
| `deploy/` | systemd unit, the install and update scripts, and the `assembly-workflow` admin command they install. |
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

A scan runs on the server, so it carries on whatever the device that
started it does -- the screen left, the phone locked, the app closed. The
device does the quick part: it renders the pages and reads their text
(a few seconds, with the screen kept on), then sends those pages and the
original file in one upload (`POST /api/scans`: the pages as JSON, the
file's bytes straight after, `?meta=` giving the JSON's length).
`server/scans.mjs` runs the AI steps with the same code the app uses
(`web/scan/pipeline.js`), one scan at a time since they share the GPU,
and pushes progress to the person who started it; the app shows it at
the top of every screen (`web/scan/ScanBanner.js`), on each of their
devices. A re-scan saves itself as the job's newest blueprint. A new job
from a drawing waits, read, until someone reviews it and creates the job
(`POST /api/scans/:id/attach`). A scan can be stopped (after the question
it is on) and a failed one tried again, asking only what failed. The
pages wait in `files/scans/` until the scan is done with them; a scan a
restart interrupted runs again, and finished ones are cleared after a
week.

Every scan is kept as a new blueprint version; the newest drives the
job. Files are named the way they were uploaded, in a folder per job
number, so they can be found on the server without the app. A blueprint
can also be saved directly, in two requests (`POST
/api/jobs/:id/blueprints`, then `PUT /api/blueprints/:id/file`).

## AI

The AI runs on the shop's own hardware, with Ollama; no outside AI service
is used. The app sends a prompt and content blocks to `POST /api/ai/chat`,
and the server asks Ollama, trying once more if a model fails while
loading.

**Local AI.** `ollama.mjs` calls Ollama's native `/api/chat`, not its
OpenAI-style endpoint, because only the native one honours `num_ctx`: a
multi-page scan overflows a small context and Ollama silently drops the
start of the prompt. Requests are sized up front (tokens per image by
model family), refused with "too large" when they can't fit -- the scan
pipeline answers that by halving the pages -- and checked afterwards for
an overflow that slipped through. Drawings go to the vision model with
each page's PDF text layer beside it; questions go to the chat model (or
the vision model, until a chat model is picked).

**Setting it up.** The AI has three jobs -- answering questions, reading
drawings, searching documents -- and `models.mjs` gives each a model. Any
job without one gets an installed model that fits: the recommended one if
it's there, else one of a sensible size. This happens when the server
starts and whenever Settings is opened, so a model installed by hand is
picked up too. **Set up the AI** in Settings downloads what's still
missing, one model at a time, putting each to work as it lands; progress
reaches admins over SSE (`ai-models`).

**Knowledge base.** Admins add documents (Knowledge screen). Text comes
from the file (text, Markdown, CSV, HTML, Word) or, for a PDF, from the
browser's pdf.js text layer. It is cut into ~1400-character passages on
paragraph boundaries and embedded by Ollama's embedding model; vectors
live in SQLite as float32 blobs and are searched by dot product. When the
assistant is asked something, `POST /api/ai/chat` gets `knowledge: <the
question>` and adds the best passages -- weighted by collection, so the
shop's own procedures outrank vendor catalogs -- and any staff correction
to a similar question, labelled as overriding everything else. So a
correction counts from the next question on, with no retraining. The
search runs on the local embedding model.
