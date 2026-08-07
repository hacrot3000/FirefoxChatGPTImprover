# Phase 52 v0.40.3 — Non-destructive profile bundle import

## Mục tiêu

Typed profile bundles must be safe to inspect and import without silently changing existing profiles, local defaults or open-tab runtime behavior.

## Behavior

- Existing profile IDs are never overwritten by typed profile import.
- An identical profile is skipped.
- An ID collision with different content is imported as a new profile with a fresh ID.
- A name collision is renamed with an `(imported)` suffix and a numeric suffix when needed.
- The current local default profile remains unchanged.
- Automation and Local action tabs keep their current effective values, working drafts and immutable jobs.
- Monitor/Target imports continue to preserve the current Automation rule draft.
- The sidebar reports added, skipped, ID-collision-copy and renamed counts.

## Compatibility

- Extension version: 0.40.3
- Protocol: 26
- Native Host: 0.13.0
