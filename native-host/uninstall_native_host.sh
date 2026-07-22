#!/usr/bin/env bash
set -euo pipefail
INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/firefox-chat-ai-assistant"
MANIFEST_PATH="$HOME/.mozilla/native-messaging-hosts/com.duongtc.firefox_chat_assistant.json"
rm -f -- "$MANIFEST_PATH"
rm -rf -- "$INSTALL_DIR"
printf 'Removed native host manifest and installed host copy.\n'
