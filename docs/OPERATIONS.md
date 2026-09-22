# Running it day to day

Everything the app keeps is in **`/var/lib/assembly-workflow`**:

```
assembly.db        the database (jobs, people, checklists, notes, …)
files/<job>/…      every drawing ever uploaded, named as uploaded
backups/           nightly copies of the database
```

## Backups

The server copies the database to `backups/` every night (after 2 am, or
when it next starts if it was off) and keeps the last 14. **Admin → Health**
shows when the last one ran.

That copy is on the same disk, so it guards against mistakes, not a dead
drive. Copy the folder somewhere else regularly -- another machine, a NAS,
a USB drive. The drawings never change once saved, so a plain `rsync` is
enough:

```bash
# e.g. nightly from cron on another machine on the tailnet
rsync -a shop-server:/var/lib/assembly-workflow/backups/ /mnt/nas/assembly/backups/
rsync -a shop-server:/var/lib/assembly-workflow/files/   /mnt/nas/assembly/files/
```

A backup right now: `sudo -u assembly env DATA_DIR=/var/lib/assembly-workflow node server/cli.mjs backup`
(run from `/opt/assembly-workflow`).

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
cd /opt/assembly-workflow
sudo deploy/update.sh
```

It backs up the database, pulls the latest code and restarts. Database
changes in a new version are applied automatically on start. Open apps
reconnect on their own; reloading the page picks up the new version.

## Logs and status

```bash
systemctl status assembly-workflow
journalctl -u assembly-workflow -f          # follow the log
tailscale serve status                      # the https address
```

## Admin tasks from the terminal

Run from `/opt/assembly-workflow` as `sudo -u assembly env DATA_DIR=/var/lib/assembly-workflow node server/cli.mjs <command>`:

| Command | Does |
| --- | --- |
| `users` | lists every login |
| `create-admin` | makes an admin login (asks for the details) |
| `set-password <login>` | sets a password and signs that person out everywhere |
| `backup` | writes a database backup now |
| `legacy-auth off` | stops checking old Supabase passwords (after a migration) |

## When something's wrong

- **The app says it can't reach the server.** Is the device on the tailnet
  (Tailscale app connected)? Is the service running (`systemctl status
  assembly-workflow`)? Does `tailscale serve status` still show port 8080?
- **Someone forgot their password.** Admin → Team → Set password. Only an
  admin can do this; there is no email reset.
- **Scans fail.** Settings → AI → Test the saved settings. The message is
  the provider's own ("API key not valid", "quota exceeded"). For the local
  AI, check its address works *from the server*: `curl <address>/v1/models`.
- **The disk is filling up.** Admin → Health shows the database, drawings
  and free space. Old backups beyond the last 14 are deleted automatically.
- **Locked out of every admin account.** `create-admin` from the terminal.
