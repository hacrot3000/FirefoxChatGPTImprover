#!/usr/bin/env python3
from __future__ import annotations
import importlib.util
import os
from pathlib import Path
import tempfile
import sys

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("fci_native_host", ROOT / "native-host/native_host.py")
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
sys.modules[spec.name] = module
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory() as raw:
    base = Path(raw)
    downloads = base / "Downloads"
    destination = base / "Result"
    staged = downloads / "FirefoxChatImprover" / "capture"
    staged.mkdir(parents=True)
    source = staged / "answer.zip"
    source.write_bytes(b"payload")
    os.environ["XDG_DOWNLOAD_DIR"] = str(downloads)
    os.environ["FCI_NATIVE_HOST_ALLOW_ROOT_FOR_TEST"] = "1"
    result = module.move_download({
        "moveId": "move-test", "tabId": 7, "sourcePath": str(source),
        "destinationDirectory": str(destination), "conflictAction": "uniquify"
    })
    target = Path(result["destinationPath"])
    assert target == destination / "answer.zip"
    assert target.read_bytes() == b"payload"
    assert not source.exists()
    outside = base / "outside.bin"
    outside.write_bytes(b"x")
    try:
        module.validate_move_download_request({
            "moveId": "bad", "tabId": 7, "sourcePath": str(outside),
            "destinationDirectory": str(destination), "conflictAction": "uniquify"
        })
    except ValueError as exc:
        assert "outside" in str(exc)
    else:
        raise AssertionError("outside-download source must be rejected")

watcher = ROOT / "native-host/download_relocator_watch.py"
assert watcher.exists() and os.access(watcher, os.X_OK)
print("PASS: Phase 21 Native Host download relocation boundary and standalone watcher")
