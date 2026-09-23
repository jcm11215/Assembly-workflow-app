#!/usr/bin/env bash
# Installs the Assembly Workflow Tracker as a service on this machine.
#
#   sudo deploy/install.sh
#   sudo PORT=8095 deploy/install.sh     # choose the local port yourself
#
# Run from the folder the repository is cloned into (e.g. /opt/assembly-workflow).
# Safe to run again: it updates the service and restarts it.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE=assembly-workflow
PORT="${PORT:-}"

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

port_free(){ ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

# Keep the port of an install that is running; otherwise the first free
# one from 8080, since something else on the machine (a local AI server,
# say) may already have 8080.
if [[ -z "$PORT" ]] && systemctl is-active --quiet "$SERVICE" && [[ -f "/etc/systemd/system/${SERVICE}.service" ]]; then
  PORT="$(sed -n 's/^Environment=PORT=\([0-9]*\)$/\1/p' "/etc/systemd/system/${SERVICE}.service")"
fi
if [[ -z "$PORT" ]]; then
  systemctl stop "$SERVICE" 2>/dev/null || true
  for p in 8080 8090 8095 8100 8110 8120; do
    if port_free "$p"; then PORT="$p"; break; fi
  done
  [[ -n "$PORT" ]] || { echo "No free port found; run with PORT=<number>." >&2; exit 1; }
fi

# A system account with no login shell runs the app.
if ! id -u assembly >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/assembly-workflow --shell /usr/sbin/nologin assembly
  echo "Created system user 'assembly'."
fi

# The code is read by that account; it never writes here.
chmod -R a+rX "$APP_DIR"

sed -e "s#__APP_DIR__#${APP_DIR}#g" -e "s#__NODE__#${NODE}#g" -e "s#__PORT__#${PORT}#g" \
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

# Publish to the tailnet. The machine's main https address may already
# serve something else (a local AI); never replace it -- use port 8443 then.
if command -v tailscale >/dev/null 2>&1; then
  STATUS="$(tailscale serve status 2>&1 || true)"
  if grep -q "127.0.0.1:${PORT}\|localhost:${PORT}" <<<"$STATUS"; then
    echo "Already published by tailscale serve."
  elif grep -qi "no serve config" <<<"$STATUS" || [[ -z "$STATUS" ]]; then
    tailscale serve --bg "$PORT" >/dev/null && echo "Published to your tailnet."
  else
    tailscale serve --bg --https=8443 "$PORT" >/dev/null && echo "Published to your tailnet on port 8443 (the main address was already in use)."
  fi
  tailscale serve status 2>/dev/null | sed 's/^/  /' || true
else
  echo "Tailscale isn't installed yet. Once it is: sudo tailscale serve --bg ${PORT}"
fi

if ! command -v ollama >/dev/null 2>&1; then
  echo
  echo "For the local AI (drawings, the assistant and its knowledge base on this machine), install Ollama:"
  echo "  curl -fsSL https://ollama.com/install.sh | sh"
  echo "then pick models in the app under Settings -> AI. (Gemini or OpenRouter work without it.)"
fi
if systemctl list-unit-files localai.service >/dev/null 2>&1 && systemctl is-enabled --quiet localai 2>/dev/null; then
  echo
  echo "The old stand-alone Local AI service is still enabled. To move what it learned in and switch it off,"
  echo "see docs/MIGRATING.md, 'From the stand-alone Local AI Assistant'."
fi

CODE="$(journalctl -u "$SERVICE" -n 60 --no-pager 2>/dev/null | grep -A1 'setup code' | tail -1 | tr -d '[:space:]' || true)"
if [[ -n "$CODE" ]]; then
  echo
  echo "First-time setup: open the app and create the first admin with setup code: $CODE"
fi
