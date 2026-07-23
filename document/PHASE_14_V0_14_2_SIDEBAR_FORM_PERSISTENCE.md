# Phase 14 v0.14.2 — Sidebar form stability and persistence hotfix

- Runtime updates are debounced and rendered without rewriting the configuration form.
- Profile name, monitor selector, conditions and target fields are reloaded only when the selected tab/profile context actually changes or after an explicit storage operation.
- Profile save and JSON import verify the normalized configuration after storage write.
- Runtime dashboard broadcasts are coalesced per tab to avoid UI refresh storms.

This hotfix preserves independent multi-tab runtime state and does not add VS Code tasks.
