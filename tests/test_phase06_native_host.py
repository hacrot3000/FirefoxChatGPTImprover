#!/usr/bin/env python3
from __future__ import annotations

from io import BytesIO
import importlib.util
import os
from pathlib import Path
import queue
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
HOST_PATH = ROOT / "native-host" / "native_host.py"
spec = importlib.util.spec_from_file_location("fci_native_host", HOST_PATH)
assert spec and spec.loader
host = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = host
spec.loader.exec_module(host)
os.environ["FCI_NATIVE_HOST_ALLOW_ROOT_FOR_TEST"] = "1"

message = {"action": "ping", "text": "xin chào"}
encoded = host.encode_message(message)
assert host.read_message(BytesIO(encoded)) == message

try:
    host.validate_run_request({
        "runId": "invalid",
        "tabId": 1,
        "cwd": "relative/path",
        "command": "true",
        "mode": "background",
    })
except ValueError as error:
    assert "absolute path" in str(error)
else:
    raise AssertionError("relative cwd must be rejected")

events: queue.Queue[dict] = queue.Queue()
manager = host.ProcessManager(events.put)
run_id = "phase06-stop-test"
manager.start({
    "action": "run",
    "runId": run_id,
    "tabId": 42,
    "cwd": str(ROOT),
    "command": "printf 'ready\\n'; sleep 30",
    "mode": "background",
})
started = False
ready = False
deadline = time.time() + 5
while time.time() < deadline and not ready:
    event = events.get(timeout=1)
    started |= event.get("event") == "started"
    ready |= event.get("event") == "output" and "ready" in event.get("text", "")
assert started and ready
manager.stop(run_id)
exited = None
deadline = time.time() + 8
while time.time() < deadline:
    event = events.get(timeout=1)
    if event.get("event") == "exited":
        exited = event
        break
assert exited is not None
assert exited.get("stopped") is True
assert run_id not in manager.runs
print("PASS: Phase 06 native protocol, validation, streaming and scoped stop")
