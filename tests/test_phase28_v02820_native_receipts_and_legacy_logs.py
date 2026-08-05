#!/usr/bin/env python3
from __future__ import annotations
import importlib.util
import os
from pathlib import Path
import tempfile
import sys

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("native_host_v02820", ROOT / "native-host" / "native_host.py")
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
sys.modules[spec.name] = module
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory() as raw:
    base = Path(raw)
    home = base / "home"
    downloads = home / "Downloads"
    state = base / "state"
    destination = base / "destination"
    downloads.mkdir(parents=True)
    destination.mkdir()
    os.environ["HOME"] = str(home)
    os.environ["XDG_DOWNLOAD_DIR"] = str(downloads)
    os.environ["XDG_STATE_HOME"] = str(state)
    os.environ["FCI_NATIVE_HOST_ALLOW_ROOT_FOR_TEST"] = "1"

    source = downloads / "artifact.zip"
    source.write_bytes(b"payload")
    request = {
        "requestId": "request-one",
        "moveId": "move-idempotent-v02820",
        "tabId": 9,
        "sourcePath": str(source),
        "destinationDirectory": str(destination),
        "conflictAction": "uniquify",
    }
    first = module.move_download(request)
    target = Path(first["destinationPath"])
    assert target.read_bytes() == b"payload"
    assert not source.exists()
    replay = module.move_download({**request, "requestId": "request-two"})
    assert replay["destinationPath"] == str(target)
    assert replay["recovered"] is True
    receipts = list((state / "firefox-chat-ai-assistant" / "moves").glob("*.json"))
    assert len(receipts) == 1

    run_id = "legacy-run-without-persisted-log-id"
    log_id = module._log_id_for_run(run_id)
    module._log_path(log_id).write_text("legacy output\n", encoding="utf-8")
    resolved = module.resolve_log_for_run({"requestId": "resolve", "runId": run_id})
    assert resolved["exists"] is True
    assert resolved["logId"] == log_id
    assert resolved["logBytes"] > 0
    chunk = module.read_log_chunk({"logId": log_id, "maxBytes": 1024})
    assert chunk["dataBase64"]

print("PASS: Phase 28 v0.28.20 Native Host idempotent move receipts and legacy log resolution")
