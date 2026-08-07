# Phase 54 v0.40.5 — Explicit Monitor/Target default controls

## Goal

Complete the profile-library lifecycle by making Monitor and Target defaults explicit and non-destructive, matching the safety rules already used by Automation and Local action profiles.

## Behaviour

- **Set as default** is available in both component-profile panels.
- The selected default is only the initial/fallback library selection.
- No Automation rule, tab session, stopped snapshot or draft is modified.
- The current default cannot be deleted until another profile is chosen as default.
- Renaming remains compact through **Profile name** followed by **Save current values**.

## Compatibility

- Add-on: 0.40.5
- Protocol: 26
- Native Host: 0.13.0
