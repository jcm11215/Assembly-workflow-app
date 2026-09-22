# Assembly Workflow Tracker

Shop-floor job tracking for screw conveyor assembly at ISC Manufacturing:
jobs moving through the assembly stages, the checklist that gates each
stage, blueprint scanning that pulls the parts list off a drawing, blockers,
an engineering/purchasing error log, daily tasks, notes, and an assistant
that can answer questions about the shop or make changes you confirm.

It runs entirely on one Linux machine: a single Node.js process with a
SQLite database and the drawings in a folder beside it. Phones, tablets and
computers reach it over [Tailscale](https://tailscale.com), so it is never
on the public internet. The only outside service it uses is the AI that
reads drawings -- Google Gemini, OpenRouter, or your own local AI server.

## Running it

- **On the shop server:** follow [docs/INSTALL.md](docs/INSTALL.md) -- install
  Node.js and Tailscale, run `sudo deploy/install.sh`, open the `*.ts.net`
  address it prints.
- **Moving from the old Supabase version:** [docs/MIGRATING.md](docs/MIGRATING.md).
- **Backups, updates, restoring, troubleshooting:** [docs/OPERATIONS.md](docs/OPERATIONS.md).
- **How it's put together:** [ARCHITECTURE.md](ARCHITECTURE.md).

To try it on your own computer (Node.js 22.13 or newer, nothing to install):

```bash
npm start            # http://127.0.0.1:8080, data in ./data
```

The first page asks for a setup code, which the server prints when it
starts. That creates the first admin.

## Tests

```bash
npm test             # server, shared rules and app logic -- no dependencies
npm run test:e2e     # the whole app in Chromium; needs Playwright (see the file)
```
