#!/usr/bin/env bash
# Run the deterministic blind-spot detector without external Python packages.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PYTHON_BIN="${PYTHON:-python3}"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "check-blind-spots.sh: python3 is required" >&2
  exit 1
fi
if [[ ! -f "$REPO_ROOT/specs/execution-status.yaml" ]]; then
  echo "check-blind-spots.sh: specs/execution-status.yaml is missing" >&2
  exit 1
fi

exec "$PYTHON_BIN" "$SCRIPT_DIR/lib/blind-spots.py" \
  "$REPO_ROOT" \
  "$REPO_ROOT/specs/blind-spots.json" \
  "$REPO_ROOT/specs/execution-status.yaml" \
  "$REPO_ROOT/specs/traceability-matrix.json" \
  "$REPO_ROOT/specs/verifications" \
  "$REPO_ROOT/specs/epics"
