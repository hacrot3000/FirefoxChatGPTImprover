# Phase 28 v0.28.8 — Same-tab session rebind and popup Execute readiness

This hotfix removes two independent causes of inconsistent post-download shell behavior across tabs.

## Root causes

1. A managed download job was tied to the content runtime `sessionToken`. Chat navigation or content-runtime reattachment can replace that token while the Native Host is moving the file. The response still belongs to the same browser tab and capture, but automatic/manual execution was rejected as an obsolete session.
2. The page-centered completion popup used an old rule that enabled Execute only when `shellExecutionMode === "manual"`. It therefore disabled the button in automatic mode even when automatic startup failed before creating a run ID and a safe manual fallback was available.
3. Already-open tabs could retain the previous content runtime and its old popup logic.

## Correct behavior

- The immutable job identity is the original `tabId + captureId`; a changing session token no longer invalidates a completed same-tab download.
- The current session token is rebound only as runtime ownership metadata. The frozen destination, command, working directory and local-action revision are not changed.
- A successful move publishes an `available` state before automatic startup.
- If automatic startup fails without a `runId`, the state is published again as a manual fallback.
- The page popup and sidebar use `LocalActions.downloadShellReadiness()` instead of inferring readiness from editor mode.
- The popup button is enabled for a valid manual job or a valid automatic fallback and disabled only while a run is active or after a run ID already exists.
- Content runtime version 20 replaces the old popup implementation in existing tabs after the add-on is reloaded/reinjected.

No Native Host source is changed by this patch.
