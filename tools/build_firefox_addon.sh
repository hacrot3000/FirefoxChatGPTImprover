#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
EXTENSION_DIR="${EXTENSION_DIR:-${PROJECT_ROOT}/extension}"
ARTIFACTS_DIR="${ARTIFACTS_DIR:-${PROJECT_ROOT}/dist}"
WEB_EXT_BIN="${PROJECT_ROOT}/.firefox-dev-tools/node_modules/.bin/web-ext"

if [ ! -f "${EXTENSION_DIR}/manifest.json" ]; then
    echo "ERROR: extension manifest not found: ${EXTENSION_DIR}/manifest.json"
    exit 1
fi

if [ ! -x "${WEB_EXT_BIN}" ]; then
    echo "ERROR: web-ext is not installed. Run: ./tools/setup_firefox_addon_dev.sh"
    exit 1
fi

mkdir -p -- "${ARTIFACTS_DIR}"

"${WEB_EXT_BIN}" lint --source-dir "${EXTENSION_DIR}"
"${WEB_EXT_BIN}" build \
    --source-dir "${EXTENSION_DIR}" \
    --artifacts-dir "${ARTIFACTS_DIR}" \
    --overwrite-dest \
    "$@"

echo "DONE: add-on artifact created in ${ARTIFACTS_DIR}"
