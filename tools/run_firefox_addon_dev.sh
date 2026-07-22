#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
EXTENSION_DIR="${EXTENSION_DIR:-${PROJECT_ROOT}/extension}"
WEB_EXT_HOME="${PROJECT_ROOT}/.firefox-dev-tools"
WEB_EXT_BIN="${WEB_EXT_HOME}/node_modules/.bin/web-ext"
FIREFOX_BIN="${FIREFOX_BIN:-$(command -v firefox || true)}"

if [ ! -f "${EXTENSION_DIR}/manifest.json" ]; then
    echo "ERROR: extension manifest not found: ${EXTENSION_DIR}/manifest.json"
    echo "Phase 01 must create the WebExtension skeleton before this tool can run."
    exit 1
fi

if [ ! -x "${WEB_EXT_BIN}" ]; then
    echo "ERROR: web-ext is not installed locally: ${WEB_EXT_BIN}"
    echo "Run: ./tools/setup_firefox_addon_dev.sh"
    exit 1
fi

if [ -z "${FIREFOX_BIN}" ] || [ ! -x "${FIREFOX_BIN}" ]; then
    echo "ERROR: Firefox binary was not found."
    echo "Set it explicitly, for example:"
    echo "  FIREFOX_BIN=/usr/bin/firefox ./tools/run_firefox_addon_dev.sh"
    exit 1
fi

ARGS=(
    run
    --source-dir "${EXTENSION_DIR}"
    --firefox "${FIREFOX_BIN}"
)

if [ -n "${WEB_EXT_FIREFOX_PROFILE:-}" ]; then
    ARGS+=(
        --firefox-profile "${WEB_EXT_FIREFOX_PROFILE}"
        --profile-create-if-missing
    )
    if [ "${WEB_EXT_KEEP_PROFILE_CHANGES:-0}" = "1" ]; then
        ARGS+=(--keep-profile-changes)
    fi
fi

if [ -n "${FIREFOX_CHAT_URL:-}" ]; then
    ARGS+=(--start-url "${FIREFOX_CHAT_URL}")
fi

if [ "${WEB_EXT_BROWSER_CONSOLE:-0}" = "1" ]; then
    ARGS+=(--browser-console)
fi

echo "Project root : ${PROJECT_ROOT}"
echo "Extension    : ${EXTENSION_DIR}"
echo "Firefox      : ${FIREFOX_BIN}"
echo "web-ext      : ${WEB_EXT_BIN}"
if [ -n "${WEB_EXT_FIREFOX_PROFILE:-}" ]; then
    echo "Base profile : ${WEB_EXT_FIREFOX_PROFILE}"
    if [ "${WEB_EXT_KEEP_PROFILE_CHANGES:-0}" = "1" ]; then
        echo "Profile mode : keep changes (development-only profile required)"
    else
        echo "Profile mode : copied to a temporary profile; changes are not persisted"
    fi
else
    echo "Profile      : temporary profile managed by web-ext"
fi
if [ -n "${FIREFOX_CHAT_URL:-}" ]; then
    echo "Start URL    : ${FIREFOX_CHAT_URL}"
fi

echo
echo "Source watching and automatic extension reload are enabled by web-ext."
echo "Press Ctrl+C to stop this development session."
echo

exec "${WEB_EXT_BIN}" "${ARGS[@]}" "$@"
