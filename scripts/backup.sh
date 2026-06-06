#!/usr/bin/env bash
# Daily backup of MongoDB and MinIO to a local backups dir.
# Configure: BACKUP_DIR, MONGODB_URI, S3_* (load .env first).
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/filemanager}"
DATE="$(date -u +%FT%H%M%SZ)"

mkdir -p "$BACKUP_DIR"

echo ">> Mongo dump"
mongodump --uri="$MONGODB_URI" --archive="$BACKUP_DIR/mongo-$DATE.archive" --gzip

echo ">> MinIO mirror"
if command -v mc >/dev/null 2>&1; then
  mc alias set src "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY"
  mc mirror --overwrite "src/$S3_DEFAULT_BUCKET" "$BACKUP_DIR/storage-$DATE"
else
  echo "(skipping MinIO mirror — mc not installed)"
fi

echo ">> Pruning backups older than 14 days"
find "$BACKUP_DIR" -mindepth 1 -mtime +14 -print -delete

echo ">> Done: $BACKUP_DIR"
