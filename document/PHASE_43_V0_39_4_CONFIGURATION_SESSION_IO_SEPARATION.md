# Phase 43 v0.39.4 — Separate configuration and working-session I/O

## Purpose

Remove duplicated working-session controls and make the data boundary visible and testable.

## Result

- `Import/export configuration` contains configuration save/reset, full configuration import/export, typed profile transfer and configuration recovery snapshots.
- The legacy `Save working session` and `Import working session` controls and their hidden file input were removed from that card.
- Full-store buttons are now labelled `Export all configuration` and `Import all configuration`.
- `Saved working sessions` remains the sole UI for named-session save/update/restore and session/catalog JSON transfer.
- Configuration JSON is verified not to contain the independently stored working-session catalog.

## Compatibility

- Extension: 0.39.4
- Protocol: 26
- Native Host: 0.13.0
- Native Host reinstall: not required
