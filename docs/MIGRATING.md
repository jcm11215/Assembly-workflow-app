# Moving from the old Supabase version

`server/import-supabase.mjs` copies everything from the old Supabase project
into a fresh server: people and their roles, jobs, checklists, blockers,
notes, the error log, tasks and their ticks, every blueprint scan with its
parts and its drawing file, the activity log, and the shop access codes.

Do it once, on the new server, **before anyone starts using it** -- the
import refuses to run into a server that already has jobs.

## What you need

- **The project URL and publishable key** -- they were in the old app's
  `src/db/config.js`:
  - URL: `https://ljxwmjahmmrchmomkjqj.supabase.co`
  - publishable key: `sb_publishable_TiPFbIBMRpLblE7RXfzSSg_-FH4ZMr4`
- **The service role key** -- Supabase dashboard → Project Settings → API
  Keys → the *secret* (service_role) key. It can read everything, so paste
  it only into the command below; don't save it in a file or commit it.
- **Drawings saved to the shop server**, if you ever turned on "Store new
  blueprint files on the shop's server": the folder your local AI server
  kept them in (it has one sub-folder per job number). Copy it onto this
  machine first.

## Run it

Install first ([INSTALL.md](INSTALL.md)) but **don't create an admin yet**.
Then, from `/opt/assembly-workflow`:

```bash
# Look first: counts everything, writes nothing.
sudo -u assembly env DATA_DIR=/var/lib/assembly-workflow \
  SUPABASE_URL=https://ljxwmjahmmrchmomkjqj.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY='<service role key>' \
  node server/import-supabase.mjs --dry-run

# Then for real (add --local-files /path/to/that/folder if you have one):
sudo -u assembly env DATA_DIR=/var/lib/assembly-workflow \
  SUPABASE_URL=https://ljxwmjahmmrchmomkjqj.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY='<service role key>' \
  SUPABASE_ANON_KEY=sb_publishable_TiPFbIBMRpLblE7RXfzSSg_-FH4ZMr4 \
  node server/import-supabase.mjs

sudo systemctl restart assembly-workflow
```

It lists anything it couldn't bring across -- usually a drawing file that
was never finished uploading in the old app.

## What changes for people

- **Sign-in names.** Anyone who signed in with a plain username still does
  (`dreyes`). Anyone who used an email address still uses it.
- **Passwords.** Supabase doesn't hand out passwords, so the import sets up
  a one-time check instead: the first time someone signs in here, their
  password is checked against the old project and, if it's right, becomes
  their password here. After everyone has signed in once (or before you shut
  the old project down), turn that off:
  `sudo -u assembly env DATA_DIR=/var/lib/assembly-workflow node server/cli.mjs legacy-auth off`.
  Anyone who hasn't signed in by then gets a password from an admin
  (Team → Set password).
- **Roles.** Admins and leads become **Admin**; Assembler A and the old
  single Assembler role become **Assembler A**; Assembler B stays **Assembler B**.
  Every assembler can now work every job -- assignment is who leads a job,
  not who may touch it.
- **AI.** The old app used Gemini or OpenRouter with keys kept in each
  browser. The new one uses only the shop's own AI (Ollama), set up once
  by an admin under **Settings → AI**. No keys are needed.

## From the stand-alone Local AI Assistant

If the shop ran the separate Local AI Assistant (the Python app, service
`localai`), its job is now part of this app: scans and the assistant use
Ollama directly, and its documents and corrections move into the
**Knowledge** screen.

The install script does this for you: when it finds `/home/*/localai`, it
offers to bring in the documents, passages and corrections, plus the old
model choices, and then to switch off the `localai` service. If the old
Local AI had the machine's main Tailscale address, the app takes that
address over once the old service is off. So after `git pull`, running
this once is enough:

```bash
sudo /opt/assembly-workflow/deploy/install.sh
```

To do it by hand instead:

```bash
assembly-workflow import-localai /home/<you>/localai
sudo systemctl disable --now localai
```

Its copies of tracker jobs are left behind, since the assistant reads the
jobs live now. Running the import twice is safe. Ollama itself stays: it's
what runs the models.

## Afterwards

When you're happy everything came across:

1. Turn off the old-password check (above).
2. Take the old app offline -- the GitHub Pages site -- so nobody keeps
   using it by accident.
3. Pause or delete the Supabase project. Keep a copy first if you want one:
   Supabase dashboard → Database → Backups.
