# Phase 55 v0.40.6 — Profile action clarity

## Goal

Make Automation, Monitor, Target and Local action profile editors follow one predictable model without redundant actions or ambiguous duplicate names.

## Behaviour

- **Save as new profile** creates and selects a new profile from current editor values.
- **Save changes** updates the selected profile while preserving the editor.
- **Make default** changes only fallback/library selection.
- **Delete profile** is available only for non-default profiles.
- Automation's redundant **Duplicate** button is removed.
- Manual create/rename rejects duplicate names case-insensitively.
- Assignment and override actions explicitly name the tab/rule effect.

## Compatibility

- Add-on: 0.40.6
- Protocol: 26
- Native Host: 0.13.0
