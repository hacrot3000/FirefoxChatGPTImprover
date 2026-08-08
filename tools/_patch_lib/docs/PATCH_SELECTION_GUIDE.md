# Patch selection integrity — Python Patch Tool v5.15.13

The zero-argument selector is still provided by the installed v5.15 core. Per the v5.15 contract, not-selected packages remain in the queue and only `PATCHES EXECUTED` identifies packages that actually ran.

v5.15.13 validates that contract after the core returns, using only last-run reports written in the current invocation. Payload SHA-256, not basename alone, is the strong identity for duplicate-success history.


## Queue content changed while the selector is open

The pre-run SHA-256 is not the only identity for same-filesystem queue moves. If an unexecuted package is edited while the selector is open and the core then incorrectly moves it out of the queue, v5.15.13 recognizes the same dev+inode and restores the newer bytes. Cross-filesystem recovery still requires the original SHA-256 plus current-invocation filesystem evidence.

## Interrupted-run recovery

A stale guard journal is reconciled only when the interrupted invocation itself wrote changed LAST_RUN evidence. Even then, automatic queue restoration is limited to packages explicitly recorded as SKIPPED / NOT EXECUTED. Merely being absent from PATCHES EXECUTED is not sufficient after a crash.


## v5.15.13 crash evidence boundary

Crash recovery no longer trusts a changed LAST_RUN merely because an old guard journal exists.
The guard writes a post-core checkpoint immediately after the core process exits. Automatic
reconciliation after a crash requires that checkpoint and exact matching LAST_RUN file states.
A later manual/core invocation therefore cannot be mistaken for the interrupted guarded run.

## FAIL packages remain runnable

v5.15.13 also verifies the selected-package failure contract. A package explicitly reported as
`EXECUTED + FAIL` must remain in `patchs/`. If a core defect moves it to `patched/` or
`ignored/duplicate_success/`, the runtime-integrity layer restores it without rerunning it.

## Readonly collection policy (v5.15.13)

Source-inspection commands do not need transaction rollback isolation. New `collect search-pack`,
`collect select`, `collect search-files`, and `collect request` commands are dispatched directly to
the readonly collector and never create a Git worktree. Legacy core `collect`, `research`, `inspect`,
`query`, and `overview` verbs automatically receive `--transaction off` unless the caller explicitly
requests another transaction mode.

## Readonly discovery and SANDBOX

Source discovery/collection is not patch execution. Direct readonly collector commands bypass transaction SANDBOX/worktree preparation and do not change project source/Git state. Complete commands, JSON schema, automatic investigation expansion, limits, provenance and artifact format are documented in `READONLY_COLLECTION_V5_15_13.md`.


## v5.15.13 performance note

Readonly research never uses SANDBOX. Small exact data-only patches can use scoped-file transaction instead of a full Git worktree; see `SCOPED_TRANSACTION_V5_15_13.md`. Dynamic patches retain the full/adaptive sandbox path.
