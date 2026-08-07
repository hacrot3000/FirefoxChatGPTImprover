# Phase 45 v0.39.6 — Explicit stopped-tab state reconciliation

## Result

`Stop` is now both a configuration checkpoint and an explicit inactive state. URL auto-activation cannot reactivate the tab after reload or browser/background startup.

## Profile reconciliation

- Apply Local action profile while stopped: the snapshot is rewritten to that profile and the superseded tab/working draft is discarded.
- Use URL/default while stopped: the routed/default profile is written into the snapshot and remains effective on Start.
- Select another configuration profile or URL route: Start bypasses the old snapshot deliberately.
- Sidebar refresh shows the newly selected source rather than repainting stale snapshot data.

## Failure safety

The snapshot is removed only after the new active session is applied and persisted successfully. Permission denial, content-script failure or activation rollback leaves the stopped configuration available for another Start attempt.
