#!/usr/bin/env bash
# Kept as an alias of setup.sh — the single installer is scripts/setup.sh.
# Forwards positional REPO_URL as --repo for backwards compatibility.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ "${1:-}" == --* ]] || [[ -z "${1:-}" ]]; then
  exec bash "$DIR/setup.sh" "$@"
fi
exec bash "$DIR/setup.sh" --repo "$1" "${@:2}"
