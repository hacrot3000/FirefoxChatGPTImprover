# Phase 50 v0.40.1 — Local action profile-save draft continuity

## Problem

`saveLocalActionProfile()` increased the shared profile revision after first clearing every affected tab's volatile and persisted working snapshot. Saving a profile from one tab could therefore erase unsaved destination, working-directory or command values from another tab using the same profile.

## Resolution

1. Capture only a valid volatile or persisted working draft before the revision changes.
2. Increase the profile-backed session revision.
3. Restore the captured configuration with a new context derived from the current tab session, profile and revision.
4. Keep tabs without a working draft on the newly saved shared profile without creating an override.

## Compatibility

- Extension: 0.40.1
- Protocol: 26
- Native Host: 0.13.0
