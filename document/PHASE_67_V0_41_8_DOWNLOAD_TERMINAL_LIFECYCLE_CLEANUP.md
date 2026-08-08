# Phase 67 v0.41.8 — managed-download terminal lifecycle cleanup

## Scope

No new feature group. This phase continues the Phase 65/66 compact-ready and managed-download status hardening.

## Fixes

- Completion surface is rendered once, after shell availability/automatic-start state settles.
- Terminal completion/download-error/move-error paths clear both browser download ID and Native Host move ID routing keys.
- Persisted armed-capture recovery first clears the previous in-memory capture and expiry timer, preventing stale capture ownership when restore validation fails.
- Removes one redundant statistics-row append and one unreachable duplicate shell-log return found during the bug audit.

## Compatibility

- Add-on: 0.41.8
- Protocol: 26 (unchanged)
- Settings schema: 18 (unchanged)
- Native Host: 0.13.0 (unchanged)
