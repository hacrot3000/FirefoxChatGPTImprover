#!/usr/bin/env python3
"""Bump the three-part Firefox extension version without editing other manifest fields."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
MANIFEST = PROJECT_ROOT / "extension" / "manifest.json"
VERSION_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")


def parse_version(value: str) -> tuple[int, int, int]:
    match = VERSION_RE.fullmatch(value.strip())
    if not match:
        raise ValueError("version must use MAJOR.MINOR.PATCH numeric form")
    return tuple(int(part) for part in match.groups())


def next_version(current: str, mode: str) -> str:
    major, minor, patch = parse_version(current)
    if mode == "major":
        return f"{major + 1}.0.0"
    if mode == "minor":
        return f"{major}.{minor + 1}.0"
    if mode == "patch":
        return f"{major}.{minor}.{patch + 1}"
    candidate = parse_version(mode)
    if candidate <= (major, minor, patch):
        raise ValueError("new version must be greater than current version")
    return ".".join(str(part) for part in candidate)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--patch", action="store_true")
    group.add_argument("--minor", action="store_true")
    group.add_argument("--major", action="store_true")
    group.add_argument("--set", dest="set_version")
    args = parser.parse_args(argv)

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    old = str(manifest["version"])
    mode = "patch" if args.patch else "minor" if args.minor else "major" if args.major else args.set_version
    new = next_version(old, mode)
    manifest["version"] = new
    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"UPDATED: {old} -> {new}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, KeyError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
