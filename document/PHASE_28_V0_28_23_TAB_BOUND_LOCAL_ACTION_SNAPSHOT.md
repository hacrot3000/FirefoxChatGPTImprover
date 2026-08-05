# Phase 28 v0.28.23 — Tab-bound local-action working snapshots

## Problem

A delayed sidebar autosync read the selected tab at timer execution time. Switching tabs during the 140 ms debounce could apply one tab's download destination to another. In-memory working drafts also disappeared when the background context restarted, silently falling back to the shared default profile.

## Resolution

- Debounced sync captures tab ID, session token, local-action revision, profile ID, mode and normalized config at edit time.
- Background rejects stale sync messages whose context no longer matches the tab session.
- The effective tab working config is mirrored into `browser.sessions` and restored after background restart/navigation.
- Assign, save, reset, revert and profile updates explicitly invalidate the working snapshot.
- Discarding edits while changing tabs clears the originating tab, not the newly selected tab.
- Every armed download records effective source, destination and config fingerprint before the click.

The Native Host remains unchanged.
