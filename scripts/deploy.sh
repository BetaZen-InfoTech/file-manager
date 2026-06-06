#!/usr/bin/env bash
# Re-pull, rebuild, reload — invoked by the GitHub webhook listener.
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/app}"
BRANCH="${DEPLOY_BRANCH:-main}"
LOG_PREFIX="$(date -u +%FT%TZ) [deploy]"

cd "$APP_DIR"
echo "$LOG_PREFIX starting"

git fetch --all --quiet
git reset --hard "origin/$BRANCH"

npm ci --silent
npm test
npm run build

pm2 reload filemanager --update-env

echo "$LOG_PREFIX done"
