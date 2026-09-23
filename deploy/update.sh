#!/usr/bin/env bash
# Gets the latest code and restarts the app, taking a database backup
# first so an update can always be rolled back. `assembly-workflow update`
# runs this.
#
#   sudo deploy/update.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR=/var/lib/assembly-workflow

if [[ $EUID -ne 0 ]]; then
  echo "Run this with sudo: sudo $0" >&2
  exit 1
fi

cd "$APP_DIR"
echo "Backing up the database…"
runuser -u assembly -- env DATA_DIR="$DATA_DIR" "$(command -v node)" --disable-warning=ExperimentalWarning server/cli.mjs backup

# The checkout belongs to whoever cloned it; pull as them, not as root.
OWNER="$(stat -c %U "$APP_DIR")"
BEFORE="$(git -c safe.directory="$APP_DIR" -C "$APP_DIR" rev-parse --short HEAD)"
runuser -u "$OWNER" -- git -C "$APP_DIR" pull --ff-only
AFTER="$(git -c safe.directory="$APP_DIR" -C "$APP_DIR" log -1 --format='%h %s')"
if [[ "$BEFORE" == "${AFTER%% *}" ]]; then
  echo "Already up to date ($AFTER). Restarting anyway."
else
  echo "Updated to $AFTER."
fi

# The install script (from the code just pulled) refreshes the service and
# the admin command, then restarts.
exec "$APP_DIR/deploy/install.sh" --update
