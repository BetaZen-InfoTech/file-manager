#!/usr/bin/env bash
# ============================================================
# Update an existing install from GitHub.
#
# Three ways to run it (all equivalent):
#   sudo fms-upgrade                                  # global command (installed by setup.sh)
#   cd /var/www/app && bash scripts/update.sh         # from the repo
#   curl -fsSL <raw>/scripts/update.sh | sudo bash    # one-line, from anywhere
#
# - Pulls latest main (or DEPLOY_BRANCH from env)
# - Installs deps  - Runs core-logic tests  - Production build  - PM2 reload
# ============================================================
set -euo pipefail

# Resolve the app directory: explicit APP_DIR > the script's own repo (when run
# from a checkout) > the default install location. The repo-detection lets the
# script also work when piped via `curl | bash` (where $0 isn't a real path).
if [[ -z "${APP_DIR:-}" ]]; then
  SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." 2>/dev/null && pwd || true)"
  if [[ -n "$SELF_DIR" && -d "$SELF_DIR/.git" ]]; then
    APP_DIR="$SELF_DIR"
  else
    APP_DIR="/var/www/app"
  fi
fi
BRANCH="${DEPLOY_BRANCH:-main}"
TS="$(date -u +%FT%TZ)"

log() { printf "\n\033[1;36m[%s update] %s\033[0m\n" "$TS" "$*"; }
err() { printf "\n\033[1;31m[%s update] %s\033[0m\n" "$TS" "$*" >&2; }

if [[ ! -d "$APP_DIR/.git" ]]; then
  err "No install found at $APP_DIR. Set APP_DIR=/path/to/app, or run the installer first."
  exit 1
fi
cd "$APP_DIR"

log "Fetching $BRANCH"
git fetch --all --quiet
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"
if [[ "$LOCAL" == "$REMOTE" ]]; then
  log "Already at origin/$BRANCH ($LOCAL). Forcing rebuild anyway? Set FORCE=1 to do so."
  if [[ "${FORCE:-0}" != "1" ]]; then
    exit 0
  fi
fi

log "Resetting to origin/$BRANCH"
git reset --hard "origin/$BRANCH"

log "Installing dependencies"
# Not silent: npm errors (ERESOLVE, network, disk) must be visible — a silent
# failure under `set -e` would abort the whole update with no clue why.
if [[ -f package-lock.json ]]; then
  npm ci --no-audit --no-fund || npm install --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi

log "Running core-logic tests"
npm test

log "Building"
npm run build

log "Reloading PM2 (zero downtime)"
if pm2 jlist 2>/dev/null | grep -q '"name":"filemanager"'; then
  pm2 reload filemanager --update-env
else
  pm2 start ecosystem.config.js
fi
pm2 save >/dev/null 2>&1 || true

log "Done. New HEAD: $(git rev-parse --short HEAD)"
