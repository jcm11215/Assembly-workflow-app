#!/usr/bin/env bash
# Installs the Assembly Workflow Tracker on this machine, with everything
# it needs, in one go:
#
#   sudo deploy/install.sh
#
# Run from the folder the repository is cloned into (e.g. /opt/assembly-workflow).
# It asks before installing anything else (Node.js, Ollama, AI models) and
# before touching an old Local AI install. Safe to run again: it updates
# the service and restarts it.
#
#   sudo PORT=8095 deploy/install.sh     choose the local port yourself
#   sudo deploy/install.sh --update      no questions; what `assembly-workflow update` runs
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE=assembly-workflow
DATA_DIR=/var/lib/assembly-workflow
PORT="${PORT:-}"
UPDATE=0
[[ "${1:-}" == "--update" ]] && UPDATE=1

# The models the app's one-click AI setup would download (server/models.mjs).
AI_MODELS=(nomic-embed-text qwen2.5:7b qwen2.5vl:7b)

if [[ $EUID -ne 0 ]]; then
  echo "Run this with sudo: sudo $0" >&2
  exit 1
fi

say(){ printf '\n\033[1m%s\033[0m\n' "$*"; }
# Yes/no, defaulting to yes. Without a terminal (or when updating), no --
# nothing gets installed that nobody agreed to.
ask(){
  [[ $UPDATE == 0 && -t 0 ]] || return 1
  local a
  read -r -p "$1 [Y/n] " a || a=n
  [[ -z "$a" || "$a" =~ ^[Yy] ]]
}
need_curl(){
  command -v curl >/dev/null 2>&1 && return
  command -v apt-get >/dev/null 2>&1 && apt-get install -y curl >/dev/null
  command -v curl >/dev/null 2>&1 || { echo "curl is needed for this; install it and run this again." >&2; exit 1; }
}
port_free(){ ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
node_ok(){ [[ -n "$NODE" ]] && "$NODE" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)'; }

# ---- Node.js ----
NODE="$(command -v node || true)"
if ! node_ok; then
  echo "Node.js 22.13 or newer is needed${NODE:+ (this machine has $("$NODE" --version))}."
  if command -v apt-get >/dev/null 2>&1 && ask "Install Node.js 22 now?"; then
    need_curl
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
    NODE="$(command -v node || true)"
  fi
  node_ok || { echo "Install Node.js 22.13 or newer, then run this again (see docs/INSTALL.md)." >&2; exit 1; }
fi

# ---- the AI engine ----
ollama_up(){ curl -fsS --max-time 3 http://127.0.0.1:11434/api/version >/dev/null 2>&1; }
if [[ $UPDATE == 0 ]]; then
  if ! command -v ollama >/dev/null 2>&1; then
    say "The AI (reading drawings, the assistant) runs in Ollama, which isn't installed."
    if ask "Install Ollama now?"; then
      need_curl
      curl -fsSL https://ollama.com/install.sh | sh
      for _ in 1 2 3 4 5 6 7 8 9 10; do ollama_up && break; sleep 1; done
    else
      echo "Later: curl -fsSL https://ollama.com/install.sh | sh"
    fi
  fi
  if ollama_up; then
    missing=()
    for m in "${AI_MODELS[@]}"; do
      name="$m"; [[ "$name" == *:* ]] || name="$name:latest"
      curl -fsS http://127.0.0.1:11434/api/tags | grep -q "\"name\":\"$name\"" || missing+=("$m")
    done
    if (( ${#missing[@]} )); then
      say "The AI needs ${#missing[@]} model(s): ${missing[*]} (about 11 GB in all, free)."
      if ask "Download them now? It can take a while."; then
        for m in "${missing[@]}"; do ollama pull "$m"; done
      else
        echo "Later: in the app, Settings -> AI -> Set up the AI."
      fi
    fi
  fi
fi

# ---- the app ----
say "Installing the app…"

# Keep the port of an install that is running; otherwise the first free
# one from 8080, since something else on the machine may already have 8080.
if [[ -z "$PORT" ]] && [[ -f "/etc/systemd/system/${SERVICE}.service" ]]; then
  PORT="$(sed -n 's/^Environment=PORT=\([0-9]*\)$/\1/p' "/etc/systemd/system/${SERVICE}.service")"
fi
if [[ -z "$PORT" ]]; then
  for p in 8080 8090 8095 8100 8110 8120; do
    if port_free "$p"; then PORT="$p"; break; fi
  done
  [[ -n "$PORT" ]] || { echo "No free port found; run with PORT=<number>." >&2; exit 1; }
fi

# A system account with no login shell runs the app.
if ! id -u assembly >/dev/null 2>&1; then
  useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin assembly
  echo "Created system user 'assembly'."
fi

# The code is read by that account; it never writes here.
chmod -R a+rX "$APP_DIR"

sed -e "s#__APP_DIR__#${APP_DIR}#g" -e "s#__NODE__#${NODE}#g" -e "s#__PORT__#${PORT}#g" \
  "$APP_DIR/deploy/assembly-workflow.service" > "/etc/systemd/system/${SERVICE}.service"
sed -e "s#__APP_DIR__#${APP_DIR}#g" -e "s#__NODE__#${NODE}#g" \
  "$APP_DIR/deploy/assembly-workflow" > /usr/local/bin/assembly-workflow
chmod 0755 /usr/local/bin/assembly-workflow

systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
systemctl restart "$SERVICE"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  systemctl is-active --quiet "$SERVICE" && ! port_free "$PORT" && break
  sleep 1
done
if ! systemctl is-active --quiet "$SERVICE"; then
  echo "The app did not start. Its log:" >&2
  journalctl -u "$SERVICE" -n 40 --no-pager >&2
  exit 1
fi

# ---- the old Local AI ----
if [[ $UPDATE == 0 ]]; then
  OLD_DB="$(ls -1 /home/*/localai/data/memory.db 2>/dev/null | head -1 || true)"
  if [[ -n "$OLD_DB" && ! -f "$DATA_DIR/.localai-imported" ]]; then
    OLD_DIR="$(dirname "$(dirname "$OLD_DB")")"
    say "Found the old Local AI in $OLD_DIR."
    if ask "Bring in its documents and corrections? (Nothing there is changed.)"; then
      (cd "$APP_DIR" && env DATA_DIR="$DATA_DIR" "$NODE" --disable-warning=ExperimentalWarning server/cli.mjs import-localai "$OLD_DIR") \
        && touch "$DATA_DIR/.localai-imported"
      chown -R assembly:assembly "$DATA_DIR"
    fi
  fi
  if systemctl is-enabled --quiet localai 2>/dev/null; then
    if ask "Switch off the old Local AI service? This app does its job now."; then
      systemctl disable --now localai && echo "Switched off. (Its files are left where they are.)"
    fi
  fi
fi

# ---- the tailnet ----
# Publish with HTTPS on the tailnet. The machine's main address may serve
# something else; that is never replaced while it is running -- the app
# goes on port 8443 instead.
URL=""
if command -v tailscale >/dev/null 2>&1; then
  STATUS="$(tailscale serve status 2>&1 || true)"
  target_of_main(){ awk '/^https:\/\//{ main = ($1 !~ /:[0-9]+$/) } main && /proxy/ { if (match($0, /:[0-9]+/)) { print substr($0, RSTART + 1, RLENGTH - 1); exit } }' <<<"$STATUS"; }
  served_here(){ grep -Eq "(127\.0\.0\.1|localhost):${PORT}([^0-9]|$)" <<<"$STATUS"; }
  MAIN="$(target_of_main)"
  if [[ "$MAIN" == "$PORT" ]]; then
    :
  elif grep -qi "no serve config" <<<"$STATUS" || [[ -z "$STATUS" ]]; then
    tailscale serve --bg "$PORT" >/dev/null && echo "Published to your tailnet."
  elif [[ -n "$MAIN" ]] && port_free "$MAIN"; then
    # What had the main address has stopped (the old Local AI, say).
    tailscale serve --https=443 off >/dev/null 2>&1 || true
    tailscale serve --bg "$PORT" >/dev/null && echo "Published to your tailnet on its main address (what had it isn't running)."
  elif ! served_here; then
    tailscale serve --bg --https=8443 "$PORT" >/dev/null && echo "Published to your tailnet on port 8443 (the main address is in use)."
  fi
  URL="$(tailscale serve status 2>/dev/null | awk -v re="(127\\.0\\.0\\.1|localhost):${PORT}([^0-9]|$)" \
    '/^https?:\/\//{ url = $1 } $0 ~ re && /proxy/ { print url; exit }')"
fi

# ---- done ----
# Before anyone has signed up, the app writes the code for making the
# first admin as it starts.
CODE=""
if [[ $UPDATE == 0 ]]; then
  for _ in 1 2 3; do
    [[ -s "$DATA_DIR/setup-code" ]] && { CODE="$(cat "$DATA_DIR/setup-code")"; break; }
    sleep 1
  done
fi

say "Assembly Workflow is running."
if [[ -n "$URL" ]]; then
  echo "  Open it at   $URL"
else
  echo "  On this machine   http://127.0.0.1:${PORT}"
  command -v tailscale >/dev/null 2>&1 || echo "  To reach it from other devices, install Tailscale, then run this again."
fi
[[ -n "$CODE" ]] && echo "  Setup code   $CODE   (create the first admin with it)"
if [[ $UPDATE == 0 ]]; then
  if ollama_up; then
    echo "  AI           finish in the app: Settings -> AI (one click, if anything is missing)"
  else
    echo "  AI           needs Ollama: curl -fsSL https://ollama.com/install.sh | sh"
  fi
  echo "  Look after it with: assembly-workflow help"
fi
