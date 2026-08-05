# Phase 32 v0.32.0 — Optional sound alerts

## Goal

Add an audible alert channel without changing the established title, badge, sidebar or desktop-notification behavior and without enabling sound automatically for existing users.

## User controls

The **Alerts** group now includes:

- **Sound alert (opt-in)** — disabled by default;
- tone selection: **Soft chime**, **Double beep**, or **Urgent**;
- volume from 0 to 100 percent;
- repeat count from 1 to 5;
- repeat interval from 250 to 10000 ms;
- **Test sound** preview.

The settings are part of the effective configuration, so they can be saved in Configuration profiles or as a tab-specific override.

## Runtime guarantees

- Sound is scheduled at most once for each alert cycle.
- Repeated runtime updates inside the same cycle do not replay it.
- Reload/background recovery of an already-active cycle does not replay it.
- Pending repeats are stopped when the alert is dismissed, paused, stopped, or otherwise leaves the active alert lifecycle.
- Failure to create or resume an audio context is reported in runtime state and does not break monitoring.

## Versions

- Add-on: 0.32.0
- Settings schema: 17
- Protocol: 21
- Content runtime: 28
- Alert engine: 12
- Native Host: 0.13.0 (unchanged)
