# Phase 66 v0.41.7 — Phase 65 status hardening

## Scope

No new feature group. This phase only closes defects/edge cases in the Phase 65 compact-ready and managed-download header status work.

## Changes

- `armed`, `downloading`, and `moving`: header shows `⇩` with active styling.
- `completed`: header shows `✓`.
- `expired` and `error`: header shows `!`, keeps the underlying persisted error in the tooltip/accessible label, and uses error styling.
- Armed capture expiry has a dedicated timer; it is cancelled when the capture is claimed/intercepted or the owning tab closes, and restored captures schedule the remaining timeout again.
- Download status element now has explicit `role=status` / atomic live-region semantics.
- `FCI_ALERT_ENGINE.VERSION` is bumped from 12 to 13 so re-injection over a live v12 runtime loads the compact-`RD` implementation instead of returning early.

## Compatibility

- Add-on: 0.41.7
- Protocol: unchanged at 26
- Settings schema: unchanged at 18
- Native Host: unchanged at 0.13.0
