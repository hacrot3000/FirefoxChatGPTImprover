#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


release = load("release_firefox_addon", ROOT / "tools" / "release_firefox_addon.py")
bump = load("bump_firefox_addon_version", ROOT / "tools" / "bump_firefox_addon_version.py")
updates = load("generate_firefox_update_manifest", ROOT / "tools" / "generate_firefox_update_manifest.py")

manifest = json.loads((ROOT / "extension" / "manifest.json").read_text(encoding="utf-8"))
name, version, addon_id = release.validate_manifest(manifest)
assert name == "Firefox ChatAI Assistant"
version_tuple = tuple(int(part) for part in version.split("."))
assert version_tuple >= (0, 8, 0)
assert addon_id == "firefox-chat-assistant@duongtc.local"
assert manifest["browser_specific_settings"]["gecko"]["data_collection_permissions"]["required"] == ["none"]
assert "update_url" not in manifest["browser_specific_settings"]["gecko"], "update_url must not be enabled before HTTPS hosting is ready"

assert bump.next_version("0.8.0", "patch") == "0.8.1"
assert bump.next_version("0.8.9", "minor") == "0.9.0"
assert bump.next_version("0.8.9", "major") == "1.0.0"
assert bump.next_version("0.8.0", "0.9.3") == "0.9.3"
try:
    bump.next_version("0.8.0", "0.7.9")
except ValueError:
    pass
else:
    raise AssertionError("version downgrade must fail")

with tempfile.TemporaryDirectory() as tmp:
    artifact = Path(tmp) / "addon.xpi"
    artifact.write_bytes(b"signed-xpi-fixture")
    checksum = release.sha256_file(artifact)
    update_manifest = updates.build_update_manifest(
        addon_id=addon_id,
        version=version,
        xpi_url=f"https://updates.example.invalid/firefox-chat-ai-assistant-{version}.xpi",
        sha256=checksum,
        strict_min_version="140.0",
    )
    entry = update_manifest["addons"][addon_id]["updates"][0]
    assert entry["version"] == version
    assert entry["update_hash"] == f"sha256:{checksum}"
    assert entry["applications"]["gecko"]["strict_min_version"] == "140.0"

metadata = release.release_metadata(
    manifest=manifest,
    artifact=Path("artifact.zip"),
    artifact_sha256="a" * 64,
    built_at="2026-07-22T00:00:00+00:00",
    commit="deadbeef",
    host_version="0.7.0",
)
assert metadata["artifact"]["signed"] is False
assert metadata["addonId"] == addon_id
assert "unsigned source archive" in release.release_notes_text(metadata)

sign_script = (ROOT / "tools" / "sign_firefox_addon_unlisted.sh").read_text(encoding="utf-8")
assert "--channel unlisted" in sign_script
assert "WEB_EXT_API_KEY" in sign_script and "WEB_EXT_API_SECRET" in sign_script
assert "api-secret" not in sign_script.lower(), "secret must not be passed as a command-line argument"

build_script = (ROOT / "tools" / "build_firefox_addon.sh").read_text(encoding="utf-8")
assert "release_firefox_addon.py" in build_script
print("PASS: Phase 08 release, version, signing and update-manifest contracts")
