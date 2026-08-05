#!/usr/bin/env python3
from __future__ import annotations
import importlib.util
import json
from pathlib import Path
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("update_channel", ROOT / "tools" / "manage_firefox_update_channel.py")
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)
manifest = json.loads((ROOT / "extension" / "manifest.json").read_text(encoding="utf-8"))
assert manifest["version"] == "0.28.20"
assert manifest["browser_specific_settings"]["gecko"]["strict_min_version"] == "142.0"
assert "update_url" not in manifest["browser_specific_settings"]["gecko"]

with tempfile.TemporaryDirectory() as raw:
    xpi = Path(raw) / "signed.xpi"
    with zipfile.ZipFile(xpi, "w") as archive:
        archive.writestr("manifest.json", "{}")
        archive.writestr("META-INF/mozilla.rsa", "test signature fixture")
    assert module.signed_xpi(xpi)
    digest = module.sha256_file(xpi)
    updates = module.build_updates_json(manifest, "https://example.invalid/addon.xpi", digest)
    entry = module.update_entry(updates, "firefox-chat-assistant@duongtc.local")
    assert entry["version"] == "0.28.20"
    assert entry["update_hash"] == f"sha256:{digest}"
    assert entry["applications"]["gecko"]["strict_min_version"] == "142.0"
    enabled = module.set_update_url(manifest, "https://example.invalid/updates.json")
    assert enabled["browser_specific_settings"]["gecko"]["update_url"].startswith("https://")
    disabled = module.set_update_url(enabled, None)
    assert "update_url" not in disabled["browser_specific_settings"]["gecko"]

print("PASS: Phase 28 v0.28.20 Android-compatible manifest and guarded self-hosted update-channel tooling")
