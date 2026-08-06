#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def version_tuple(value: str) -> tuple[int, ...]:
    return tuple(int(part) for part in value.split("."))


manifest = json.loads(read("extension/manifest.json"))
assert version_tuple(manifest["version"]) >= (0, 39, 3), manifest["version"]

project_status = read("PROJECT_STATUS.md")
assert "Required-feature backlog: **completed**" in project_status
assert "Recommended-feature backlog: **completed**" in project_status
assert "Recommended-feature backlog: **in progress**" not in project_status
assert "Native Host for macOS" in project_status and "Deferred" in project_status

current_status = read("document/CURRENT_PROJECT_STATUS.md")
assert "## Phase 42 v0.39.3" in current_status
assert "next recommended item is the full accessibility audit" not in current_status.lower()
assert "No required or recommended implementation tasks remain" in current_status

plan = read("document/PROJECT_IMPLEMENTATION_PLAN.md")
assert "Phase 42 — Release-candidate status consistency" in plan
assert "No scheduled implementation item" in plan

changelog = read("CHANGELOG.md")
assert "## [0.39.3] - 2026-08-06" in changelog
assert "release-status consistency regression" in changelog

readme = read("README.md")
assert "FCI_PHASE42_RELEASE_STATUS_CONSISTENCY_BEGIN" in readme
assert "releases/chromium/<browser>/<current-version>/" in readme
assert "releases/chromium/<browser>/0.38.0/" not in readme

runner = read("tools/test_firefox_addon.sh")
assert "tests/test_phase42_v0393_release_status_consistency.py" in runner
assert "PASS: FirefoxChatImprover Phase 04-" in runner

print("PASS: Phase 42 release-status consistency remains valid on later versions")
