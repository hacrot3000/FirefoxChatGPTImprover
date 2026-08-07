# Portable use — Python Patch Tool v5.15.2

Direct upgrade from an existing v5.15.0 or v5.15.1 installation:

```bash
unzip -o python_patch_tool_v5.15.2_package.zip -d "$PWD"
./tools/run_python_patches.sh
```

The package uses the normal final `tools/` layout. It does not include an installer at the ZIP root.

v5.15.2 keeps the installed v5.15 core and adds a runtime-integrity layer for:

1. unselected-patch success/duplicate protection;
2. adaptive sandbox skipping when the previous isolated-worktree preparation was too slow.

Run the package self-test with:

```bash
python3 tools/_patch_lib/self_test_runtime_integrity_v5_15_2.py
```
