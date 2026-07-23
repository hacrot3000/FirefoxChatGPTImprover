#!/usr/bin/env python3
from __future__ import annotations
import importlib.util
import os
from pathlib import Path
import queue
import tempfile
import time
import sys

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("fci_native_host_phase22", ROOT / "native-host/native_host.py")
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
sys.modules[spec.name] = module
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory() as tmp:
    os.environ["HOME"] = tmp
    os.environ["XDG_STATE_HOME"] = str(Path(tmp) / "state")
    os.environ["FCI_NATIVE_HOST_ALLOW_ROOT_FOR_TEST"] = "1"
    events: queue.Queue[dict] = queue.Queue()
    manager = module.ProcessManager(events.put)
    manager.start({
        "action": "run",
        "runId": "phase22-large-log",
        "tabId": 22,
        "cwd": str(ROOT),
        "command": "python3 -c \"import sys; sys.stdout.write('BEGIN\\n' + 'A'*350000 + '\\nEND\\n'); sys.stderr.write('ERR-END\\n')\"",
        "mode": "background",
    })
    received = []
    deadline = time.time() + 15
    while time.time() < deadline:
        event = events.get(timeout=1)
        received.append(event)
        if event.get("event") == "exited":
            break
    exited = next(item for item in received if item.get("event") == "exited")
    log_id = exited["logId"]
    assert exited["logBytes"] > 350000
    offset = 0
    parts = []
    while True:
        chunk = module.read_log_chunk({"logId": log_id, "offset": offset, "maxBytes": 32768, "requestId": "test"})
        parts.append(__import__("base64").b64decode(chunk["dataBase64"]))
        if chunk["eof"]:
            break
        assert chunk["nextOffset"] > offset
        offset = chunk["nextOffset"]
    content = b"".join(parts).decode("utf-8")
    assert "BEGIN" in content and "END" in content and "ERR-END" in content
    assert content.count("A") >= 350000
    deleted = module.delete_log_file({"logId": log_id, "requestId": "delete"})
    assert deleted["event"] == "log_deleted"
    try:
        module.read_log_chunk({"logId": log_id})
    except ValueError as exc:
        assert "does not exist" in str(exc)
    else:
        raise AssertionError("deleted log should not be readable")
print("PASS: Phase 22 Native Host preserves and pages complete shell logs beyond the sidebar buffer")
