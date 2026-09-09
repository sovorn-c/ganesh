#!/usr/bin/env bash
# Build the local story-to-code traceability matrix.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
STRICT=0
MODE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --strict) STRICT=1; shift ;;
    --json) MODE="json"; shift ;;
    --help|-h)
      echo "Usage: bash scripts/trace-stories.sh [--strict] [--json]"
      exit 0
      ;;
    *)
      echo "trace-stories.sh: unknown flag: $1" >&2
      exit 1
      ;;
  esac
done

exec ruby "$SCRIPT_DIR/lib/trace-stories.rb" "$REPO_ROOT" "$STRICT" "$MODE"
