# Phase 68 v0.41.9 — managed-download state clarity and lifecycle leak fixes

## Scope

No new feature group. This phase continues the Phase 65–67 compact `RD` / managed-download status work after real runtime feedback showed that the previous animated glyphs were ambiguous.

## Header state contract

The matched automation state remains `RD`. The independent download badge is now stable and explicit:

- `CK` — capture armed; ready and checking/waiting for the browser download to start.
- `DL` — Firefox download is actually in progress.
- `MV` — browser download finished and Native Host relocation is in progress.
- `✓` — relocation completed and the final destination was verified.
- `NO` — the capture window ended without detecting a download; this is not rendered as a failure warning.
- `×` — an actual download/relocation error.

Download badges do not pulse or fade. The separate command-running indicator retains its existing animation.

## Lifecycle fixes

- Managed Firefox download IDs are removed from `managedDownloadIds` on completion/error and tab cleanup instead of accumulating for the lifetime of the background context.
- Early relocation validation failures clear browser/move routing keys.
- Restart recovery only rebuilds routing for a genuinely active `downloading` job; terminal jobs remain terminal, missing download IDs fail closed, and a persisted download that Firefox can no longer find becomes an explicit error instead of remaining `downloading` forever.
- Failure to connect/start the Native Host shell path is converted into a terminal shell error and persisted/broadcast, preventing a download shell state from remaining stuck at `starting`.
- Managed-download startup tolerates a transient `downloads.search()` failure after Firefox has already returned a valid new download ID.

## Compatibility

- Add-on: 0.41.9
- Protocol: 26 (unchanged)
- Settings schema: 18 (unchanged)
- Native Host: 0.13.0 (unchanged)
