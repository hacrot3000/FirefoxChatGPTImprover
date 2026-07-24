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
node tests/test_phase19_settings_snapshots.js
node tests/test_phase20_working_session.js
node tests/test_phase21_local_actions_download.js
python3 tests/test_phase21_download_relocator.py
node tests/test_phase22_file_backed_shell_logs.js
python3 tests/test_phase22_native_log_store.py
node tests/test_phase23_immutable_download_jobs.js
node tests/test_phase23_v0231_download_group_layout.js
node tests/test_phase24_local_action_save_guard.js
node tests/test_phase24_v0241_no_dialog_download_restart.js
node tests/test_phase24_v0242_capture_aware_click_timer_binding.js
node tests/test_phase24_v0243_correlated_download_move.js
python3 tests/test_phase24_v0243_native_move_correlation.py
node tests/test_phase24_v0244_page_completion_retry_semantics.js
node tests/test_phase25_download_shell_execution.js
node tests/test_phase25_v0251_installation_guide.js
node tests/test_phase25_v0252_sidebar_bootstrap.js
node tests/test_phase26_sidebar_runtime_guard.js
node tests/test_phase26_v0261_per_tab_download_shell.js
node tests/test_phase27_download_shell_outcome_audit.js
node tests/test_phase28_global_command_presets.js
node tests/test_phase28_v0281_preset_workflow.js
node tests/test_phase28_v0283_volatile_draft_priority.js
node tests/test_phase28_v0284_phase16_contract_compatibility.js
node tests/test_phase28_v0285_status_dot_only.js
node tests/test_phase28_v0286_download_execute_console_recovery.js
node tests/test_phase28_v0287_native_move_automatic_shell.js
python3 tests/test_phase25_native_download_environment.py

WEB_EXT_BIN="${ROOT}/.firefox-dev-tools/node_modules/.bin/web-ext"
if [ -x "$WEB_EXT_BIN" ]; then
  "$WEB_EXT_BIN" lint --source-dir "${ROOT}/extension"
else
  printf 'SKIP: web-ext lint chưa chạy vì dev tool chưa được cài; dùng task Firefox Add-on: Setup Dev Environment.\n'
fi
printf 'PASS: FirefoxChatImprover Phase 04-28 v0.28.7 static, unit, integration-contract, security, release-tooling, alert lifecycle, element-picker, URL profile-routing, action-pipeline, deterministic monitor-stability, early-timer-rearm, session-recovery, compact-controls, monitor-title-spinner, multi-rule automation, runtime-isolation, forward-compatible version contracts, English-UI, title-de-duplication, help-popovers, command-presets, per-tab command-history, rule-command-actions, collision-free compact-header-controls, sanitized support-bundle export and bounded settings-snapshot rollback, verified configuration persistence, working-session save/import, separate local-action profiles, managed-download relocation, external-watcher, file-backed full shell-log, paged viewer, long-output preservation, right-aligned shell-header actions, immutable download-job snapshots, safe multi-tab attribution, persisted recovery, explicit relocation-retry and dedicated managed-download-group layout, verified local-action persistence, effective-source audit and unsaved-draft-protection no-dialog page-download-restart, capture-aware real-click, content-timer-binding, correlated download-move response, timeout, Native Host error-surfacing, page-centered completion overlay, visible destination path and current-destination retry semantics, verified manual/automatic post-download shell execution, FCI_DOWNLOAD_PATH environment binding, complete console integration and embedded Patch Tool/Native Host installation-guide, runtime sidebar-bootstrap tests, preload runtime-guard recovery diagnostics, per-tab shell persistence, completed-download execute readiness and auditable post-download shell outcome provenance, global-command-preset-library, prompt-created-preset-workflow, selected-preset saving, unrestricted command execution, immediate volatile direct commands, highest-priority volatile managed-download drafts, compact local-action status, repeatable same-version builds, historical Phase 16 global-command-preset contract compatibility, status-dot-only draft indication, completed-download manual fallback, inline/file-backed console recovery, correlated move completion and automatic shell launch.\n'
