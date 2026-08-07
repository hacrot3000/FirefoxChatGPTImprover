# Phase 56 v0.40.7 — Working-session profile isolation

## Goal

Make the Working session library truly session-scoped. Restoring a saved session must not create, overwrite, rename, delete or select global Automation/Local action profiles.

## Restore rules

- If the saved Automation profile ID still exists and its configuration fingerprint matches the saved profile snapshot, the restored tab may continue using that profile.
- Otherwise the current routed/default Automation profile is kept only as a base reference and the saved effective Automation configuration is restored as a tab override.
- Local action restore follows the same rule for download and shell settings.
- Saved tab overrides remain tab overrides.
- No global profile store is written during session restore.
- No settings recovery snapshot is created because global settings are no longer modified by this operation.

## Compatibility

- Working-session JSON format remains version 4 and old session files remain readable.
- Add-on: 0.40.7
- Protocol: 26
- Native Host: 0.13.0
