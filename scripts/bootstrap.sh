#!/usr/bin/env bash
# Kept as an alias of setup.sh — the single installer is scripts/setup.sh.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
exec bash "$DIR/setup.sh" "$@"
