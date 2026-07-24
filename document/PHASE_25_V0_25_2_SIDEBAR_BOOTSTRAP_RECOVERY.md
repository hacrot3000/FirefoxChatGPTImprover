# Phase 25 v0.25.2 — Critical sidebar bootstrap recovery

## Blocker

A real Firefox sidebar reload failed before `sidebar.js` could initialize. `defaultConfig()` in `extension/shared/local_actions.js` referenced `download` and `shell`, but those variables only exist inside `normalizeConfig(raw)`. Calling `FCI_LOCAL_ACTIONS.defaultStore()` therefore raised:

```text
ReferenceError: download is not defined
```

Consequences:

- `GET_DASHBOARD` was never requested;
- Tabs and sessions remained empty;
- sidebar event handlers were never registered;
- collapsible-group state was not applied;
- the expanded sticky Save card covered lower content;
- background/content download automation could continue because it runs outside the broken sidebar document.

## Fix

- `defaultConfig()` now returns literal defaults without referencing migration variables.
- Legacy automatic/manual mode migration remains only in `normalizeConfig(raw)`, where `download` and `shell` are defined.
- Sidebar startup is wrapped in `bootstrapSidebar()` and always marks layout initialization complete before requesting the dashboard.
- Installation guide and Save groups default to collapsed when no prior state exists.
- Save remains non-sticky until sidebar initialization succeeds, preventing an uninitialized card from covering the UI.

## Regression coverage

`tests/test_phase25_v0252_sidebar_bootstrap.js` evaluates `local_actions.js` in a JavaScript VM and calls both `defaultConfig()` and `defaultStore()`. This catches runtime top-level/bootstrap failures that syntax and static string-contract tests cannot detect.
