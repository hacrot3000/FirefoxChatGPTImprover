#!/usr/bin/env bash
set -euo pipefail
python3 tools/check_source_syntax.py
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
node tests/test_phase28_v0288_tab_session_popup_execute.js
node tests/test_phase28_v0289_source_integrity.js
node tests/test_phase28_v02810_extended_buildkit_source_sanitizer.js
node tests/test_phase28_v02812_full_source_syntax_integrity.js
node tests/test_phase28_v02813_background_dashboard_bootstrap.js
node tests/test_phase28_v02814_tab_bound_shell_log_status.js
node tests/test_phase28_v02815_preset_edit_and_command_notice.js
node tests/test_phase28_v02816_ai_status_and_log_fallback.js
node tests/test_phase28_v02817_alert_engine_upgrade_title_priority.js
node tests/test_phase28_v02818_cumulative_runtime22_rescue.js
node tests/test_phase28_v02819_matched_ready_timeout.js
node tests/test_phase28_v02820_recovery_completion.js
node tests/test_phase28_v02821_native_version_badge.js
node tests/test_phase28_v02822_log_retention_ui.js
node tests/test_phase28_v02823_tab_bound_local_action_snapshot.js
python3 tests/test_phase28_v02822_native_log_retention.py
python3 tests/test_phase28_v02820_native_receipts_and_legacy_logs.py
python3 tests/test_phase28_v02820_update_channel.py
python3 tests/test_phase28_v02824_real_firefox_e2e_matrix.py
python3 tests/test_phase28_v02825_windows_native_host.py
python3 tests/test_phase25_native_download_environment.py
node tests/test_phase29_v0290_component_profiles_custom_titles.js
node tests/test_phase30_v0300_sidebar_search_filters.js
python3 tests/test_phase30_v03001_release_documentation.py

node tests/test_phase31_v0310_saved_working_session_catalog.js

node tests/test_phase32_v0320_optional_sound_alert.js

node tests/test_phase33_v0330_opt_in_url_auto_activation.js

node tests/test_phase34_v0340_keyboard_shortcuts.js

node tests/test_phase35_v0350_per_rule_statistics_dashboard.js

node tests/test_phase36_v0360_compressed_per_run_log_export.js

node tests/test_phase37_v0370_prompt_templates.js

node tests/test_phase38_v0380_browser_compat.js
python3 tests/test_phase38_v0380_chromium_build.py

node tests/test_phase39_v0390_accessibility_audit.js

node tests/test_phase40_v0391_stopped_tab_local_action_binding.js

node tests/test_phase41_v0392_local_action_binding_controls.js

python3 tests/test_phase42_v0393_release_status_consistency.py

node tests/test_phase43_v0394_configuration_session_io_separation.js

node tests/test_phase44_v0395_stop_start_tab_config_persistence.js

node tests/test_phase45_v0396_explicit_stopped_state_reconciliation.js

node tests/test_phase46_v0397_simplified_sidebar_feature_visibility.js

node tests/test_phase47_v0398_profile_capture_selection_continuity.js
node tests/test_phase48_v0399_persistent_profile_editor_intent.js
node tests/test_phase49_v0400_safe_profile_lifecycle.js
node tests/test_phase50_v0401_local_action_profile_save_draft_continuity.js
node tests/test_phase51_v0402_component_profile_editor_draft_continuity.js
node tests/test_phase52_v0403_non_destructive_profile_bundle_import.js
node tests/test_phase53_v0404_explicit_default_profile_controls.js
node tests/test_phase54_v0405_component_default_profile_controls.js
node tests/test_phase55_v0406_profile_action_clarity.js
node tests/test_phase56_v0407_working_session_profile_isolation.js
node tests/test_phase57_v0408_safe_configuration_restore.js
node tests/test_phase58_v0409_complete_configuration_backup.js
node tests/test_phase59_v0410_configuration_scope_return_contract.js
node tests/test_phase60_v0411_configuration_import_preview_confirmation.js
node tests/test_phase61_v0412_atomic_full_configuration_commit.js
node tests/test_phase62_v0413_semantic_recovery_snapshot_deduplication.js
node tests/test_phase63_v0414_manual_snapshot_promotion.js
node tests/test_phase64_v0415_manual_preferred_snapshot_compaction.js

if [ "${FCI_RUN_FIREFOX_E2E:-0}" = "1" ]; then
  python3 tools/run_firefox_e2e.py ${FCI_FIREFOX_E2E_ARGS:-}
else
  printf 'SKIP: real Firefox E2E is opt-in; run with FCI_RUN_FIREFOX_E2E=1.\n'
fi

if [ -n "${FCI_FIREFOX_MATRIX_CONFIG:-}" ]; then
  python3 tools/run_firefox_version_matrix.py --config "${FCI_FIREFOX_MATRIX_CONFIG}" ${FCI_FIREFOX_MATRIX_ARGS:-}
fi

WEB_EXT_BIN="${ROOT}/.firefox-dev-tools/node_modules/.bin/web-ext"
if [ "${FCI_SKIP_WEB_EXT_LINT:-0}" = "1" ]; then
  printf 'SKIP: web-ext lint disabled by FCI_SKIP_WEB_EXT_LINT for patch self-validation.\n'
elif [ -x "$WEB_EXT_BIN" ] && "$WEB_EXT_BIN" --version >/dev/null 2>&1; then
  "$WEB_EXT_BIN" lint --source-dir "${ROOT}/extension"
elif [ -x "$WEB_EXT_BIN" ]; then
  printf 'SKIP: local web-ext install is incomplete; run ./tools/setup_firefox_addon_dev.sh before building.\n'
else
  printf 'SKIP: web-ext lint chưa chạy vì dev tool chưa được cài; dùng task Firefox Add-on: Setup Dev Environment.\n'
fi
printf '%s\n' 'PASS: FirefoxChatImprover Phase 04-64 v0.41.5 manual-preferred snapshot compaction, manual snapshot promotion, semantic recovery-snapshot deduplication, adds simplified persistent sidebar feature visibility while preserving explicit stopped-tab state, complete per-tab configuration across Stop/Start, separated configuration/session scopes, Local action binding controls, accessibility, Chromium/Chrome/Edge packaging, prompt templates, command-log export, per-rule statistics, trusted URL auto-activation, saved working sessions, custom tab titles, Linux/Windows Native Host runtime and protected command-log retention.'
