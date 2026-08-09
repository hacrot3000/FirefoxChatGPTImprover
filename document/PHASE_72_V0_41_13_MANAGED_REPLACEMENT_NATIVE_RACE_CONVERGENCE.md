# Phase 72 v0.41.13 — managed replacement and Native request race convergence

Scope: continue the existing compact `RD` / managed-download / shell hardening only. No new feature group.

## Fixed

- Protect the interval before an extension-created replacement download receives its `downloadId`; an early `downloads.onCreated` event cannot be claimed by another armed tab.
- Keep same-capture in-memory terminal state authoritative during navigation recovery so stale persisted `downloading` state cannot resurrect a failed/expired job.
- Remove pending Native Host request/timer state immediately if `postMessage()` throws synchronously.
- Clear a cached Native Host port when its initial ping fails so the next request reconnects instead of reusing a dead object.
- Converge Native Host status/stop send failures through terminal disconnect handling so shell state cannot remain stuck at `stopping`.
- Mark automation runtime/statistics failed when Native Host command startup itself fails.

## Compatibility

- Add-on: 0.41.13
- Protocol: 26 (unchanged)
- Settings schema: 18 (unchanged)
- Alert Engine: 15 (unchanged)
- Target Engine: 5 (unchanged)
- Content runtime: 29 (unchanged)
- Native Host: 0.13.0 (unchanged)
