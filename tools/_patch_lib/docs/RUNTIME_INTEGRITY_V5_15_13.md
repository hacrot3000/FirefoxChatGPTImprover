# Python Patch Tool v5.15.13 runtime integrity

## Post-core crash checkpoint

Immediately after the private core process exits, the guard records a durable `core_completed`
checkpoint in `guard_invocation.json`. The checkpoint binds the invocation to the exact
`last_run.json`, `LAST_RUN.md`, success-ledger size/hash, core return code, and completion time.

A later guarded launch will auto-reconcile an interrupted invocation only when the checkpoint
exists and the current LAST_RUN files still match the checkpoint exactly. If another manual or
unguarded core run changed those files, the old invocation is ambiguous and no queue/history
mutation is attempted.

If the checkpoint itself cannot be written after the core has already exited, the current run
continues its normal integrity cleanup and prints a warning. This avoids making an already
executed patch appear safely rerunnable. Future crash recovery remains conservative.

## Bounded stale-history cleanup

For a checkpointed interrupted run, false success records are removed only from the byte range
created between the recorded pre-run and post-core success-ledger boundaries. Records appended
by later activity are preserved. Both boundaries must pass SHA-256 verification before any
rewrite occurs.

## Filesystem time window

Stale-invocation recovery also bounds quarantine/patched-file evidence to the interrupted run's
start and core-completion times. A file moved later by an unrelated invocation is not treated as
the interrupted run's queue movement.

## Existing guarantees retained

- Only current-invocation `EXECUTED + PASS` may create success evidence.
- Executed FAIL, skipped, not-executed and ambiguous outcomes are not successful.
- Same-file dev+inode can preserve updated bytes for an unexecuted package during a live selector run.
- Project run lock, lazy history scanning and adaptive sandbox skip/re-probe remain active.

## Failed-package queue retention

The primary v5.15 contract distinguishes successful, failed and unselected packages:

- successful selected package: may move to `patchs/patched/`;
- failed selected package: must remain available in `patchs/` for replacement or rerun;
- unselected package: must remain unchanged in `patchs/`.

v5.15.13 enforces this after the private core returns. If current-run evidence proves
`EXECUTED + FAIL` but the core moved that package to `patchs/patched/` or
`patchs/ignored/duplicate_success/`, the guard restores the package to the runnable queue.
It also removes any newly-created false success evidence for that failed package.

`EXECUTED_UNKNOWN` remains conservative and is not auto-moved because the project may have
been partially mutated without a trustworthy final outcome.

The same rule applies during checkpointed crash recovery: an explicitly failed package is
restored to the queue, while ambiguous outcomes are never automatically rerun.
