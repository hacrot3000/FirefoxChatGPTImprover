#!/usr/bin/env python3
"""Validate and assemble release-facing FirefoxChatImprover documentation."""
from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
import re
import shutil
import sys
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
PROJECT_STATUS_PATH = PROJECT_ROOT / "PROJECT_STATUS.md"
CHANGELOG_PATH = PROJECT_ROOT / "CHANGELOG.md"
MANIFEST_PATH = PROJECT_ROOT / "extension" / "manifest.json"
REQUIRED_STATUS_SECTIONS = (
    "Completed features",
    "In progress",
    "Planned features",
    "Deferred",
)


@dataclass(frozen=True)
class ReleaseDocuments:
    version: str
    project_status: str
    changelog: str
    changelog_entry: str
    completed: str
    in_progress: str
    planned: str
    deferred: str


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def manifest_version(path: Path = MANIFEST_PATH) -> str:
    if not path.is_file():
        raise ValueError(f"extension manifest not found: {path}")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid extension manifest JSON: {exc}") from exc
    version = str(payload.get("version", "")).strip() if isinstance(payload, dict) else ""
    if not version:
        raise ValueError("extension manifest has no version")
    return version


def extract_heading_section(markdown: str, heading: str, *, level: int = 2) -> str:
    marker = f"{'#' * level} {heading}"
    lines = markdown.splitlines()
    start: int | None = None
    collected: list[str] = []
    for index, line in enumerate(lines):
        if line.strip() == marker:
            start = index + 1
            continue
        if start is None:
            continue
        if re.match(rf"^#{{1,{level}}}\s+", line):
            break
        collected.append(line)
    if start is None:
        raise ValueError(f"missing section: {marker}")
    value = "\n".join(collected).strip()
    if not value:
        raise ValueError(f"empty section: {marker}")
    return value


def extract_changelog_entry(changelog: str, version: str) -> str:
    lines = changelog.splitlines()
    pattern = re.compile(rf"^## \[{re.escape(version)}\](?:\s+-\s+.+)?$")
    start: int | None = None
    collected: list[str] = []
    for index, line in enumerate(lines):
        if pattern.match(line.strip()):
            start = index + 1
            continue
        if start is None:
            continue
        if line.startswith("## "):
            break
        collected.append(line)
    if start is None:
        raise ValueError(
            f"CHANGELOG.md has no section for current manifest version {version}; "
            f"add '## [{version}] - YYYY-MM-DD' before building a release"
        )
    value = "\n".join(collected).strip()
    if not value:
        raise ValueError(f"CHANGELOG.md section for {version} is empty")
    return value


def validate_project_status_version(project_status: str, version: str) -> None:
    match = re.search(r"^- Current add-on version:\s*\*\*([^*]+)\*\*\s*$", project_status, re.MULTILINE)
    if not match:
        raise ValueError(
            "PROJECT_STATUS.md must contain '- Current add-on version: **<version>**'"
        )
    status_version = match.group(1).strip()
    if status_version != version:
        raise ValueError(
            f"PROJECT_STATUS.md is stale: current add-on version is {status_version}, "
            f"but extension/manifest.json is {version}"
        )


def load_release_documents(
    version: str | None = None,
    *,
    project_status_path: Path = PROJECT_STATUS_PATH,
    changelog_path: Path = CHANGELOG_PATH,
) -> ReleaseDocuments:
    resolved_version = version or manifest_version()
    if not project_status_path.is_file():
        raise ValueError(f"missing release documentation: {project_status_path}")
    if not changelog_path.is_file():
        raise ValueError(f"missing release documentation: {changelog_path}")

    project_status = project_status_path.read_text(encoding="utf-8")
    changelog = changelog_path.read_text(encoding="utf-8")
    validate_project_status_version(project_status, resolved_version)
    for section in REQUIRED_STATUS_SECTIONS:
        extract_heading_section(project_status, section)

    return ReleaseDocuments(
        version=resolved_version,
        project_status=project_status,
        changelog=changelog,
        changelog_entry=extract_changelog_entry(changelog, resolved_version),
        completed=extract_heading_section(project_status, "Completed features"),
        in_progress=extract_heading_section(project_status, "In progress"),
        planned=extract_heading_section(project_status, "Planned features"),
        deferred=extract_heading_section(project_status, "Deferred"),
    )


