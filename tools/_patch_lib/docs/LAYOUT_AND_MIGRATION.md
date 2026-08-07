# Patch Tool v5.16 portable layout

## Primary installation: extract and run

Extract the release ZIP directly at the project root:

```bash
unzip python_patch_tool_v5.16.0_package.zip -d "$PWD"
./tools/run_python_patches.sh
```

No installer command is required.

## Release and installed layout

The ZIP already has the final project-relative paths:

```text
project/
└── tools/
    ├── run_python_patches.sh
    └── _patch_lib/
        ├── python_patch_runner.py
        ├── python_patch_code_collector.py
        ├── python_patch_selector.py
        ├── install_python_patch_tool_v5.py   # optional helper
        ├── docs/
        ├── examples/
        ├── templates/
        └── SHA256SUMS
```

`tools/run_python_patches.sh` is the only public runtime entry point. It must never be placed inside `tools/_patch_lib/`.

## Direct upgrade

A later portable package may be extracted over the same project root. Files under `tools/run_python_patches.sh` and `tools/_patch_lib/` are replaced in place. Project files outside the Patch Tool-managed layout are untouched.

For an upgrade that needs per-file backups and legacy-layout cleanup, the optional helper remains available:

```bash
python3 tools/_patch_lib/install_python_patch_tool_v5.py --project-root "$PWD"
```

The helper is not required for normal use.

## Compatibility

- Existing `.python_patch_tool.json` is not part of the ZIP and is therefore not overwritten by direct extraction.
- Runtime defaults cover missing configuration fields.
- The runner creates required queue/report directories on demand.
- Existing project-specific files in `tools/` are not removed by direct extraction.
- The optional installer only removes a fixed list of old Patch Tool-managed loose files and backs them up first.

## Runtime selection

The public launcher starts the v5.16 interactive queue selector by default. It does not silently run all queued packages. Use `--all` only for deliberate non-interactive automation.
