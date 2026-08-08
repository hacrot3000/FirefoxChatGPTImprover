# Adaptive sandbox — Python Patch Tool v5.15.2

> **HISTORICAL v5 DOCUMENT — NOT THE CURRENT PUBLIC WORKFLOW.** Python Patch Tool v6.7.9 supersedes any user-facing command, COLLECT-delivery, transaction or SANDBOX guidance below. Current normal operation is `./tools/run_python_patches.sh`; AI COLLECT requests are ZIP-only; public PATCH execution is in-place and SANDBOX/worktree execution is removed. See `AI_USAGE_CONTRACT.md`, `PORTABLE_USAGE.md` and `PYTHON_PATCH_STANDARD_PROMPT.md`.

The runtime guard stores the latest observed `git worktree` preparation duration per project at:

`patchs/reports/.patch_tool_local_history/sandbox_performance.json`

Default policy:

- First eligible `transaction=auto` run uses sandbox and measures it.
- If the last preparation took more than 60 seconds, the next implicit `auto` run adds `--transaction off`.
- A large warning is printed: the patch is running in-place **without sandbox isolation**.
- Explicit `--transaction auto` forces one sandbox probe even when the previous run was slow.
- Explicit `--transaction required` is never weakened.
- Project config `transaction.mode=required` is never weakened.
- Project config `transaction.mode=off` remains off.

Optional configuration:

```json
{
  "transaction": {
    "adaptive_sandbox": {
      "enabled": true,
      "slow_threshold_seconds": 60
    }
  }
}
```

Environment overrides:

- `PTV_ADAPTIVE_SANDBOX=0` disables adaptive behavior.
- `PTV_SANDBOX_SLOW_SECONDS=90` changes the threshold for the current environment.

Safety trade-off: `transaction=off` runs in-place and therefore does not provide the detached-worktree rollback boundary. The guard always warns when it chooses this fallback automatically.
