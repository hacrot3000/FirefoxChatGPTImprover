#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Pass all arguments through to the Python release script.
# Common usage:
#   ./tools/build_firefox_addon.sh --overwrite           # local build only
#   ./tools/build_firefox_addon.sh --overwrite --publish # build + create GitHub Release
exec python3 "${SCRIPT_DIR}/release_firefox_addon.py" --overwrite "$@"

