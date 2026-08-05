#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


e2e = load("fci_e2e", ROOT / "tools" / "run_firefox_e2e.py")
matrix = load("fci_matrix", ROOT / "tools" / "run_firefox_version_matrix.py")

assert e2e.parse_version("Mozilla Firefox 144.0.2") == (144, 0, 2)
assert matrix.parse_version("Firefox ESR 140.3.1esr") == (140, 3, 1)

background_path = ROOT / "extension" / "background" / "background.js"
production_background = background_path.read_text(encoding="utf-8")
assert "__FCI_E2E_HOOKS" not in production_background, "Production background must not contain test-only hooks."
injected = e2e.inject_test_hooks(production_background)
assert "__FCI_E2E_HOOKS" in injected
assert "activateTab" in injected and "runShellForTab" in injected

with tempfile.TemporaryDirectory(prefix="fci-e2e-contract-") as temp:
    temp_root = Path(temp)
    script = e2e.driver_script("http://127.0.0.1:34567", temp_root, False)
    script_path = temp_root / "driver.js"
    script_path.write_text(script, encoding="utf-8")
    subprocess.run(["node", "--check", str(script_path)], check=True, capture_output=True, text=True)

    extension = e2e.prepare_extension(temp_root, "http://127.0.0.1:34567", False)
    manifest = json.loads((extension / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["background"]["scripts"][-1] == "e2e/background_driver.js"
    assert manifest["content_scripts"][0]["matches"] == ["http://127.0.0.1:34567/*"]
    assert "http://127.0.0.1:34567/*" in manifest["host_permissions"]
    assert (extension / "e2e" / "background_driver.js").is_file()
    assert "__FCI_E2E_HOOKS" in (extension / "background" / "background.js").read_text(encoding="utf-8")

example = matrix.load_config(ROOT / "tools" / "firefox_version_matrix.example.json")
assert len(example) == 2
assert example[0]["name"] == "stable" and example[0]["requireNative"] is True
assert example[1]["required"] is False

report = {
    "ok": True,
    "addonVersion": "0.28.24",
    "strictMinVersion": "142.0",
    "entries": [
        {
            "name": "stable",
            "binary": "/usr/bin/firefox",
            "versionText": "Mozilla Firefox 144.0",
            "probeStatus": "pass",
            "e2eStatus": "pass",
            "nativeStatus": "pass",
        }
    ],
}
markdown = matrix.markdown_report(report)
assert "Firefox compatibility matrix" in markdown
assert "Mozilla Firefox 144.0" in markdown
assert "Overall: **PASS**" in markdown

for command in (
    ["python3", "tools/run_firefox_e2e.py", "--help"],
    ["python3", "tools/run_firefox_version_matrix.py", "--help"],
):
    result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, check=False)
    assert result.returncode == 0, result.stderr

print("PASS: Phase 28 v0.28.24 real-Firefox E2E and version-matrix tooling contracts")
