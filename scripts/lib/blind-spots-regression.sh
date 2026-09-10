#!/usr/bin/env bash
# Regression check for unquoted and nested execution-status values.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PYTHON_BIN="${PYTHON:-python3}"
FIXTURE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ganesh-blind-spots.XXXXXX")"
trap 'rm -rf "$FIXTURE_ROOT"' EXIT

mkdir "$FIXTURE_ROOT/verifications"
cat > "$FIXTURE_ROOT/execution-status.yaml" <<'YAML'
development_status:
  e01: in_progress
epics:
  e01:
    stories:
      e01s01:
        status: done
YAML

if "$PYTHON_BIN" "$SCRIPT_DIR/blind-spots.py" \
  "$REPO_ROOT" \
  "$FIXTURE_ROOT/blind-spots.json" \
  "$FIXTURE_ROOT/execution-status.yaml" \
  "$REPO_ROOT/specs/traceability-matrix.json" \
  "$FIXTURE_ROOT/verifications" \
  "$REPO_ROOT/specs/epics" > "$FIXTURE_ROOT/output"; then
  echo "blind-spots regression: expected a HIGH finding" >&2
  exit 1
fi

grep -q "verify-gap" "$FIXTURE_ROOT/output"
echo "blind-spots regression: nested unquoted status produced a non-zero gate"
