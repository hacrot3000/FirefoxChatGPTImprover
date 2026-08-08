# Patch Tool v4 compatibility in Python Patch Tool v5.16

> **HISTORICAL v5 DOCUMENT — NOT THE CURRENT PUBLIC WORKFLOW.** Python Patch Tool v6.7.9 supersedes any user-facing command, COLLECT-delivery, transaction or SANDBOX guidance below. Current normal operation is `./tools/run_python_patches.sh`; AI COLLECT requests are ZIP-only; public PATCH execution is in-place and SANDBOX/worktree execution is removed. See `AI_USAGE_CONTRACT.md`, `PORTABLE_USAGE.md` and `PYTHON_PATCH_STANDARD_PROMPT.md`.

## Scope

Python Patch Tool v5.16 can execute patch files/packages created for the original Patch Tool v4 workflow. Compatibility is for consuming existing v4 patches; new AI-generated patches must continue to use the v5 ZIP + manifest standard.

Supported v4 inputs:

- standalone `patch_*.py`;
- standalone Python files carrying recognizable v4 helper markers (`python_patch_utils`, `run_patch`, `PATCH_NAME`);
- `.zip`, `.tar.gz`, or `.tgz` packages containing nested `patch_*.py` scripts;
- v4 fallback packages with no `patch_*.py`: helper-marker scripts are recognized directly; patch-named archives may use the original v4 rule that runs all Python files;
- multiple v4 patch scripts executed in sorted relative-path order;
- v4 helper CLI flags such as `--zip-failed` and `--keep-failed-zip`.

The v5 compatibility runner supplies `tools/_patch_lib/python_patch_utils.py` through `PYTHONPATH`, so a standard v4 patch that inserts `PROJECT_ROOT/tools` and imports `python_patch_utils` continues to work. No loose helper file is required in `tools/`.

## Safety model

A v4 patch has no `PATCH_TOOL_MANIFEST.json` and no `project.key`. Therefore:

- its project scope cannot be verified from package metadata;
- user selection is the explicit confirmation to run it in the current project;
- current Git/source state is the only source of truth;
- local patch history is only a duplicate-run optimization;
- missing history from another machine is never an error;
- a v4 patch never creates or changes local project identity;
- on a new machine, identity is adopted from the first selected **v5** package that actually carries `project.key`;
- a selected v4 package may run before that keyed v5 package as an unscoped compatibility package.

The package still receives v5 protections:

- safe archive extraction;
- syntax preflight;
- process isolation and process-tree cleanup;
- transaction sandbox and verified delta apply;
- rollback/conflict protection;
- smart log filtering and secret redaction;
- root-cause diagnostics and AI handoff bundles;
- local successful-payload duplicate detection.

## Queue recognition

To avoid executing arbitrary Python downloads, a standalone `.py` file must either:

1. follow the v4 name `patch_*.py`; or
2. contain recognizable v4 helper markers.

A manifestless archive normally contains a recognizable v4 Python patch. To preserve the original v4 fallback, a patch-named archive with Python files may run all Python files when no `patch_*.py` exists. Known handoff/report/tool signatures are rejected before this fallback, so an AI handoff containing an incidental example `.py` is quarantined as `non_patch`.

## Strict v5 project policy

The default compatibility policy is:

```json
{
  "package_policy": {
    "require_zip": true,
    "require_manifest": true,
    "require_standard_metadata": true,
    "allow_legacy_v4": true,
    "warn_legacy_v4_unscoped_project": true
  }
}
```

`require_zip`, `require_manifest`, `require_standard_metadata`, and `project_identity.require_patch_key` remain mandatory for v5 packages. They are bypassed only for a positively recognized v4 input while `allow_legacy_v4=true`.

A project that no longer needs old patches can disable compatibility:

```json
{
  "package_policy": {
    "allow_legacy_v4": false
  }
}
```

## Report markers

Every compatibility run states:

```text
PACKAGE_FORMAT: legacy_v4 | legacy_v4_standalone
LEGACY_V4_COMPATIBILITY: TRUE
PROJECT_SCOPE_VERIFIED: FALSE
```

The same data is available in `summary.json` under `legacy_v4_compatibility`.

## Recommended migration

Do not rewrite a v4 patch merely to satisfy the runner if it already works. For a corrected or materially changed revision, return a new v5 package with:

```text
PATCH_TOOL_MANIFEST.json
PATCH_TOOL_OPS.json  # preferred
```

or a manifest plus one `patch_*.py` when the data-only operation DSL is insufficient.