def copy_release_documents(release_dir: Path, documents: ReleaseDocuments) -> dict[str, Any]:
    release_dir.mkdir(parents=True, exist_ok=True)
    targets = {
        "projectStatus": release_dir / "PROJECT_STATUS.md",
        "changelog": release_dir / "CHANGELOG.md",
    }
    targets["projectStatus"].write_text(documents.project_status, encoding="utf-8")
    targets["changelog"].write_text(documents.changelog, encoding="utf-8")
    return {
        key: {
            "filename": path.name,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }
        for key, path in targets.items()
    }


def release_notes_text(
    metadata: dict[str, Any],
    documents: ReleaseDocuments,
    extra_notes: str | None = None,
) -> str:
    artifact = metadata["artifact"]
    additional = ""
    if extra_notes and extra_notes.strip():
        additional = f"\n## Additional release notes\n\n{extra_notes.strip()}\n"
    return (
        f"# Firefox ChatAI Assistant {metadata['version']}\n\n"
        "## Release metadata\n\n"
        f"- Add-on ID: `{metadata['addonId']}`\n"
        f"- Built UTC: `{metadata['builtAtUtc']}`\n"
        f"- Git commit: `{metadata.get('gitCommit') or 'unknown'}`\n"
        f"- Native Host: `{metadata.get('nativeHostVersion') or 'not detected'}`\n"
        f"- Artifact: `{artifact['filename']}`\n"
        f"- SHA-256: `{artifact['sha256']}`\n"
        "- Signing state: **unsigned source archive**\n\n"
        "## What's new in this release\n\n"
        f"{documents.changelog_entry}\n\n"
        "## Current capabilities\n\n"
        f"{documents.completed}\n\n"
        "## In progress\n\n"
        f"{documents.in_progress}\n\n"
        "## Planned next\n\n"
        f"{documents.planned}\n\n"
        "## Deferred\n\n"
        f"{documents.deferred}\n"
        f"{additional}\n"
        "## Installation note\n\n"
        "This ZIP is for validation or AMO signing. Use the Mozilla-signed XPI for persistent installation in Firefox Release.\n\n"
        "The GitHub Release also includes `PROJECT_STATUS.md` and `CHANGELOG.md` as standalone assets.\n"
    )


def documentation_assets(release_dir: Path) -> list[Path]:
    return [release_dir / "PROJECT_STATUS.md", release_dir / "CHANGELOG.md"]


def git_document_warning(root: Path = PROJECT_ROOT) -> str | None:
    """Return a warning when release docs are not tracked/clean; publishing still works."""
    import subprocess

    try:
        tracked = subprocess.run(
            ["git", "ls-files", "--error-unmatch", "PROJECT_STATUS.md", "CHANGELOG.md"],
            cwd=root,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        dirty = subprocess.run(
            ["git", "status", "--porcelain=v1", "--", "PROJECT_STATUS.md", "CHANGELOG.md"],
            cwd=root,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    except OSError:
        return None
    if tracked.returncode != 0:
        return (
            "PROJECT_STATUS.md or CHANGELOG.md is not tracked by Git. The GitHub Release will contain "
            "the generated assets, but the release tag source may not contain the documents."
        )
    if dirty.stdout.strip():
        return (
            "PROJECT_STATUS.md or CHANGELOG.md has uncommitted changes. The GitHub Release assets use "
            "the working-tree content, but the release tag source uses the committed revision."
        )
    return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate PROJECT_STATUS.md and CHANGELOG.md")
    parser.add_argument("--version", help="version to validate; defaults to extension/manifest.json")
    parser.add_argument("--print-release-notes", action="store_true", help="render a metadata-light preview")
    args = parser.parse_args(argv)

    documents = load_release_documents(args.version)
    if args.print_release_notes:
        preview_metadata = {
            "version": documents.version,
            "addonId": "preview",
            "builtAtUtc": "preview",
            "gitCommit": "preview",
            "nativeHostVersion": "preview",
            "artifact": {"filename": "preview.zip", "sha256": "preview"},
        }
        sys.stdout.write(release_notes_text(preview_metadata, documents))
    else:
        print(f"PASS: release documentation matches add-on version {documents.version}")
        print(f"PROJECT_STATUS.md SHA-256: {sha256_text(documents.project_status)}")
        print(f"CHANGELOG.md SHA-256    : {sha256_text(documents.changelog)}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
