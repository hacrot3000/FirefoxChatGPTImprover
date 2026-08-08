# Python Patch Tool mini-AI — public contract v6.7.9

This is the current AI-facing contract for this project. It supersedes historical v5 examples that used manual COLLECT subcommands, loose request JSON or transaction/SANDBOX worktrees.

## Public user entry point

Normal user operation is always:

```bash
./tools/run_python_patches.sh
```

Do not instruct the user to add COLLECT-specific arguments. Do not instruct the user to re-enable transaction/SANDBOX/worktree execution.

## PATCH delivery

Return exactly one PATCH ZIP. A new v5+ package should contain a root `PATCH_TOOL_MANIFEST.json` and exactly one payload type:

```text
patch_<project>_<phase>_<purpose>_<timestamp>.zip
├── PATCH_TOOL_MANIFEST.json
└── PATCH_TOOL_OPS.json
```

Use a `patch_*.py` payload only when the operation DSL is insufficient; do not include both entrypoint types in one package. Keep paths project-relative and make patches idempotent.

The public v6.7.9 launcher routes supported PATCH execution in-place and forces the compatible installed core to `--transaction off`. SANDBOX/detached-worktree execution is removed from the supported workflow.

## COLLECT request delivery — strict

When more source/evidence is needed, the AI deliverable is one request ZIP, never a loose JSON:

```text
CODE_COLLECTION_REQUEST_<purpose>_<timestamp>.zip
└── CODE_COLLECTION_REQUEST_<purpose>_<timestamp>.json
```

The ZIP must contain exactly one file whose basename matches `CODE_COLLECTION_REQUEST*.json`. The request contains readonly collection actions only.

Tell the user only:

1. Put the request ZIP directly in `<project>/patchs/`.
2. Run `./tools/run_python_patches.sh`.
3. Select the `[COLLECT]` item in the normal queue; a sole item is preselected.
4. Upload the resulting source/evidence collection ZIP back to the AI.

Never provide a loose request `.json` as the primary artifact. Never tell the user to copy a loose request JSON into `patchs/`. Never present internal manual COLLECT routing syntax as normal user guidance.

## Request ZIP versus result ZIP

- **Request ZIP:** AI-created readonly instruction package placed in `patchs/`.
- **Result collection ZIP:** tool-created evidence/source package uploaded back to the AI.

On successful COLLECT, the tool highlights the result exactly once under `[PRIMARY - UPLOAD THIS FILE]`; the archived request path is informational only.

## Queue behavior

The zero-argument queue recognizes structured v5+ PATCH packages, documented legacy-v4 packages and COLLECT request ZIPs. HANDOFF/report/tool-distribution archives and symlink queue entries are not executable queue work. A root `PATCH_TOOL_MANIFEST.json` takes precedence over nested COLLECT resources.

A single remaining item is selected by default. Mixed PATCH/COLLECT automatic selection falls back to user confirmation. Selected work runs in natural order and stops on the first failure; later selected entries remain queued as skipped/not executed.

## Current v6.7.9 COLLECT behavior

- one-line TTY progress with live terminal-width recalculation;
- bounded status text and invalid-UTF-8/control-character robustness;
- line-oriented non-TTY output;
- dedicated collector process group with SIGINT/SIGTERM forwarding and escalation;
- successful result ZIP path deduplicated and highlighted once;
- readonly COLLECT does not use transaction worktrees.

## Authority

For AI-facing behavior, these bundled files are authoritative:

- `docs/AI_USAGE_CONTRACT.md`
- `docs/PORTABLE_USAGE.md`
- `docs/COLLECT_PROGRESS_V6_7_9.md`
- `docs/PYTHON_PATCH_TOOL_FEATURE_STATUS.md`

Historical private-core documents may describe older internal mechanisms. They must not override this v6.7.9 public contract.
