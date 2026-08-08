# Phase 65 v0.41.6 — Compact ready/download header status

## Goal

Finish the existing status presentation without starting a new feature group.

## Changes

- `matched` keeps its existing ready semantics but the default visible ready text is shortened to `RD` (with the existing warning frame rendered compactly as `⚠ RD`).
- Legacy default prefixes `AI READY` / `⚠ AI READY` are compacted at render time; custom prefixes remain unchanged.
- Sidebar header adds an independent managed-download indicator:
  - `⇩` while status is `downloading` or `moving`;
  - `✓` after verified `completed`;
  - hidden for idle/armed/error/expired states.
- Command running/unread status remains independent.
- Reconciles stale TODO/progress documentation and updates bundled AI Patch Tool guidance to v6.7.9.

## Regression scope

- alert title/default-prefix behavior;
- sidebar header status rendering;
- managed-download state display only (no state-machine changes);
- existing command-status icon isolation;
- release documentation consistency.
