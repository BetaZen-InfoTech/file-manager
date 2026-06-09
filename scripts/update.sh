#!/usr/bin/env bash
# ============================================================
# Update an existing install from GitHub.
# Run on the VPS after the first install:
#   cd /var/www/app && bash scripts/update.sh
#
# - Pulls latest main (or DEPLOY_BRANCH from env)
# - Installs deps from lockfile
# - Runs core-logic tests (fails fast if security logic regressed)
# - Production build
# - PM2 zero-downtime reload
# ============================================================
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
BRANCH="${DEPLOY_BRANCH:-main}"
TS="$(date -u +%FT%TZ)"

log() { printf "\n\033[1;36m[%s update] %s\033[0m\n" "$TS" "$*"; }

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
if [[ -f package-lock.json ]]; then
  npm ci --silent || npm install --silent
else
  npm install --silent
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
