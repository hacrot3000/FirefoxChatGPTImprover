# Phase 44 v0.39.5 — Stop/Start tab configuration persistence

## Result

`Stop` now saves a `browser.sessions` configuration snapshot keyed by the open tab. The active runtime session is still deleted, but the next `Start` reconstructs the session from the snapshot instead of URL routing/default configuration.

## Preserved

- selected configuration profile and profile-based/tab-specific mode;
- tab configuration and current sidebar automation draft;
- selected Local action profile, tab override and working draft;
- custom tab title through its existing independent tab-session storage.

## Reset intentionally

- monitor/target runtime and baselines;
- alerts and cycle counters;
- activity logs and per-rule statistics;
- picker state and active content runtime.

## Safety

The preserved configuration must still allow the tab's current URL. A deliberate profile selection while stopped overrides the stored snapshot. If a referenced profile changed, the frozen effective configuration is restored as a tab override rather than silently adopting new/default values.
