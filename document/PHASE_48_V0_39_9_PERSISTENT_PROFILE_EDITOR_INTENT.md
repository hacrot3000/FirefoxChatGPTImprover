# Phase 48 v0.39.9 — Persistent profile editor intent

## Scope

- Persist Automation and Local action editor selections per tab in sidebar UI storage.
- Persist inactive-tab manual Automation choice and stopped-snapshot bypass.
- Bind persisted state to the tab URL so navigation or recycled tab IDs cannot reuse stale profile intent.
- Show the profile being edited separately from the profile currently used by the tab.
- Select a newly duplicated Automation profile immediately.

## Safety

This phase stores only profile IDs, tab IDs and the corresponding tab URL in the existing sidebar UI key. It does not duplicate profile data, change tab runtime configuration or apply an edited profile without an explicit Apply/Start action.
