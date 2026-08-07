# Phase 49 v0.40.0 — Safe profile lifecycle

## Goal

Profile deletion and Local action profile import must not silently change the effective configuration of open tabs.

## Automation profile deletion

- Active sessions using the deleted profile keep their exact effective configuration as `CONFIG_MODE.TAB`.
- Stopped-tab snapshots are rewritten to an existing routed/default base profile while retaining the previous effective config as a tab override.
- Applying the override to content is attempted immediately; failures remain visible as session errors without losing the preserved configuration.

## Local action profile deletion

- Effective download and shell values are captured before the profile is removed.
- Affected active and stopped tabs keep those values as Local action tab overrides.
- Explicit tab bindings to the deleted profile are removed; URL routing/default is retained only as the new base profile, not as a replacement explicit binding.

## Import continuity

Importing a Local action profile bundle updates the shared library without clearing volatile drafts, working snapshots or immutable download-job command snapshots.

## Compatibility

- Extension: 0.40.0
- Protocol: 26
- Native Host: 0.13.0
