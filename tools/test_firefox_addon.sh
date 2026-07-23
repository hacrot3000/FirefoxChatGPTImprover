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
python3 tests/test_phase08_release_tooling.py
node tests/test_phase09_alert_lifecycle.js
node tests/test_phase09_sidebar_groups.js
node tests/test_phase10_element_picker.js
node tests/test_phase11_url_profile_routing.js
node tests/test_phase12_action_pipeline.js
node tests/test_phase13_monitor_stability.js
node tests/test_phase14_session_recovery.js
node tests/test_phase14_compact_controls.js
node tests/test_phase14_v0142_sidebar_form_persistence.js
node tests/test_phase15_multi_rule_automation.js
node tests/test_phase15_v0151_timer_session_isolation.js
node tests/test_phase15_v0152_english_title_help.js
node tests/test_phase16_command_presets_history.js
node tests/test_phase17_rule_command_actions.js
node tests/test_phase17_v0171_header_action_layout.js
node tests/test_phase18_support_bundle.js

WEB_EXT_BIN="${ROOT}/.firefox-dev-tools/node_modules/.bin/web-ext"
if [ -x "$WEB_EXT_BIN" ]; then
  "$WEB_EXT_BIN" lint --source-dir "${ROOT}/extension"
else
  printf 'SKIP: web-ext lint chưa chạy vì dev tool chưa được cài; dùng task Firefox Add-on: Setup Dev Environment.\n'
fi
printf 'PASS: FirefoxChatImprover Phase 04-18 v0.18.0 static, unit, integration-contract, security, release-tooling, alert lifecycle, element-picker, URL profile-routing, action-pipeline, deterministic monitor-stability, early-timer-rearm, session-recovery, compact-controls, monitor-title-spinner, multi-rule automation, runtime-isolation, forward-compatible version contracts, English-UI, title-de-duplication, help-popovers, command-presets, background-enforced allowlist, per-tab command-history, rule-command-actions, collision-free compact-header-controls and sanitized support-bundle export tests.\n'
