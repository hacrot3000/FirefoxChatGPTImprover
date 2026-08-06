# Phase 41 v0.39.2 — Local action binding controls

## Goal

Make the stopped-tab binding introduced in Phase 40 fully reversible and visible.

## Behavior

- `Apply to tab` creates an explicit tab binding.
- `Use URL/default` removes that binding on stopped or active tabs.
- URL routing is resolved first after removal; the default Local action profile is used when no route matches.
- The source summary reports the effective source and warns when the editor selection is not applied.
- Unsaved Local action edits remain protected before apply or clear operations.

## Versions

- Extension: 0.39.2
- Protocol: 26
- Native Host: 0.13.0 (unchanged)
