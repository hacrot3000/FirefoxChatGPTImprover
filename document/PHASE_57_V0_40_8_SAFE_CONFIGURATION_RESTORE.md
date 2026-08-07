# Phase 57 v0.40.8 — Safe configuration restore

Full Automation configuration import and recovery-snapshot restore replace the global Automation library without silently changing the effective configuration of tabs that are already active or explicitly stopped.

- A profile that still exists with the same effective configuration remains profile-backed.
- A profile that was removed or changed causes the affected tab to keep its previous effective values as a tab override.
- Existing tab overrides remain overrides; if their base profile disappears, only the base reference is rebound.
- Stopped-tab snapshots receive the same treatment and remain valid for the next Start.
- No imported/restored configuration is pushed to a running content script merely because the library was replaced.
- The pre-import/pre-restore recovery snapshot behavior remains unchanged.

Protocol remains 26 and Native Host remains 0.13.0.
