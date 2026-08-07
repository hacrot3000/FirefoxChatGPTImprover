#!/usr/bin/env python3
"""Optional install/upgrade helper for portable Python Patch Tool v5.16.0.

The release is portable-first: extracting the ZIP at a project root is enough.
This helper remains available for controlled upgrades, backups, and config setup.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
from pathlib import Path
import shutil

TOOL_VERSION = "5.16.0"
INSTALLER_NAME = "install_python_patch_tool_v5"
LIB_ROOT = Path(__file__).resolve().parent
TOOLS_ROOT = LIB_ROOT.parent
PACKAGE_ROOT = TOOLS_ROOT.parent


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Optionally install or upgrade portable Python Patch Tool v5.")
    parser.add_argument("--project-root", type=Path, default=Path.cwd(), help="Target project root.")
    parser.add_argument("--skip-package-hash-check", action="store_true", help="Skip package checksum verification.")
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _checksum_target(name: str) -> Path:
    candidate = (LIB_ROOT / name).resolve()
    allowed_root = TOOLS_ROOT.resolve()
    try:
        candidate.relative_to(allowed_root)
    except ValueError as exc:
        raise RuntimeError(f"Unsafe checksum path outside tools/: {name}") from exc
    return candidate


def verify_package() -> None:
    checksum_file = LIB_ROOT / "SHA256SUMS"
    if not checksum_file.is_file():
        raise RuntimeError("Package is missing tools/_patch_lib/SHA256SUMS")
    checked = 0
    for raw in checksum_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line:
            continue
        expected, name = line.split(None, 1)
        name = name.lstrip("*")
        path = _checksum_target(name)
        if not path.is_file():
            raise RuntimeError(f"Package file listed in SHA256SUMS is missing: {name}")
        actual = sha256_file(path)
        if actual.lower() != expected.lower():
            raise RuntimeError(f"Package hash mismatch for {name}: expected {expected}, got {actual}")
        checked += 1
    if checked == 0:
        raise RuntimeError("SHA256SUMS contains no files")
    print(f"Package integrity: PASS ({checked} portable files)")


def backup_file(root: Path, rel_path: str) -> Path:
    source = root / rel_path
    stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    destination = root / "patchs" / "backup" / rel_path / f"{source.name}.{INSTALLER_NAME}.{stamp}.install.bak"
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    return destination


def ensure_executable(path: Path) -> bool:
    old_mode = path.stat().st_mode
    new_mode = old_mode | 0o111
    if new_mode == old_mode:
        return False
    path.chmod(new_mode)
    return True


def write_if_changed(root: Path, rel_path: str, content: bytes, *, executable: bool = False) -> str:
    path = root / rel_path
    if path.exists() and path.read_bytes() == content:
        if executable:
            ensure_executable(path)
        print(f"unchanged/check: {rel_path}")
        return "unchanged"
    if path.exists():
        backup = backup_file(root, rel_path)
        path.write_bytes(content)
        print(f"backup : {backup.relative_to(root)}")
        print(f"patched: {rel_path}")
        result = "patched"
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        print(f"created: {rel_path}")
        result = "created"
    if executable:
        ensure_executable(path)
    return result


def ensure_local_git_excludes(root: Path) -> None:
    git_dir = root / ".git"
    if not git_dir.is_dir():
        return
    exclude = git_dir / "info" / "exclude"
    exclude.parent.mkdir(parents=True, exist_ok=True)
    existing = exclude.read_text(encoding="utf-8", errors="replace") if exclude.exists() else ""
    required = [
        "/.python_patch_tool_project.json",
        "/patchs/reports/.patch_tool_local_history/",
        "/patchs/reports/.environment_fingerprint_cache.json",
        "/artifacts/.patch_tool_indexes/",
        "/artifacts/patch_tool_code_collections/",
    ]
    missing = [line for line in required if line not in existing.splitlines()]
    if missing:
        with exclude.open("a", encoding="utf-8") as handle:
            if existing and not existing.endswith("\n"):
                handle.write("\n")
            handle.write("# Python Patch Tool machine-local state\n")
            for line in missing:
                handle.write(line + "\n")
        print("local   : .git/info/exclude updated")


def remove_legacy_layout(root: Path) -> list[str]:
    """Remove only known old managed files after backing them up."""
    legacy = [
        "tools/python_patch_runner.py", "tools/python_patch_utils.py", "tools/python_patch_diagnostics.py",
        "tools/python_patch_transaction.py", "tools/python_patch_intelligence.py", "tools/python_patch_identity.py",
        "tools/python_patch_commands.py", "tools/python_patch_source_baseline.py",
        "tools/python_patch_decompile_extractor.py", "tools/python_patch_code_collector.py",
        "tools/collect_code_for_ai.sh", "tools/PYTHON_PATCH_TEMPLATE.py",
        "tools/PYTHON_PATCH_STANDARD_PROMPT.md", "tools/PYTHON_PATCH_TOOL_FEATURE_STATUS.md",
        "tools/CODE_COLLECTION_GUIDE.md", "tools/CODE_COLLECTION_REQUEST.example.json",
        "tools/python_patch_tool_config.example.json", "tools/PATCH_TOOL_MANIFEST.example.json",
        "tools/PATCH_TOOL_OPS.example.json", "document/PYTHON_PATCH_STANDARD_PROMPT.md",
        "document/PYTHON_PATCH_TOOL_FEATURE_STATUS.md", "docs/PYTHON_PATCH_STANDARD_PROMPT.md",
        "docs/PYTHON_PATCH_TOOL_FEATURE_STATUS.md",
    ]
    removed: list[str] = []
    for rel in legacy:
        path = root / rel
        if not path.is_file():
            continue
        backup = backup_file(root, rel)
        path.unlink()
        print(f"migrate : {rel} -> tools/_patch_lib/ (backup: {backup.relative_to(root)})")
        removed.append(rel)
    return removed


def portable_files() -> list[tuple[Path, str, bool]]:
    files: list[tuple[Path, str, bool]] = [(TOOLS_ROOT / "run_python_patches.sh", "tools/run_python_patches.sh", True)]
    for source in sorted(LIB_ROOT.rglob("*")):
        if not source.is_file() or "__pycache__" in source.parts:
            continue
        rel = source.relative_to(LIB_ROOT).as_posix()
        executable = source.suffix == ".py" or source.name.endswith(".sh")
        files.append((source, f"tools/_patch_lib/{rel}", executable))
    return files


def main() -> int:
    args = parse_args()
    if not args.skip_package_hash_check:
        verify_package()
    else:
        print("WARNING: package hash verification was skipped.")

    root = args.project_root.expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    (root / "tools" / "_patch_lib").mkdir(parents=True, exist_ok=True)
    (root / "patchs" / "patched").mkdir(parents=True, exist_ok=True)
    (root / "patchs" / "reports").mkdir(parents=True, exist_ok=True)
    ensure_local_git_excludes(root)

    stats = {"patched": 0, "created": 0, "unchanged": 0}
    for source, target_rel, executable in portable_files():
        result = write_if_changed(root, target_rel, source.read_bytes(), executable=executable)
        stats[result] += 1

    active_config = root / ".python_patch_tool.json"
    config_source = LIB_ROOT / "examples" / "python_patch_tool_config.example.json"
    if not active_config.exists():
        result = write_if_changed(root, ".python_patch_tool.json", config_source.read_bytes())
        stats[result] += 1
        print("active  : .python_patch_tool.json created from safe v5.16 defaults")
    else:
        print("preserve: .python_patch_tool.json")

    removed = remove_legacy_layout(root)
    if stats["patched"] == 0 and stats["created"] == 0 and not removed:
        print("PYTHON PATCH TOOL V5 KHÔNG CÓ THAY ĐỔI")
    print("Install summary:")
    print(f"  patched : {stats['patched']}")
    print(f"  created : {stats['created']}")
    print(f"  unchanged/check: {stats['unchanged']}")
    print(f"  legacy files migrated: {len(removed)}")
    print(f"Python Patch Tool v{TOOL_VERSION} ready.")
    print("Portable workflow: extract ZIP at project root, then run ./tools/run_python_patches.sh")
    print("Optional installer: ./tools/_patch_lib/install_python_patch_tool_v5.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
