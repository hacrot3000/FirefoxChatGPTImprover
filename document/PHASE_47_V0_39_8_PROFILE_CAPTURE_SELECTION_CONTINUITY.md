# Phase 47 hotfix 2 v0.39.8 — Exact latest-source profile save flow

## Goal

Repair profile creation and saving against the exact source supplied in `allnew.zip`.

## Result

- `Save current as new` sends the complete current form to the background and creates the profile atomically.
- The new profile remains selected in the editor after the dashboard refreshes.
- `Save current values` keeps both the selected profile and the visible values.
- Automation editor selection is separate from the profile currently running on the tab.
- Local action editor selection is separate from the tab binding until `Apply to tab` is used.
- Local action profile save includes download settings, working directory, shell command and shell options.
- Switching tabs restores each tab's editor selection instead of forcing Default.

## Compatibility

- Extension: 0.39.8
- Protocol: 26
- Native Host: 0.13.0
