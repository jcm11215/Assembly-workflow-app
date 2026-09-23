# Running it day to day

The `assembly-workflow` command does the everyday jobs. It asks for your
password (sudo) when it needs to.

| Command | Does |
| --- | --- |
| `assembly-workflow status` | is it running, where to open it, the last backup, the AI engine |
| `assembly-workflow update` | backs up, gets the latest version and restarts |
| `assembly-workflow restart` | restarts the app |
| `assembly-workflow logs` | follows the app's log (Ctrl+C to stop) |
| `assembly-workflow setup-code` | the code for creating the first admin |
| `assembly-workflow create-admin` | makes an admin login (asks for the details) |
| `assembly-workflow reset-password <login>` | sets a password and signs that person out everywhere |
| `assembly-workflow users` | lists every login |
| `assembly-workflow backup` | writes a database backup now |
| `assembly-workflow import-localai <folder>` | brings in the old Local AI's documents and corrections |

Everything the app keeps is in **`/var/lib/assembly-workflow`**:

```
assembly.db        the database (jobs, people, checklists, notes, …)
files/<job>/…      every drawing ever uploaded, named as uploaded
files/scans/       drawings waiting to be read (cleared as each scan finishes)
backups/           nightly copies of the database
```

## Backups

The server copies the database to `backups/` every night (after 2 am, or
when it next starts if it was off) and keeps the last 14. **Team → Health**
and `assembly-workflow status` show when the last one ran.

That copy is on the same disk, so it guards against mistakes, not a dead
drive. Copy the folder somewhere else regularly -- another machine, a NAS,
a USB drive. The drawings never change once saved, so a plain `rsync` is
enough:

```bash
# e.g. nightly from cron on another machine on the tailnet
rsync -a shop-server:/var/lib/assembly-workflow/backups/ /mnt/nas/assembly/backups/
rsync -a shop-server:/var/lib/assembly-workflow/files/   /mnt/nas/assembly/files/
```

A backup right now: `assembly-workflow backup`.

## Restoring

```bash
sudo systemctl stop assembly-workflow
cd /var/lib/assembly-workflow
sudo -u assembly cp assembly.db assembly.db.before-restore
sudo -u assembly cp backups/assembly-<date>.db assembly.db
sudo rm -f assembly.db-wal assembly.db-shm
sudo systemctl start assembly-workflow
```

If the drawings folder was lost too, copy `files/` back from your off-machine copy.

## Updating

```bash
assembly-workflow update
```

It backs up the database, pulls the latest code and restarts. Database
changes in a new version are applied automatically on start. Open apps
reconnect on their own; reloading the page picks up the new version.

(Before this command existed, updating was `sudo deploy/update.sh` from
`/opt/assembly-workflow`. Run that once and the command gets installed.)

## Rarely needed

`legacy-auth off` stops checking old Supabase passwords after a migration:
from `/opt/assembly-workflow`, `sudo -u assembly env
DATA_DIR=/var/lib/assembly-workflow node server/cli.mjs legacy-auth off`.

## When something's wrong

- **The app says it can't reach the server.** Is the device on the tailnet
  (Tailscale app connected)? Does `assembly-workflow status` say it's
  running and show an address to open?
- **Someone forgot their password.** Team → Set password, or
  `assembly-workflow reset-password <login>`. Only an admin can do this;
  there is no email reset.
- **Where is my scan?** Scans run on the server and show at the top of
  the app for the person who started them, on any of their devices, until
  they're put away. A restart (an update, say) doesn't lose one: it runs
  again when the server is back.
- **Scans fail.** Settings → AI shows whether Ollama answers and which
  model does each job; **Test it** sends a real request. From the server,
  `assembly-workflow status` and `systemctl status ollama`. "Too large for the local model's context" is
  handled by splitting pages; if a scan still fails, raise the drawing
  context size under Advanced, or pick a vision model that uses fewer
  tokens per page (minicpm-v uses about a third of qwen2.5vl's).
- **The assistant ignores a document.** Knowledge → check it says
  "N passages" (a scanned PDF has no text layer and can't be searched). If
  the screen warns about a different embedding model, press Re-index.
- **The disk is filling up.** Team → Health shows the database, drawings
  and free space. Old backups beyond the last 14 are deleted automatically.
  AI models are the other big thing: `ollama list`, and `ollama rm <model>`
  for any you don't use.
- **Locked out of every admin account.** `assembly-workflow create-admin`.
