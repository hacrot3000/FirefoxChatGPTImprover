#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WEB_EXT_HOME="${PROJECT_ROOT}/.firefox-dev-tools"

if ! command -v node >/dev/null 2>&1; then
    echo "ERROR: node was not found in PATH."
    echo "Install Node.js using your normal development environment, then run this script again."
    exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
    echo "ERROR: npm was not found in PATH."
    echo "Install npm using your normal development environment, then run this script again."
    exit 1
fi

mkdir -p -- "${WEB_EXT_HOME}"

echo "Installing/updating web-ext locally in: ${WEB_EXT_HOME}"
npm install \
    --prefix "${WEB_EXT_HOME}" \
    --no-audit \
    --no-fund \
    web-ext

WEB_EXT_BIN="${WEB_EXT_HOME}/node_modules/.bin/web-ext"
if [ ! -x "${WEB_EXT_BIN}" ]; then
    echo "ERROR: web-ext binary was not created: ${WEB_EXT_BIN}"
    exit 1
fi

echo
echo "DONE: local web-ext is ready."
"${WEB_EXT_BIN}" --version

echo
echo "Next command, after extension/manifest.json exists:"
echo "  ./tools/run_firefox_addon_dev.sh"
