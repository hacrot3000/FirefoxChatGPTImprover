#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BROWSER="${FCI_CHROMIUM_BROWSER:-chromium}"
BINARY="${FCI_CHROMIUM_BIN:-}"
PROFILE="${FCI_CHROMIUM_PROFILE:-$ROOT/.chromium-dev-profile}"

case "$BROWSER" in
  chrome) DEFAULT_BIN="google-chrome" ;;
  edge) DEFAULT_BIN="microsoft-edge" ;;
  chromium) DEFAULT_BIN="chromium" ;;
  *) echo "ERROR: FCI_CHROMIUM_BROWSER must be chromium, chrome or edge" >&2; exit 2 ;;
esac
BINARY="${BINARY:-$DEFAULT_BIN}"
command -v "$BINARY" >/dev/null 2>&1 || { echo "ERROR: browser executable not found: $BINARY" >&2; exit 1; }
"$ROOT/tools/build_chromium_addon.sh" --browser "$BROWSER" --overwrite --skip-tests
VERSION="$(python3 - <<'PY_VERSION' "$ROOT/extension/manifest.json"
import json
import sys
from pathlib import Path
print(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))["version"])
PY_VERSION
)"
UNPACKED="$ROOT/releases/chromium/$BROWSER/$VERSION/unpacked"
exec "$BINARY" --user-data-dir="$PROFILE" --disable-extensions-except="$UNPACKED" --load-extension="$UNPACKED" "$@"
