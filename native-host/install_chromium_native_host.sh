#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_HOST="$ROOT/native-host/native_host.py"
SOURCE_MANIFEST="$ROOT/native-host/chromium-manifest-template.json"
INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/firefox-chat-ai-assistant"
HOST_PATH="$INSTALL_DIR/native_host.py"
HOST_NAME="com.duongtc.firefox_chat_assistant"
BROWSER="chromium"
EXTENSION_ID=""

usage() {
  cat <<'TXT'
Usage: native-host/install_chromium_native_host.sh [options]

Options:
  --browser chromium|chrome|edge|all   Browser manifest location (default: chromium)
  --extension-id ID                    Override the locally derived extension ID
  -h, --help                           Show this help
TXT
}

while (($#)); do
  case "$1" in
    --browser) BROWSER="${2:-}"; shift 2 ;;
    --extension-id) EXTENSION_ID="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done
case "$BROWSER" in chromium|chrome|edge|all) ;; *) echo "ERROR: invalid --browser: $BROWSER" >&2; exit 2 ;; esac

[[ -f "$SOURCE_HOST" ]] || { echo "ERROR: missing $SOURCE_HOST" >&2; exit 1; }
[[ -f "$SOURCE_MANIFEST" ]] || { echo "ERROR: missing $SOURCE_MANIFEST" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 is required" >&2; exit 1; }
if [[ -z "$EXTENSION_ID" ]]; then
  EXTENSION_ID="$(python3 "$ROOT/tools/build_chromium_addon.py" --print-extension-id)"
fi
[[ "$EXTENSION_ID" =~ ^[a-p]{32}$ ]] || { echo "ERROR: invalid Chromium extension ID: $EXTENSION_ID" >&2; exit 2; }

manifest_dir() {
  case "$1" in
    chrome) printf '%s\n' "$HOME/.config/google-chrome/NativeMessagingHosts" ;;
    chromium) printf '%s\n' "$HOME/.config/chromium/NativeMessagingHosts" ;;
    edge) printf '%s\n' "$HOME/.config/microsoft-edge/NativeMessagingHosts" ;;
  esac
}

mkdir -p "$INSTALL_DIR"
install -m 0700 "$SOURCE_HOST" "$HOST_PATH"
TARGETS=("$BROWSER")
[[ "$BROWSER" == "all" ]] && TARGETS=(chromium chrome edge)
for target in "${TARGETS[@]}"; do
  directory="$(manifest_dir "$target")"
  destination="$directory/$HOST_NAME.json"
  mkdir -p "$directory"
  python3 - "$SOURCE_MANIFEST" "$destination" "$HOST_PATH" "$EXTENSION_ID" <<'PY'
import json
from pathlib import Path
import sys
source, destination, host_path = map(Path, sys.argv[1:4])
extension_id = sys.argv[4]
data = json.loads(source.read_text(encoding="utf-8"))
data["path"] = str(host_path.resolve())
data["allowed_origins"] = [f"chrome-extension://{extension_id}/"]
destination.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
destination.chmod(0o600)
PY
  printf 'Installed %s Native Host manifest: %s\n' "$target" "$destination"
done

python3 "$HOST_PATH" --self-test
printf 'Native Host: %s\nExtension ID: %s\n' "$HOST_PATH" "$EXTENSION_ID"
printf 'Reload the unpacked extension or restart the browser before testing Native Host actions.\n'
