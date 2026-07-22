#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
EXTENSION_DIR="${PROJECT_ROOT}/extension"
WEB_EXT_BIN="${WEB_EXT_BIN:-${PROJECT_ROOT}/.firefox-dev-tools/node_modules/.bin/web-ext}"

if [[ ! -x "${WEB_EXT_BIN}" ]]; then
  echo "ERROR: web-ext is not installed. Run ./tools/setup_firefox_addon_dev.sh" >&2
  exit 1
fi
if [[ -z "${WEB_EXT_API_KEY:-}" || -z "${WEB_EXT_API_SECRET:-}" ]]; then
  echo "ERROR: set WEB_EXT_API_KEY and WEB_EXT_API_SECRET from your AMO API credentials." >&2
  exit 1
fi

VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["version"])' "${EXTENSION_DIR}/manifest.json")"
SIGNED_DIR="${SIGNED_DIR:-${PROJECT_ROOT}/dist/signed/${VERSION}}"
mkdir -p -- "${SIGNED_DIR}"
if compgen -G "${SIGNED_DIR}/*.xpi" >/dev/null && [[ "${OVERWRITE_SIGNED_RELEASE:-0}" != "1" ]]; then
  echo "ERROR: signed XPI already exists in ${SIGNED_DIR}; bump version or set OVERWRITE_SIGNED_RELEASE=1." >&2
  exit 1
fi

"${WEB_EXT_BIN}" sign \
  --channel unlisted \
  --source-dir "${EXTENSION_DIR}" \
  --artifacts-dir "${SIGNED_DIR}" \
  --no-input

mapfile -t XPIS < <(find "${SIGNED_DIR}" -maxdepth 1 -type f -name '*.xpi' -printf '%p\n' | sort)
if [[ ${#XPIS[@]} -eq 0 ]]; then
  echo "ERROR: web-ext sign completed without producing an XPI." >&2
  exit 1
fi
: > "${SIGNED_DIR}/SHA256SUMS"
for xpi in "${XPIS[@]}"; do
  sha256sum "${xpi}" | sed "s#  ${SIGNED_DIR}/#  #" >> "${SIGNED_DIR}/SHA256SUMS"
done
printf 'DONE: signed unlisted release %s\n' "${VERSION}"
printf 'Directory: %s\n' "${SIGNED_DIR}"
