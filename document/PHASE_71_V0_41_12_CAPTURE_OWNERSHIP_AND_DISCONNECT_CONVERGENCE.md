# Phase 71 v0.41.12 — capture ownership and disconnect terminal convergence

## Scope

Bugfix/hardening only for the existing compact `RD` + managed-download/shell workflow. No new feature group.

## Fixes

- `CK`/armed is an active download state and blocks a second target click from replacing the pending capture.
- `downloads.onCreated` fallback accepts same-origin ownership only when exactly one armed capture matches; ambiguous multi-tab matches fail closed.
- Native Host disconnect is propagated as a terminal shell error into shell history/notices, download-shell state, automation runtime/statistics and pending request rejection.
- Native log cleanup is scheduled after disconnect terminalization.

## Compatibility

- Add-on: 0.41.12
- Protocol: 26 (unchanged)
- Settings schema: 18 (unchanged)
- Alert Engine: 15 (unchanged)
- Target Engine: 5 (unchanged)
- Content runtime: 29 (unchanged)
- Native Host: 0.13.0 (unchanged)
