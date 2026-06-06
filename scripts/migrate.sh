#!/usr/bin/env bash
# Migrate Mongo + MinIO + .env from this VPS to a new one.
# Usage: ./scripts/migrate.sh <NEW_VPS_USER@HOST>
set -euo pipefail

NEW_HOST="${1:-}"
if [[ -z "$NEW_HOST" ]]; then
  echo "Usage: ./migrate.sh user@new.vps.ip"
  exit 1
fi

: "${MONGODB_URI:?MONGODB_URI required (load from .env first)}"
: "${S3_ACCESS_KEY:?S3_ACCESS_KEY required}"
: "${S3_SECRET_KEY:?S3_SECRET_KEY required}"
: "${S3_ENDPOINT:?S3_ENDPOINT required}"
: "${S3_DEFAULT_BUCKET:?S3_DEFAULT_BUCKET required}"

APP_DIR="${APP_DIR:-/var/www/app}"
ARCHIVE="/tmp/db.archive"

echo ">> 1) Turn maintenance ON on this server"
curl -fsS -X POST "$APP_URL/api/v1/admin/maintenance" \
  -H "content-type: application/json" \
  -H "Cookie: $ADMIN_COOKIE" \
  -d '{"enabled":true,"message":"Migrating — back shortly."}' || true

echo ">> 2) mongodump"
mongodump --uri="$MONGODB_URI" --archive="$ARCHIVE" --gzip

echo ">> 3) scp archive to new host"
scp "$ARCHIVE" "$NEW_HOST:/tmp/db.archive"

echo ">> 4) mongorestore on new host (assumes MONGODB_URI matches)"
ssh "$NEW_HOST" "mongorestore --uri=\"$MONGODB_URI\" --archive=/tmp/db.archive --gzip --drop"

echo ">> 5) mc mirror MinIO bucket(s)"
if ! command -v mc >/dev/null 2>&1; then
  echo "Install MinIO client (mc) on this server first."
  exit 2
fi
mc alias set src "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY"
ssh "$NEW_HOST" "command -v mc >/dev/null 2>&1 || (curl -fsSL https://dl.min.io/client/mc/release/linux-amd64/mc -o /usr/local/bin/mc && chmod +x /usr/local/bin/mc)"
ssh "$NEW_HOST" "mc alias set dst $S3_ENDPOINT $S3_ACCESS_KEY $S3_SECRET_KEY && mc mb --ignore-existing dst/$S3_DEFAULT_BUCKET"
mc mirror --overwrite "src/$S3_DEFAULT_BUCKET" "dst/$S3_DEFAULT_BUCKET" || true

echo ">> 6) Copy .env + nginx config"
scp "$APP_DIR/.env" "$NEW_HOST:/tmp/.env.fms"
scp /etc/nginx/sites-available/filemanager "$NEW_HOST:/tmp/filemanager.nginx" 2>/dev/null || true
ssh "$NEW_HOST" "sudo mv /tmp/.env.fms $APP_DIR/.env && sudo chown www-data:www-data $APP_DIR/.env || true"
ssh "$NEW_HOST" "sudo mv /tmp/filemanager.nginx /etc/nginx/sites-available/filemanager && sudo ln -sf /etc/nginx/sites-available/filemanager /etc/nginx/sites-enabled/filemanager && sudo nginx -t && sudo systemctl reload nginx" || true

echo ">> 7) Build + restart on new host"
ssh "$NEW_HOST" "cd $APP_DIR && npm ci && npm run build && pm2 startOrReload ecosystem.config.js && pm2 save"

echo ">> Done. Now switch DNS to the new VPS, then turn maintenance OFF."
