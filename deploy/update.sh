#!/usr/bin/env bash
# Pulls the latest code and restarts the service. Takes a database backup
# first, so an update can always be rolled back.
#
#   sudo deploy/update.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE=assembly-workflow

if [[ $EUID -ne 0 ]]; then
  echo "Run this with sudo: sudo $0" >&2
  exit 1
fi

cd "$APP_DIR"
echo "Backing up the database…"
sudo -u assembly env DATA_DIR=/var/lib/assembly-workflow node --disable-warning=ExperimentalWarning server/cli.mjs backup

# The checkout belongs to whoever cloned it; pull as them, not as root.
OWNER="$(stat -c %U "$APP_DIR")"
sudo -u "$OWNER" git -C "$APP_DIR" pull --ff-only
chmod -R a+rX "$APP_DIR"

systemctl restart "$SERVICE"
sleep 2
if systemctl is-active --quiet "$SERVICE"; then
  echo "Updated to $(git -C "$APP_DIR" log -1 --format='%h %s') and restarted."
else
  echo "The service did not come back up. Its log:" >&2
  journalctl -u "$SERVICE" -n 40 --no-pager >&2
  exit 1
fi
