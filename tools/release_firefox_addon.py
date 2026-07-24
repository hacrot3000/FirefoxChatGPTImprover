#!/usr/bin/env python3
"""Build a traceable unsigned Firefox release archive for FirefoxChatImprover."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from typing import Any

GITHUB_REPO = "hacrot3000/FirefoxChatGPTImprover"

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_EXTENSION_DIR = PROJECT_ROOT / "extension"
DEFAULT_RELEASES_DIR = PROJECT_ROOT / "dist" / "releases"
VERSION_RE = re.compile(r"^[0-9]+(?:\.[0-9]+){1,3}(?:[A-Za-z][0-9A-Za-z._-]*)?$")


def load_manifest(extension_dir: Path = DEFAULT_EXTENSION_DIR) -> dict[str, Any]:
    path = extension_dir / "manifest.json"
    if not path.is_file():
        raise ValueError(f"extension manifest not found: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid manifest JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError("manifest root must be an object")
    return data


def validate_manifest(manifest: dict[str, Any]) -> tuple[str, str, str]:
    name = str(manifest.get("name", "")).strip()
    version = str(manifest.get("version", "")).strip()
    gecko = manifest.get("browser_specific_settings", {}).get("gecko", {})
    addon_id = str(gecko.get("id", "")).strip() if isinstance(gecko, dict) else ""

    if not name:
        raise ValueError("manifest.name is required")
    if not VERSION_RE.fullmatch(version):
        raise ValueError(f"unsupported manifest.version: {version!r}")
    if not addon_id:
        raise ValueError("browser_specific_settings.gecko.id is required")

    permissions = gecko.get("data_collection_permissions", {}) if isinstance(gecko, dict) else {}
    required = permissions.get("required", []) if isinstance(permissions, dict) else []
    if required != ["none"]:
        raise ValueError("gecko.data_collection_permissions.required must be exactly ['none']")
    return name, version, addon_id


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def command_output(command: list[str], *, cwd: Path = PROJECT_ROOT) -> str | None:
    try:
        completed = subprocess.run(
            command,
            cwd=cwd,
            check=True,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    value = completed.stdout.strip()
    return value or None


def git_commit(root: Path = PROJECT_ROOT) -> str | None:
    return command_output(["git", "rev-parse", "HEAD"], cwd=root)


def native_host_version(root: Path = PROJECT_ROOT) -> str | None:
    path = root / "native-host" / "native_host.py"
    if not path.is_file():
        return None
    match = re.search(r'^HOST_VERSION\s*=\s*["\']([^"\']+)["\']', path.read_text(encoding="utf-8"), re.MULTILINE)
    return match.group(1) if match else None


def resolve_web_ext(root: Path = PROJECT_ROOT) -> Path:
    override = os.environ.get("WEB_EXT_BIN")
    path = Path(override).expanduser() if override else root / ".firefox-dev-tools" / "node_modules" / ".bin" / "web-ext"
    if not path.is_file() or not os.access(path, os.X_OK):
        raise ValueError("web-ext is not installed; run ./tools/setup_firefox_addon_dev.sh")
    resolved = path.resolve()
    probe = subprocess.run(
        [str(resolved), "--version"],
        cwd=root,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if probe.returncode != 0:
        detail = ((probe.stdout or "") + (probe.stderr or "")).strip()
        suffix = f"\n{detail}" if detail else ""
        raise ValueError(
            "web-ext installation is incomplete or broken; run "
            "./tools/setup_firefox_addon_dev.sh, then retry." + suffix
        )
    return resolved


def run_checked(command: list[str], *, cwd: Path = PROJECT_ROOT) -> None:
    print("+", " ".join(command))
    subprocess.run(command, cwd=cwd, check=True)


def gh_release_exists(tag: str, repo: str = GITHUB_REPO) -> bool:
    """Return True if the GitHub release tag already exists."""
    result = subprocess.run(
        ["gh", "release", "view", tag, "--repo", repo],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return result.returncode == 0


def publish_github_release(
    *,
    tag: str,
    title: str,
    release_dir: Path,
    artifact: Path,
    repo: str = GITHUB_REPO,
    overwrite: bool = False,
) -> None:
    """Create (or recreate) a GitHub release and upload release assets."""
    if gh_release_exists(tag, repo):
        if not overwrite:
            raise ValueError(
                f"GitHub release {tag} already exists. Use --overwrite to replace it."
            )
        print(f"Deleting existing GitHub release {tag} ...")
        run_checked(["gh", "release", "delete", tag, "--repo", repo, "--yes"])

    assets = [
        str(artifact),
        str(release_dir / "SHA256SUMS"),
        str(release_dir / "release.json"),
    ]
    notes_file = release_dir / "RELEASE_NOTES.md"

    run_checked([
        "gh", "release", "create", tag,
        *assets,
        "--title", title,
        "--notes-file", str(notes_file),
        "--repo", repo,
    ])
    print(f"GitHub Release: https://github.com/{repo}/releases/tag/{tag}")


def release_metadata(
    *,
    manifest: dict[str, Any],
    artifact: Path,
    artifact_sha256: str,
    built_at: str,
    commit: str | None,
    host_version: str | None,
) -> dict[str, Any]:
    name, version, addon_id = validate_manifest(manifest)
    return {
        "schemaVersion": 1,
        "name": name,
        "version": version,
        "addonId": addon_id,
        "builtAtUtc": built_at,
        "gitCommit": commit,
        "artifact": {
            "filename": artifact.name,
            "sha256": artifact_sha256,
            "signed": False,
            "kind": "unsigned-source-archive",
        },
        "nativeHostVersion": host_version,
    }


def release_notes_text(metadata: dict[str, Any], notes: str | None = None) -> str:
    artifact = metadata["artifact"]
    body = notes.strip() if notes and notes.strip() else "- Phase 08 release packaging and installation/update workflow."
    return (
        f"# Firefox ChatAI Assistant {metadata['version']}\n\n"
        f"- Add-on ID: `{metadata['addonId']}`\n"
        f"- Built UTC: `{metadata['builtAtUtc']}`\n"
        f"- Git commit: `{metadata.get('gitCommit') or 'unknown'}`\n"
        f"- Native host: `{metadata.get('nativeHostVersion') or 'not detected'}`\n"
        f"- Artifact: `{artifact['filename']}`\n"
        f"- SHA-256: `{artifact['sha256']}`\n"
        "- Signing state: **unsigned source archive**\n\n"
        "## Changes\n\n"
        f"{body}\n\n"
        "## Installation note\n\n"
        "This ZIP is for validation or AMO signing. Use the Mozilla-signed XPI for persistent installation in Firefox Release.\n"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-tests", action="store_true", help="skip tools/test_firefox_addon.sh")
    parser.add_argument("--overwrite", action="store_true", help="replace an existing local release directory and GitHub release for the same version")
    parser.add_argument("--publish", action="store_true", help="create a GitHub release and upload assets after a successful build")
    parser.add_argument("--notes-file", type=Path, help="Markdown/text inserted into the Changes section")
    parser.add_argument("--releases-dir", type=Path, default=DEFAULT_RELEASES_DIR)
    args = parser.parse_args(argv)

    manifest = load_manifest()
    name, version, addon_id = validate_manifest(manifest)
    web_ext = resolve_web_ext()
    release_dir = args.releases_dir.expanduser().resolve() / version
    if release_dir.exists() and any(release_dir.iterdir()) and not args.overwrite:
        raise ValueError(f"release already exists: {release_dir}; bump version or pass --overwrite")
    release_dir.mkdir(parents=True, exist_ok=True)

    if not args.skip_tests:
        run_checked([str(PROJECT_ROOT / "tools" / "test_firefox_addon.sh")])

    run_checked([str(web_ext), "lint", "--source-dir", str(DEFAULT_EXTENSION_DIR)])
    filename = f"firefox-chat-ai-assistant-{version}-unsigned.zip"
    run_checked([
        str(web_ext),
        "build",
        "--source-dir", str(DEFAULT_EXTENSION_DIR),
        "--artifacts-dir", str(release_dir),
        "--filename", filename,
        "--overwrite-dest",
    ])

    artifact = release_dir / filename
    if not artifact.is_file():
        raise ValueError(f"web-ext did not create expected artifact: {artifact}")
    checksum = sha256_file(artifact)
    built_at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    metadata = release_metadata(
        manifest=manifest,
        artifact=artifact,
        artifact_sha256=checksum,
        built_at=built_at,
        commit=git_commit(),
        host_version=native_host_version(),
    )
    notes = args.notes_file.read_text(encoding="utf-8") if args.notes_file else None
    (release_dir / "release.json").write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (release_dir / "SHA256SUMS").write_text(f"{checksum}  {artifact.name}\n", encoding="utf-8")
    (release_dir / "RELEASE_NOTES.md").write_text(release_notes_text(metadata, notes), encoding="utf-8")

    print(f"DONE: {name} {version} ({addon_id})")
    print(f"Artifact : {artifact}")
    print(f"SHA-256 : {checksum}")
    print("State    : unsigned; sign before persistent Firefox Release installation")

    if args.publish:
        tag = f"v{version}"
        title = f"{name} {version}"
        print(f"\nPublishing GitHub Release {tag} to {GITHUB_REPO} ...")
        publish_github_release(
            tag=tag,
            title=title,
            release_dir=release_dir,
            artifact=artifact,
            overwrite=args.overwrite,
        )
        print(f"PUBLISHED: {tag}")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, subprocess.CalledProcessError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
