# Phase 19 — Settings snapshots and rollback

Phase 19 adds a bounded local recovery history for global settings.

## Behavior

- A snapshot is created automatically before profile save, profile delete and JSON import.
- Restoring a snapshot first creates a snapshot of the current settings.
- Manual snapshots can be created from the **Save configuration** section.
- Up to 20 unique snapshots are retained. Duplicate settings content is not stored again.
- Snapshots contain complete local profile configuration, including selectors, rules, URL routing and command presets. They never leave Firefox storage unless the user exports the normal settings JSON.
- Restoring settings re-applies the restored profiles to active tab sessions.

## Compatibility

Existing profiles and sessions require no migration. Snapshot storage uses a separate key and does not change the existing settings storage key.
