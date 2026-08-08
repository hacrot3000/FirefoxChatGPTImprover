# Scoped file transaction — Python Patch Tool v5.15.13

## Goal

Avoid constructing a full detached Git worktree for a small, statically-known data-only patch. A project with tens of thousands of files should not pay a full checkout cost when a patch can be proven to target one or a few files.

## Default auto policy

When transaction mode is implicit/configured `auto`, the runtime guard inspects the candidate package set. If every candidate that may run is a v5 ZIP with `PATCH_TOOL_OPS.json`, has no Python patch entrypoint, every operation target is a literal safe project-relative file, and the union has at most 12 files by default, the guard selects `scoped_file_transaction`. It snapshots only those target files and invokes the core with `--transaction off`.

Zero-argument selection occurs inside the private core, so before the selector the guard cannot know which queue item the user will choose. Therefore scoped mode is enabled only when the union of all currently runnable queue packages is statically safe and within the file budget. With explicit `--patch`, only those requested packages are considered.

On patch/validation failure, target files are restored from the scoped snapshot. Newly-created target files are removed. If Git HEAD changed during the invocation (for example a commit succeeded and push later failed), automatic rollback is skipped because restoring the working tree would contradict the new commit. Build caches or other validation artifacts outside the declared target list are not rolled back.

Python/dynamic/v4 packages, unknown operation scope, unsafe paths, or scope above the limit fall back to the existing adaptive full-worktree sandbox policy. `--transaction required` is never weakened. Explicit `--transaction auto/off/required` is respected.

## Configuration

```json
{
  "transaction": {
    "mode": "auto",
    "scoped_files": {
      "enabled": true,
      "max_files": 12
    }
  }
}
```

Disable for one environment with `PTV_SCOPED_FILE_TRANSACTION=0`.

## Safety model

Scoped mode is an optimization for exact data-only file scope, not a full filesystem sandbox. It protects declared source targets but does not isolate arbitrary writes from validation commands or external concurrent editors. Use `--transaction required` when full worktree isolation is mandatory.
