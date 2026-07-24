#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import ast
import json
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SKIP_DIRS = {
    ".git", "node_modules", "patchs", "patched", "backup", "backups",
    "__pycache__", ".patch_runner_tmp", ".pytest_cache", ".mypy_cache",
}


def skipped(path: Path) -> bool:
    return any(part in SKIP_DIRS for part in path.relative_to(ROOT).parts)


def collect(suffixes: set[str]) -> list[Path]:
    files: list[Path] = []
    for path in ROOT.rglob("*"):
        if not path.is_file() or skipped(path):
            continue
        if path.suffix.lower() in suffixes:
            files.append(path)
    return sorted(files)


def run_command(command: list[str], path: Path) -> str | None:
    result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, check=False)
    if result.returncode == 0:
        return None
    output = (result.stdout or "") + (result.stderr or "")
    return f"{path.relative_to(ROOT)}:\n{output.rstrip()}"


def main() -> int:
    failures: list[str] = []
    counts = {"javascript": 0, "python": 0, "shell": 0, "json": 0, "svg": 0}

    for path in collect({".js", ".mjs", ".cjs"}):
        counts["javascript"] += 1
        error = run_command(["node", "--check", str(path)], path)
        if error:
            failures.append(error)

    for path in collect({".py"}):
        counts["python"] += 1
        try:
            ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except Exception as exc:
            failures.append(f"{path.relative_to(ROOT)}:\n{type(exc).__name__}: {exc}")

    for path in collect({".sh"}):
        counts["shell"] += 1
        error = run_command(["bash", "-n", str(path)], path)
        if error:
            failures.append(error)

    for path in collect({".json"}):
        counts["json"] += 1
        try:
            json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            failures.append(f"{path.relative_to(ROOT)}:\n{type(exc).__name__}: {exc}")

    for path in collect({".svg"}):
        counts["svg"] += 1
        try:
            ET.parse(path)
        except Exception as exc:
            failures.append(f"{path.relative_to(ROOT)}:\n{type(exc).__name__}: {exc}")

    if failures:
        print("SOURCE SYNTAX AUDIT FAILED", file=sys.stderr)
        for index, failure in enumerate(failures, 1):
            print(f"\n[{index}] {failure}", file=sys.stderr)
        return 1

    print(
        "PASS: full source syntax audit — "
        f"JavaScript={counts['javascript']}, Python={counts['python']}, "
        f"Shell={counts['shell']}, JSON={counts['json']}, SVG={counts['svg']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
