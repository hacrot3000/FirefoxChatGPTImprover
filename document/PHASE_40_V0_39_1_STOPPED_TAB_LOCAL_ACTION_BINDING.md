# Phase 40 v0.39.1 — Stopped-tab Local action profile binding

## Problem

A newly created Local action profile could be selected and saved while the current tab was stopped, but **Apply to tab** remained disabled because the sidebar required an active automation session. Starting the tab then created a new session from URL routing or the default Local action profile, so the selected profile appeared to revert immediately.

## Corrected behavior

- **Apply to tab** is enabled for the currently displayed tab even when its automation state is stopped.
- Applying to a stopped tab stores an explicit tab-scoped Local action profile binding using browser tab-session storage.
- The binding is returned in the dashboard, so refreshing or reopening the sidebar keeps the applied profile selected.
- Activation checks the explicit tab binding before URL routing and default fallback.
- Applying a profile to an already active tab writes the same binding, so a later Stop/Start cycle preserves the explicit selection.
- Deleting a bound profile replaces stale bindings with the current routed or default Local action profile.
- Working-session listing/export includes the explicit binding for stopped tabs.

## Scope

The binding contains only the Local action profile ID. Profile configuration remains stored in the existing Local action profile store, so later profile edits automatically affect every tab bound to that profile.

## Version matrix

- Extension: 0.39.1
- Protocol: 25, unchanged
- Native Host: 0.13.0, unchanged
- Firefox and Chromium/Chrome/Edge: supported through the shared tab-session abstraction

## Regression coverage

`tests/test_phase40_v0391_stopped_tab_local_action_binding.js` verifies:

- inactive-tab Apply is not disabled solely because the session is absent;
- the exact selected profile ID is written to tab-session storage;
- dashboard and activation source contain the explicit-binding path;
- deletion cleanup and working-session preservation contracts remain present;
- the extension version is 0.39.1.
