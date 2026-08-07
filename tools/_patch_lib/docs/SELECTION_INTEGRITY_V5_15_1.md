# Python Patch Tool v5.15.1 — Selection integrity hotfix

## Fixed incident

v5.15.0 could, in a multi-package queue, execute only the selected package but later classify another unselected package as `SKIPPED:DUPLICATE_SUCCESS`. That removed the unselected package from the runnable queue.

v5.15.1 enforces post-run queue integrity without changing patch payload semantics:

- selected + executed + PASS: normal PASS handling;
- selected + executed + FAIL: stays available according to core policy;
- unselected: must stay in `patchs/`;
- legitimate duplicate already attested before the run: remains in `ignored/duplicate_success`;
- false duplicate created during the current run for an unexecuted package: restored automatically.

The incident package `patch_nfc179_protected_read_consume_cleanup_boundary_v5_20260807_1320.zip` is also recovered automatically if it is still present in the duplicate-success quarantine.

## Installation

This package is a direct **v5.15.0 -> v5.15.1 upgrade overlay** in the standard portable layout. From a project that already has v5.15.0 installed:

```bash
unzip -o python_patch_tool_v5.15.1_package.zip -d "$PWD"
./tools/run_python_patches.sh
```

It intentionally does not overwrite unchanged v5.15.0 private modules. Existing `.python_patch_tool.json`, project identity, history, reports and project files are preserved.
