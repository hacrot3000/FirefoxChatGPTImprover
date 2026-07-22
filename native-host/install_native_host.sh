#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_HOST="$ROOT/native-host/native_host.py"
SOURCE_MANIFEST="$ROOT/native-host/manifest-template.json"
INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/firefox-chat-ai-assistant"
FIREFOX_MANIFEST_DIR="$HOME/.mozilla/native-messaging-hosts"
HOST_PATH="$INSTALL_DIR/native_host.py"
MANIFEST_PATH="$FIREFOX_MANIFEST_DIR/com.duongtc.firefox_chat_assistant.json"

[[ -f "$SOURCE_HOST" ]] || { echo "ERROR: missing $SOURCE_HOST" >&2; exit 1; }
[[ -f "$SOURCE_MANIFEST" ]] || { echo "ERROR: missing $SOURCE_MANIFEST" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 is required" >&2; exit 1; }

mkdir -p "$INSTALL_DIR" "$FIREFOX_MANIFEST_DIR"
install -m 0700 "$SOURCE_HOST" "$HOST_PATH"
python3 - "$SOURCE_MANIFEST" "$MANIFEST_PATH" "$HOST_PATH" <<'PY'
import json
from pathlib import Path
import sys
source, destination, host_path = map(Path, sys.argv[1:])
data = json.loads(source.read_text(encoding="utf-8"))
data["path"] = str(host_path.resolve())
destination.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
destination.chmod(0o600)
PY

python3 "$HOST_PATH" --self-test
printf 'Installed/updated native host:\n  host: %s\n  manifest: %s\n' "$HOST_PATH" "$MANIFEST_PATH"
printf 'Reload the add-on or restart the web-ext development session before testing.\n'
