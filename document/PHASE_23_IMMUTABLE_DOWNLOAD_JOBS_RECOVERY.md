# Phase 23 — Immutable managed-download jobs and relocation recovery

Phase 23 makes each target-triggered download an immutable local-action job. The destination and optional shell command are frozen when the target is clicked rather than read again after the browser download finishes.

## Correctness guarantees

- Changing the selected local-action profile, URL route, tab override, destination, or shell command while a file is downloading does not alter that in-flight job.
- Automatic shell execution is allowed only when the original tab session token is still current.
- Firefox download-manager fallback attribution never chooses an arbitrary tab when more than one capture window is armed.
- Download job state is persisted with the tab session and restored after a background restart.
- A completed browser download resumes relocation from its frozen snapshot after recovery.
- A relocation interrupted after dispatch is not replayed automatically because the move may already have succeeded; the sidebar exposes an explicit **Retry relocation** action instead.

## Retry behavior

Retry uses the original absolute destination, conflict policy, and source path. It never re-reads the current profile. Native Host path validation remains authoritative, and a missing/out-of-scope source file fails safely.

No Native Host reinstall is required for this phase.
