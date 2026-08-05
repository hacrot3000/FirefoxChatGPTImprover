# FirefoxChatImprover current project status

**Current baseline:** Phase 30 v0.30.0
**Primary supported environment:** Firefox Desktop on Linux and Windows  
**Native Host:** 0.13.0

## Completed production scope

| Area | Status | Notes |
|---|---|---|
| Multi-tab monitor and target automation | Complete | Independent tab/rule state, stability windows, baseline-only target action and recovery. |
| AI READY / Running status | Complete | `matched` remains AI READY; only `waiting` displays Running. |
| Persistent custom tab titles | Complete | User-defined per-tab names survive reload/navigation/background restart, preserve the original page title and remain compatible with AI READY/Running decorations. |
| Configuration, URL routing and tab overrides | Complete | Includes protected drafts, snapshots, working sessions, reusable Monitor/Target component profiles and typed per-profile JSON import/export. |
| Command presets and rule-triggered commands | Complete | Includes per-tab execution, status, stop and history. |
| Managed downloads | Complete | Capture, no-dialog restart, immutable snapshot, relocation, retry and post-download command. |
| Restart recovery for managed downloads | Complete | Armed captures resume while valid; moves replay by idempotent receipt. |
| Full command logs | Complete | File-backed paging, persisted fallback and legacy `runId` discovery. |
| Native Host Linux | Complete | Version 0.13.0; shell execution, scoped stop, bounded log retention and transaction receipts. |
| Native Host Windows | Complete | PowerShell install/uninstall, dual registry-view registration, PowerShell/cmd execution, process-tree stop, Windows state/download paths and integration-test script. |
| Firefox build/release tooling | Complete | Lint, build, checksum, signing helper, rollback and guarded update channel management. |
| Firefox Android manifest validation | Complete | Minimum Firefox 142 removes unsupported-key warning. |
| Tab-bound local-action working snapshots | Complete | Unsaved destination/command edits survive background recovery; stale cross-tab autosync is rejected by tab/session/URL/revision context. |
| Real Firefox E2E and version matrix | Complete | Opt-in runner covers tabs, title, badge, DOM action, navigation and optional Native Host download/shell; matrix emits JSON/Markdown per Firefox binary. |
| Source integrity and regression | Complete | Phase 04–28 plus v0.28.20 recovery/update, v0.28.21 Native-version UI, v0.28.22 log retention and v0.28.23 tab-bound local-action snapshot tests and v0.28.24 real-Firefox E2E/matrix tooling and v0.28.25 Windows Native Host contracts. |

## Operator-provided deployment inputs

The code path is complete, but persistent self-hosted updates cannot be activated without external operator assets:

1. a Mozilla-signed XPI;
2. stable HTTPS URLs for the XPI and `updates.json`;
3. hosting credentials or deployment access.

Use:

```bash
python3 tools/manage_firefox_update_channel.py prepare \
  --xpi /absolute/path/to/signed.xpi \
  --xpi-url https://host/path/addon.xpi \
  --update-url https://host/path/updates.json

python3 tools/manage_firefox_update_channel.py verify \
  --update-url https://host/path/updates.json

python3 tools/manage_firefox_update_channel.py enable \
  --update-url https://host/path/updates.json
```

## Known physical limitation

A log file deleted before v0.28.20 cannot be reconstructed from metadata. Existing legacy files are now rediscovered automatically by `runId`; missing bytes remain irrecoverable by definition.

## Required implementation status

No required implementation tasks remain from the v0.28.19 feature audit. The project is ready to pause here and begin a separately approved new-feature phase.

Windows runtime validation can be run on a Windows machine with:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\tools\test_native_host_windows.ps1
python .\tools\run_firefox_e2e.py --require-native
```

| Sidebar search/filter | Complete | Non-destructive filters cover tabs, configuration/monitor/target/local-action profiles, global command presets and per-tab command history while preserving the current selection and drafts. |
