#!/usr/bin/env python3
from __future__ import annotations

from io import BytesIO, StringIO
import importlib.util
import os
from pathlib import Path
import queue
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
HOST_PATH = ROOT / "native-host" / "native_host.py"
spec = importlib.util.spec_from_file_location("fci_native_host_phase07", HOST_PATH)
assert spec and spec.loader
host = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = host
spec.loader.exec_module(host)
os.environ["FCI_NATIVE_HOST_ALLOW_ROOT_FOR_TEST"] = "1"

# Một dòng output lớn phải được chia nhỏ dưới giới hạn native message.
events: list[dict] = []
manager = host.ProcessManager(events.append)
context = host.RunContext("chunk-test", 7, str(ROOT), "", "background")
large_line = "x" * (host.MAX_OUTPUT_CHUNK_CHARS * 2 + 17) + "\n"
manager._read_stream(context, "stdout", StringIO(large_line))
chunks = [item["text"] for item in events if item.get("event") == "output"]
assert len(chunks) == 3
assert all(len(chunk) <= host.MAX_OUTPUT_CHUNK_CHARS for chunk in chunks)
assert "".join(chunks) == large_line

# Unknown action phải trả error có cấu trúc thay vì làm host crash.
class Collector:
    def __init__(self) -> None:
        self.messages: list[dict] = []
    def send(self, message: dict) -> None:
        self.messages.append(message)

collector = Collector()
reader = BytesIO(host.encode_message({"action": "not-supported", "tabId": 1}))
assert host.run_host(reader, collector) == 0
assert collector.messages[0]["event"] == "hello"
assert collector.messages[1]["event"] == "error"
assert "không được hỗ trợ" in collector.messages[1]["error"]

# Stop phải bị giới hạn đúng runId + tabId.
stream_events: queue.Queue[dict] = queue.Queue()
manager = host.ProcessManager(stream_events.put)
run_id = "phase07-scoped-stop"
manager.start({
    "action": "run", "runId": run_id, "tabId": 42,
    "cwd": str(ROOT), "command": "printf 'ready\\n'; sleep 30", "mode": "background"
})
ready = False
deadline = time.time() + 5
while time.time() < deadline and not ready:
    event = stream_events.get(timeout=1)
    ready |= event.get("event") == "output" and "ready" in event.get("text", "")
assert ready
try:
    manager.stop(run_id, 99)
except ValueError as error:
    assert "tabId không khớp" in str(error)
else:
    raise AssertionError("stop with wrong tabId must fail")
manager.stop(run_id, 42)
deadline = time.time() + 8
while time.time() < deadline:
    event = stream_events.get(timeout=1)
    if event.get("event") == "exited":
        assert event.get("stopped") is True
        break
else:
    raise AssertionError("scoped stop did not exit")

print("PASS: Phase 07 native output chunking, unknown action and scoped stop")
