#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${FCI_FIXTURE_PORT:-8765}"
cd "${ROOT}/tests/fixtures"
printf 'Phase 07 fixture: http://127.0.0.1:%s/phase07_dom_fixture.html\n' "$PORT"
printf 'Dừng server bằng Ctrl+C.\n'
exec python3 -m http.server "$PORT" --bind 127.0.0.1
