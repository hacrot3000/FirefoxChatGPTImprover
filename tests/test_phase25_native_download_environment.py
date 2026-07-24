#!/usr/bin/env python3
from __future__ import annotations
import os
from pathlib import Path
import queue
import tempfile
import time
import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "native-host"))
import native_host

os.environ["FCI_NATIVE_HOST_ALLOW_ROOT_FOR_TEST"] = "1"
with tempfile.TemporaryDirectory() as tmp:
    os.environ["XDG_STATE_HOME"] = tmp
    events: queue.Queue[dict] = queue.Queue()
    manager = native_host.ProcessManager(events.put)
    manager.start({
        "runId": "phase25-env",
        "tabId": 25,
        "cwd": tmp,
        "command": 'printf "PATH=%s\\n" "$FCI_DOWNLOAD_PATH"; printf "ERR=%s\\n" "$FCI_DOWNLOAD_FILENAME" >&2',
        "mode": "background",
        "environment": {
            "FCI_DOWNLOAD_PATH": "/tmp/result.zip",
            "FCI_DOWNLOAD_FILENAME": "result.zip",
        },
    })
    exited = None
    deadline = time.time() + 10
    while time.time() < deadline:
        event = events.get(timeout=2)
        if event.get("event") == "exited":
            exited = event
            break
    assert exited and exited.get("returnCode") == 0, exited
    log = native_host._log_path(exited["logId"]).read_text(encoding="utf-8")
    assert "PATH=/tmp/result.zip" in log
    assert "ERR=result.zip" in log
    assert "environment=FCI_DOWNLOAD_FILENAME,FCI_DOWNLOAD_PATH" in log
    try:
        native_host.validate_run_environment({"PATH": "/evil"})
    except ValueError:
        pass
    else:
        raise AssertionError("Non-FCI environment variable was accepted")
print("PASS: Phase 25 Native Host validates FCI-only environment variables and preserves complete stdout/stderr in the file-backed log")
