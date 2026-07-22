#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

find extension -type f -name '*.js' -print0 | while IFS= read -r -d '' file; do
  node --check "$file" >/dev/null
done

node tests/test_phase04_target_logic.js
node tests/test_phase05_alert_logic.js
node tests/test_phase05_selector_preview_logic.js
node tests/test_phase06_extension_contract.js
python3 tests/test_phase06_native_host.py
node tests/test_phase07_settings_validation.js
node tests/test_phase07_monitor_state_machine.js
node tests/test_phase07_target_hardening.js
node tests/test_phase07_background_sender_scope.js
python3 tests/test_phase07_native_host_hardening.py
python3 tests/test_phase07_security.py

WEB_EXT_BIN="${ROOT}/.firefox-dev-tools/node_modules/.bin/web-ext"
if [ -x "$WEB_EXT_BIN" ]; then
  "$WEB_EXT_BIN" lint --source-dir "${ROOT}/extension"
else
  printf 'SKIP: web-ext lint chưa chạy vì dev tool chưa được cài; dùng task Firefox Add-on: Setup Dev Environment.\n'
fi
printf 'PASS: FirefoxChatImprover Phase 04-07 static, unit, integration-contract and security tests.\n'
