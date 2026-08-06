#!/usr/bin/env bash
set -euo pipefail
HOST_NAME="com.duongtc.firefox_chat_assistant.json"
REMOVE_HOST=0
BROWSER="all"
while (($#)); do
  case "$1" in
    --browser) BROWSER="${2:-}"; shift 2 ;;
    --remove-host) REMOVE_HOST=1; shift ;;
    -h|--help)
      echo "Usage: $0 [--browser chromium|chrome|edge|all] [--remove-host]"
      exit 0
      ;;
    *) echo "ERROR: unknown option: $1" >&2; exit 2 ;;
  esac
done
case "$BROWSER" in chromium|chrome|edge|all) ;; *) echo "ERROR: invalid --browser: $BROWSER" >&2; exit 2 ;; esac

TARGETS=("$BROWSER")
[[ "$BROWSER" == "all" ]] && TARGETS=(chromium chrome edge)
for target in "${TARGETS[@]}"; do
  case "$target" in
    chrome) directory="$HOME/.config/google-chrome/NativeMessagingHosts" ;;
    chromium) directory="$HOME/.config/chromium/NativeMessagingHosts" ;;
    edge) directory="$HOME/.config/microsoft-edge/NativeMessagingHosts" ;;
  esac
  rm -f -- "$directory/$HOST_NAME"
  printf 'Removed %s Native Host manifest.\n' "$target"
done
if ((REMOVE_HOST)); then
  rm -rf -- "${XDG_DATA_HOME:-$HOME/.local/share}/firefox-chat-ai-assistant"
  printf 'Removed the shared installed Native Host copy.\n'
fi
