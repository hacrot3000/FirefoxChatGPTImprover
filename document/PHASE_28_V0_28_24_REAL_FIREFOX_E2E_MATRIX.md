# Phase 28 v0.28.24 — real Firefox E2E and version matrix

## Purpose

The existing Phase 04–28 suite validates logic, contracts, source integrity and Native Host behavior without requiring a browser process. v0.28.24 adds a separate real-Firefox layer for the runtime races that only appear with actual tabs, navigation, browser badges, downloads and Native Messaging.

## Real-Firefox E2E runner

`tools/run_firefox_e2e.py`:

- starts a localhost fixture server;
- copies the production extension to a temporary directory;
- injects a narrow background test hook only into that temporary copy;
- loads the actual production content scripts and background implementation;
- launches Firefox through the project's local `web-ext` installation;
- verifies activation, independent tab state, monitor transitions, AI READY/Running title semantics, browser badge updates, target clicks, SPA navigation and full-navigation recovery;
- verifies distinct local-action destinations for two tabs;
- verifies real managed-download relocation and shell execution when the installed Native Host is available;
- reports Native Host checks as skipped unless `--require-native` is supplied.

No test hook, test content script or localhost host permission is added to the production manifest or release package.

Example:

```bash
./tools/setup_firefox_addon_dev.sh
python3 tools/run_firefox_e2e.py \
  --firefox /usr/bin/firefox \
  --require-native \
  --json-report test-results/firefox-e2e.json
```

## Version matrix

`tools/run_firefox_version_matrix.py` accepts explicit binaries, automatic PATH discovery or `tools/firefox_version_matrix.example.json`. It records:

- Firefox version and manifest-minimum compatibility;
- real-Firefox E2E result;
- Native Host result;
- JSON and Markdown reports.

Example:

```bash
python3 tools/run_firefox_version_matrix.py \
  --config tools/firefox_version_matrix.example.json
```

## Regression integration

The lightweight tooling contract test always runs in `tools/test_firefox_addon.sh`. A real browser is opt-in:

```bash
FCI_RUN_FIREFOX_E2E=1 \
FCI_FIREFOX_E2E_ARGS="--firefox /usr/bin/firefox --require-native" \
./tools/test_firefox_addon.sh
```

A matrix can be attached to the same regression invocation with `FCI_FIREFOX_MATRIX_CONFIG`.
