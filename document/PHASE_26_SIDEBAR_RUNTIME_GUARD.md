# Phase 26 — Sidebar preload runtime guard

Version: **0.26.0**

## Purpose

The sidebar now loads a small runtime guard before every other sidebar dependency. A JavaScript error in `protocol.js`, `settings.js`, `local_actions.js`, or the main `sidebar.js` can no longer leave a blank or apparently frozen sidebar without visible evidence.

## Behavior

- Captures global `error` and `unhandledrejection` events before the normal sidebar scripts load.
- Shows an English recovery panel with the failing stage, message and stack trace.
- Provides **Retry dashboard**, **Reload sidebar**, and **Copy diagnostics** actions.
- Keeps the Save card in normal document flow while startup is failed.
- Separates collapsible-layout failure from dashboard failure; a layout error no longer prevents `GET_DASHBOARD`.
- Deduplicates repeated failures and bounds the retained diagnostics.
- Clears the recovery panel after the failing stage succeeds.

## Regression coverage

`tests/test_phase26_sidebar_runtime_guard.js` executes the real preload guard in a VM with a functional fake DOM. It verifies fatal dependency capture, visible diagnostics, clipboard output, retry/reload actions, script load order, dashboard retry wiring and the `0.26.0` manifest contract.

No Native Host update is required for Phase 26.
