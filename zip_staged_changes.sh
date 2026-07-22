#!/usr/bin/env bash
set -euo pipefail

# Wrapper giữ command cũ, logic mới nằm ở tools/collect_code.py.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
exec python3 tools/collect_code.py changes "$@"
