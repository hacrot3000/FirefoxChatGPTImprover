# Phase 28 v0.28.3 — Volatile draft priority and compact local actions

## Runtime priority

Valid local-action edits in the open sidebar are now effective immediately for the selected tab, even when the user does not save a profile or apply a tab override. These edits live only in the background page's in-memory map and therefore disappear after Firefox or the add-on reloads.

Priority while the sidebar is open:

1. Current valid volatile editor draft.
2. Persisted tab override.
3. Assigned or URL-routed local-action profile.
4. Default local-action profile.

Editing a global command preset remains isolated: preset fields do not affect the tab until **Apply to this tab** is clicked. Direct command mode is volatile and effective immediately.

## Compact local-action UI

- Local action profile is placed immediately after Configuration profiles.
- Clean state no longer displays a Saved badge.
- Tab-specific/profile/effective-source prose is hidden.
- A single yellow note appears only while volatile edits exist or while the current draft is incomplete.

## Repeatable development build

`tools/build_firefox_addon.sh` now passes `--overwrite` to the release builder by default. Re-running the normal development command can replace the existing artifact for the same version instead of failing because `dist/releases/<version>` already exists.

The v0.28.2 package failed before applying files on repositories whose message switch used colon-only cases. v0.28.3 accepts braced, colon-only, shared-helper, or absent cleanup cases without weakening the required volatile-draft path.

No Native Host reinstall is required.
