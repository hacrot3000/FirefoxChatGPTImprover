#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Rebuilding the same development version is an intentional local workflow.
exec python3 "${SCRIPT_DIR}/release_firefox_addon.py" --overwrite "$@"
