# Phase 28 v0.28.16 — independent AI status and command-log fallback

## Fixed behavior

1. Shell command notices are secondary indicators. They no longer suppress the AI monitor spinner, matched state, or active badge.
2. Recent completed runs persist a bounded copy of output already received by the extension. The Native Host file-backed log remains the primary complete source.
3. When the file-backed log cannot be read after a browser/host restart, the dialog shows persisted output or a deterministic command summary and remains non-fatal.
4. A viewed log is immediately hidden from the UI. If the related tab was not active during viewing, the internal `viewed` state is finalized to `idle` when the tab becomes active.
