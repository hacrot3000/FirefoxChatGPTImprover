# Phase 30 v0.30.0 — Search/filter for sidebar libraries

This phase implements the first non-macOS item from the audit section “Useful optional features not implemented”.

## Scope

- Tabs and sessions
- Configuration profiles
- Monitor profiles
- Target profiles
- Local-action profiles
- Global command presets
- Per-tab command history

Filters search useful metadata, keep the current selection visible even when it falls outside the query, do not write any profile/session data, and persist only as sidebar UI preferences. Press Escape in a non-empty filter to clear it.

Native Host remains 0.13.0.
