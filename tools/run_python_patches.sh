#!/usr/bin/env bash
# Python Patch Tool v5.15.2 portable launcher
# P0 fixes: selection integrity + adaptive sandbox performance fallback.
set -euo pipefail
TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$TOOLS_DIR/.." && pwd)"
LIB_DIR="$TOOLS_DIR/_patch_lib"
RUNNER="$LIB_DIR/python_patch_runner.py"
GUARD="$LIB_DIR/python_patch_runtime_guard.py"

if [ ! -f "$RUNNER" ]; then
  echo "ERROR: Missing Patch Tool core: $RUNNER" >&2
  echo "This v5.15.2 package is a direct upgrade for a standard v5.15.0/v5.15.1 installation." >&2
  exit 2
fi
if [ ! -f "$GUARD" ]; then
  echo "ERROR: Missing Patch Tool v5.15.2 runtime guard: $GUARD" >&2
  exit 2
fi

export PYTHONPATH="$LIB_DIR${PYTHONPATH:+:$PYTHONPATH}"
exec python3 "$GUARD" --project-root "$PROJECT_ROOT" --runner "$RUNNER" -- "$@"
