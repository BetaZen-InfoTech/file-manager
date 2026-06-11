#!/usr/bin/env bash
# Install cron jobs for File Manager SaaS.
# Idempotent: run as the user that owns /var/www/app.
#
# Usage: bash scripts/setup-cron.sh
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
ENV_FILE="$APP_DIR/.env"
PORT="${PORT:-3000}"

if [[ -f "$ENV_FILE" ]]; then
  # Parse line-by-line instead of `source`-ing: a value like MAIL_FROM's
  # "<...>" would crash a naive `source` ("syntax error near newline").
  set -a
  while IFS= read -r _line || [[ -n "$_line" ]]; do
    [[ -z "$_line" || "$_line" == \#* || "$_line" != *=* ]] && continue
    _key="${_line%%=*}"; _val="${_line#*=}"
    _val="${_val%\"}"; _val="${_val#\"}"; _val="${_val%\'}"; _val="${_val#\'}"
    printf -v "$_key" '%s' "$_val"; export "${_key?}"
  done < "$ENV_FILE"
  set +a
  unset _line _key _val
fi

if [[ -z "${INTERNAL_CRON_SECRET:-}" ]]; then
  echo "INTERNAL_CRON_SECRET is not set in $ENV_FILE — generate one with: openssl rand -hex 32"
  exit 1
fi

MARKER="# >>> filemanager cron >>>"
END_MARKER="# <<< filemanager cron <<<"

TMP="$(mktemp)"
crontab -l 2>/dev/null | sed "/$MARKER/,/$END_MARKER/d" > "$TMP" || true

cat >> "$TMP" <<EOF
$MARKER
# Expire links every 5 minutes
*/5 * * * * curl -fsS -H "x-cron-secret: $INTERNAL_CRON_SECRET" http://127.0.0.1:$PORT/api/internal/cron/expire-urls >/dev/null
# Purge trash older than 30 days, daily at 03:00 UTC
0 3 * * * curl -fsS -H "x-cron-secret: $INTERNAL_CRON_SECRET" http://127.0.0.1:$PORT/api/internal/cron/purge-trash >/dev/null
# Recount vendor usage weekly at Sunday 04:00 UTC
0 4 * * 0 curl -fsS -H "x-cron-secret: $INTERNAL_CRON_SECRET" http://127.0.0.1:$PORT/api/internal/cron/recount-usage >/dev/null
# Orphan storage sweep weekly at Sunday 05:00 UTC
0 5 * * 0 curl -fsS -H "x-cron-secret: $INTERNAL_CRON_SECRET" http://127.0.0.1:$PORT/api/internal/cron/orphan-sweep >/dev/null
# Daily backup at 02:30 UTC
30 2 * * * APP_DIR=$APP_DIR $APP_DIR/scripts/backup.sh >> /var/log/fms-backup.log 2>&1
$END_MARKER
EOF

crontab "$TMP"
rm "$TMP"

echo "Cron jobs installed. Verify with: crontab -l"
