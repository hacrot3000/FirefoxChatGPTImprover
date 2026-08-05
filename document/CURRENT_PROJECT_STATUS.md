# FirefoxChatImprover current project status

**Current baseline:** Phase 28 v0.28.20  
**Primary supported environment:** Firefox Desktop on Linux  
**Native Host:** 0.11.0

## Completed production scope

| Area | Status | Notes |
|---|---|---|
| Multi-tab monitor and target automation | Complete | Independent tab/rule state, stability windows, baseline-only target action and recovery. |
| AI READY / Running status | Complete | `matched` remains AI READY; only `waiting` displays Running. |
| Configuration, URL routing and tab overrides | Complete | Includes protected drafts, snapshots, import/export and working sessions. |
| Command presets and rule-triggered commands | Complete | Includes per-tab execution, status, stop and history. |
| Managed downloads | Complete | Capture, no-dialog restart, immutable snapshot, relocation, retry and post-download command. |
| Restart recovery for managed downloads | Complete | Armed captures resume while valid; moves replay by idempotent receipt. |
| Full command logs | Complete | File-backed paging, persisted fallback and legacy `runId` discovery. |
| Native Host Linux | Complete | Version 0.11.0; shell execution, scoped stop, log store and transaction receipts. |
| Firefox build/release tooling | Complete | Lint, build, checksum, signing helper, rollback and guarded update channel management. |
| Firefox Android manifest validation | Complete | Minimum Firefox 142 removes unsupported-key warning. |
| Source integrity and regression | Complete | Phase 04–28 plus v0.28.20 recovery/update tests. |

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
