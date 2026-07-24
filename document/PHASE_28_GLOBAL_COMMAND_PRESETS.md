# Phase 28 v0.28.0 — Global command presets and simplified tab commands

## User workflow

Command presets are no longer edited as part of a local-action profile draft.

1. Click **New preset**.
2. Enter preset name, working directory, command, mode, and confirmation choice.
3. Click **Save preset**. The preset is stored globally and is visible from every tab.
4. In a tab, select a preset and click **Apply to this tab**.

A tab that does not use a preset can select **Direct command for this tab** and enter Working directory and Command. Direct command edits are saved automatically to that tab after validation.

## Architecture

- Adds a dedicated `command_presets.js` store with its own schema and storage key.
- Migrates unique legacy presets from local-action profiles into the global library without deleting old data.
- Preset create/update/delete operations write directly to the global library; no local-action profile save is required.
- Applying a preset or editing a direct command persists and verifies the tab's effective shell configuration.
- Local-action profile dirty tracking and profile save scope exclude command editor changes.
- Existing immutable per-download snapshots, manual/automatic execution, Native Host protocol, full logs, and outcome audit remain unchanged.

No Native Host reinstall is required.
