#!/usr/bin/env bash
# Installs the Assembly Workflow Tracker as a service on this machine.
#
#   sudo deploy/install.sh
#
# Run from the folder the repository is cloned into (e.g. /opt/assembly-workflow).
# Safe to run again: it updates the service and restarts it.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE=assembly-workflow
PORT=8080

if [[ $EUID -ne 0 ]]; then
  echo "Run this with sudo: sudo $0" >&2
  exit 1
fi

NODE="$(command -v node || true)"
if [[ -z "$NODE" ]]; then
  echo "Node.js is not installed. Install Node.js 22.13 or newer first (see docs/INSTALL.md)." >&2
  exit 1
fi
if ! "$NODE" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)'; then
  echo "Node.js $("$NODE" --version) is too old; 22.13 or newer is needed (see docs/INSTALL.md)." >&2
  exit 1
fi

# A system account with no login shell runs the app.
if ! id -u assembly >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/assembly-workflow --shell /usr/sbin/nologin assembly
  echo "Created system user 'assembly'."
fi

# The code is read by that account; it never writes here.
chmod -R a+rX "$APP_DIR"

sed -e "s#__APP_DIR__#${APP_DIR}#g" -e "s#__NODE__#${NODE}#g" \
  "$APP_DIR/deploy/assembly-workflow.service" > "/etc/systemd/system/${SERVICE}.service"

systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
systemctl restart "$SERVICE"
sleep 2

if ! systemctl is-active --quiet "$SERVICE"; then
  echo "The service did not start. Its log:" >&2
  journalctl -u "$SERVICE" -n 40 --no-pager >&2
  exit 1
fi
echo "Service '$SERVICE' is running on http://127.0.0.1:${PORT} (data in /var/lib/assembly-workflow)."

if command -v tailscale >/dev/null 2>&1; then
  if tailscale serve --bg "$PORT" >/dev/null 2>&1; then
    echo "Published to your tailnet with tailscale serve:"
    tailscale serve status 2>/dev/null | sed 's/^/  /' || true
  else
    echo "Could not run 'tailscale serve'. Run it yourself: sudo tailscale serve --bg ${PORT}"
  fi
else
  echo "Tailscale isn't installed yet. Once it is: sudo tailscale serve --bg ${PORT}"
fi

CODE="$(journalctl -u "$SERVICE" -n 60 --no-pager 2>/dev/null | grep -A1 'setup code' | tail -1 | tr -d '[:space:]' || true)"
if [[ -n "$CODE" ]]; then
  echo
  echo "First-time setup: open the app and create the first admin with setup code: $CODE"
fi
