# Phase 28 v0.28.20 — completion of previously in-progress features

## Completed scope

### Restart-resumable managed downloads

- An `armed` capture is reconstructed from its immutable persisted snapshot when the background context restarts and the original capture window is still valid.
- An interrupted `moving` job is replayed with the original `moveId`, source path, destination and conflict policy.
- Native Host 0.11.0 writes a pending relocation receipt before the filesystem move and completes it afterward. Replaying the same `moveId` returns the existing destination instead of moving the file twice.
- A missing or expired capture fails closed with an explicit status rather than being silently attributed to another tab.

### Backward-compatible command-log recovery

- Native Host can resolve the deterministic file-backed `logId` from a historical `runId`.
- Background recovery repairs history and command notices that have a `runId` but no persisted `logId`.
- Opening a historical log also performs on-demand resolution before falling back to the stored summary.
- Bytes that were physically deleted before this version cannot be recreated; all still-existing legacy log files are discoverable.

### Self-hosted update deployment tooling

- `tools/manage_firefox_update_channel.py` prepares deployment files from a Mozilla-signed XPI, verifies hosted `updates.json` and XPI SHA-256, and enables `update_url` only after successful online verification unless the operator explicitly selects offline mode.
- `status`, `prepare`, `verify`, `enable` and `disable` operations are supported.
- The repository intentionally leaves `update_url` disabled until the operator provides real HTTPS hosting and a Mozilla-signed XPI.

### Firefox Android manifest compatibility

- `strict_min_version` is now Firefox 142, matching the introduction of `browser_specific_settings.gecko.data_collection_permissions` on Firefox Android and removing the previous linter warning.

### Consolidated project status

- `document/CURRENT_PROJECT_STATUS.md` is the canonical current-state document.
- `PROJECT_IMPLEMENTATION_PLAN.md` remains the historical plan but now points to the current baseline.
