#!/usr/bin/env bash
# Quick local health check.
# Returns exit 0 if app + db + storage all OK, else exit 1.
set -e

PORT="${PORT:-3000}"
URL="http://127.0.0.1:$PORT/api/health"

RES="$(curl -fsS --max-time 10 "$URL" 2>&1 || true)"
echo "$RES"
if echo "$RES" | grep -q '"ok":true'; then
  exit 0
fi
exit 1
