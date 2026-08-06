#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
EXPECTED_ID = "aganahagmocgjhcglbjdeidlpecdhgfj"
SOURCE_VERSION = json.loads((ROOT / "extension/manifest.json").read_text(encoding="utf-8"))["version"]

with tempfile.TemporaryDirectory() as temp_dir:
    releases = Path(temp_dir) / "releases"
    subprocess.run([
        "python3", str(ROOT / "tools/build_chromium_addon.py"),
        "--browser", "edge",
        "--releases-dir", str(releases),
        "--overwrite", "--skip-tests",
    ], cwd=ROOT, check=True)
    release = releases / "edge" / SOURCE_VERSION
    unpacked = release / "unpacked"
    artifact = release / f"chatai-assistant-edge-{SOURCE_VERSION}.zip"
    assert artifact.is_file()
    manifest = json.loads((unpacked / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["manifest_version"] == 3
    assert manifest["version"] == SOURCE_VERSION
    assert manifest["minimum_chrome_version"] == "116"
    assert manifest["background"] == {"service_worker": "background/chromium_service_worker.js"}
    assert manifest["side_panel"] == {"default_path": "sidebar/sidebar.html"}
    assert "browser_specific_settings" not in manifest
    assert "sidebar_action" not in manifest
    assert "sidePanel" in manifest["permissions"]
    assert "webRequestBlocking" not in manifest["permissions"]
    assert "_execute_sidebar_action" not in manifest["commands"]
    assert "fci-open-side-panel" in manifest["commands"]
    assert manifest["commands"]["fci-open-side-panel"]["suggested_key"]["default"] == "Ctrl+Shift+Y"
    assert (release / "release.json").is_file()
    release_data = json.loads((release / "release.json").read_text(encoding="utf-8"))
    assert release_data["extensionId"] == EXPECTED_ID
    assert release_data["nativeHost"]["allowedOrigin"] == f"chrome-extension://{EXPECTED_ID}/"
    assert (release / "SHA256SUMS").read_text(encoding="utf-8").strip().endswith(artifact.name)
    for size in (16, 32, 48, 128):
        assert (unpacked / f"icons/chromium-icon-{size}.png").read_bytes().startswith(b"\x89PNG\r\n\x1a\n")
    assert not (unpacked / "chromium").exists()
    with zipfile.ZipFile(artifact) as archive:
        names = set(archive.namelist())
        assert "manifest.json" in names
        assert "background/chromium_service_worker.js" in names
        assert "shared/browser_compat.js" in names
        assert "chromium/manifest_key.txt" not in names
        zipped_manifest = json.loads(archive.read("manifest.json"))
        assert zipped_manifest["side_panel"]["default_path"] == "sidebar/sidebar.html"

printed_id = subprocess.check_output([
    "python3", str(ROOT / "tools/build_chromium_addon.py"), "--print-extension-id"
], cwd=ROOT, text=True).strip()
assert printed_id == EXPECTED_ID

native_template = json.loads((ROOT / "native-host/chromium-manifest-template.json").read_text(encoding="utf-8"))
assert native_template["allowed_origins"] == ["chrome-extension://__EXTENSION_ID__/"]
installer = (ROOT / "native-host/install_chromium_native_host.sh").read_text(encoding="utf-8")
for marker in (
    ".config/google-chrome/NativeMessagingHosts",
    ".config/chromium/NativeMessagingHosts",
    ".config/microsoft-edge/NativeMessagingHosts",
    "allowed_origins",
    "--extension-id",
):
    assert marker in installer, marker

print("PASS: Phase 38 deterministic Chrome/Edge package and separate Native Host registration")
