#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
import tempfile
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import release_documentation as module


documents = module.load_release_documents("0.30.0")
assert "Search/filter controls" in documents.changelog_entry
assert "Named saved working-session catalog" in documents.in_progress
assert "Optional sound alert" in documents.planned
assert "Native Host for macOS" in documents.deferred

metadata = {
    "version": "0.30.0",
    "addonId": "test@example.invalid",
    "builtAtUtc": "2026-08-05T00:00:00+00:00",
    "gitCommit": "abc123",
    "nativeHostVersion": "0.13.0",
    "artifact": {"filename": "addon.zip", "sha256": "deadbeef"},
}
notes = module.release_notes_text(metadata, documents, "Additional test note")
for heading in (
    "## What's new in this release",
    "## Current capabilities",
    "## In progress",
    "## Planned next",
    "## Deferred",
    "## Additional release notes",
):
    assert heading in notes, heading
assert "PROJECT_STATUS.md" in notes
assert "CHANGELOG.md" in notes

with tempfile.TemporaryDirectory() as temp_dir:
    copied = module.copy_release_documents(Path(temp_dir), documents)
    assert (Path(temp_dir) / "PROJECT_STATUS.md").is_file()
    assert (Path(temp_dir) / "CHANGELOG.md").is_file()
    assert len(copied["projectStatus"]["sha256"]) == 64
    assert len(copied["changelog"]["sha256"]) == 64

with tempfile.TemporaryDirectory() as temp_dir:
    temp = Path(temp_dir)
    status = temp / "PROJECT_STATUS.md"
    changelog = temp / "CHANGELOG.md"
    status.write_text(documents.project_status.replace("**0.30.0**", "**0.29.0**", 1), encoding="utf-8")
    changelog.write_text(documents.changelog, encoding="utf-8")
    try:
        module.load_release_documents("0.30.0", project_status_path=status, changelog_path=changelog)
    except ValueError as exc:
        assert "stale" in str(exc)
    else:
        raise AssertionError("stale project status version was accepted")

release_source = (ROOT / "tools" / "release_firefox_addon.py").read_text(encoding="utf-8")
assert "load_release_documents(version)" in release_source
assert "copy_release_documents(release_dir, documents)" in release_source
assert "documentation_assets(release_dir)" in release_source

publish_source = (ROOT / "tools" / "release_publish.sh").read_text(encoding="utf-8")
assert 'PROJECT_STATUS_FILE="${RELEASES_DIR}/PROJECT_STATUS.md"' in publish_source
assert 'CHANGELOG_FILE="${RELEASES_DIR}/CHANGELOG.md"' in publish_source

vscode_tasks = json.loads((ROOT / ".vscode" / "tasks.json").read_text(encoding="utf-8"))
labels = {task.get("label"): task for task in vscode_tasks.get("tasks", [])}
assert "Firefox Add-on: Check Release Documentation" in labels
publish_task = labels["Firefox Add-on: Build Release + Publish to GitHub"]
assert "PROJECT_STATUS.md" in publish_task.get("detail", "")
assert "CHANGELOG.md" in publish_task.get("detail", "")

print("PASS: release documentation, changelog, rich GitHub notes and release assets")
