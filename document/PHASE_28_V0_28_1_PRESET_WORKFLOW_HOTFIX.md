# Phase 28 v0.28.1 — Preset creation and unrestricted execution hotfix

## Corrected preset workflow

1. **Command preset** is only the list of existing preset names.
2. **New preset** opens a name prompt.
3. After confirming the name, the new preset is created immediately, added to the global list, selected, and persisted.
4. Edit Working directory, Command, mode, and confirmation options below.
5. **Save preset** writes those values into the selected global preset.
6. **Apply to this tab** copies the saved preset into the selected tab.

For a tab-specific command, click **Direct command for this tab**, then edit Working directory and Command. Direct values continue to auto-save for that tab.

## Removed restrictions

- Preset name is no longer a permanently visible form field.
- Preset enabled/disabled is removed from the normal workflow; every saved preset is selectable.
- **Only run commands matching an enabled preset** is removed from the UI and from download-shell validation.
- Direct commands and saved presets can run without matching another preset.

No Native Host reinstall is required.
