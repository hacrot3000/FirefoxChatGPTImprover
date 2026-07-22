#!/usr/bin/env python3
from __future__ import annotations
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ROOT / "extension"
manifest = json.loads((EXTENSION / "manifest.json").read_text(encoding="utf-8"))
version_parts = tuple(int(part) for part in manifest["version"].split("."))
assert len(version_parts) == 3 and version_parts >= (0, 7, 0)
required = {"activeTab", "scripting", "storage", "tabs", "sessions", "notifications", "nativeMessaging"}
assert set(manifest.get("permissions", [])) == required
assert manifest.get("optional_host_permissions") == ["*://*/*"]
assert manifest.get("content_security_policy", {}).get("extension_pages") == "script-src 'self'; object-src 'none';"
assert "webRequest" not in manifest.get("permissions", [])
assert "debugger" not in manifest.get("permissions", [])

for path in EXTENSION.rglob("*"):
    if not path.is_file() or path.suffix not in {".js", ".html"}:
        continue
    text = path.read_text(encoding="utf-8")
    assert not re.search(r"\beval\s*\(", text), f"eval forbidden: {path}"
    assert "new Function" not in text, f"new Function forbidden: {path}"
    assert "javascript:" not in text.lower(), f"javascript URL forbidden: {path}"
    if path.suffix == ".html":
        assert not re.search(r"<script[^>]+src=[\"']https?://", text, re.I), f"remote script forbidden: {path}"

host_manifest = json.loads((ROOT / "native-host/manifest-template.json").read_text(encoding="utf-8"))
assert host_manifest["allowed_extensions"] == ["firefox-chat-assistant@duongtc.local"]
host_source = (ROOT / "native-host/native_host.py").read_text(encoding="utf-8")
assert "shell=True" not in host_source
assert "sudo" not in host_source
print("PASS: Phase 07 CSP, permissions, local scripts and native host security scan")
