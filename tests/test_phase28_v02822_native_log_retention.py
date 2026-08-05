#!/usr/bin/env python3
from __future__ import annotations
import importlib.util
import os
from pathlib import Path
import tempfile
import time
import sys

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("fci_native_host", ROOT / "native-host" / "native_host.py")
assert spec and spec.loader
native_host = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = native_host
spec.loader.exec_module(native_host)

with tempfile.TemporaryDirectory() as tmp:
    old_state = os.environ.get("XDG_STATE_HOME")
    os.environ["XDG_STATE_HOME"] = tmp
    try:
        now = time.time()
        ids = []
        for index, age_days in enumerate([180, 120, 60, 45, 30, 20, 15, 10, 8, 6, 4, 3, 2, 1]):
            run_id = f"retention-run-{index}"
            log_id = native_host._log_id_for_run(run_id)
            ids.append(log_id)
            path = native_host._log_path(log_id)
            path.write_bytes((f"log-{index}\n" * (30 + index)).encode())
            stamp = now - age_days * 86400
            os.utime(path, (stamp, stamp))

        protected = ids[0]
        dry = native_host.cleanup_log_store({
            "requestId": "dry",
            "maxAgeDays": 90,
            "maxFiles": 10,
            "maxTotalBytes": 16 * 1024 * 1024,
            "protectedLogIds": [protected],
            "dryRun": True,
        })
        assert dry["dryRun"] is True
        assert protected not in dry["deletedLogIds"]
        assert all(native_host._log_path(log_id).exists() for log_id in ids)

        result = native_host.cleanup_log_store({
            "requestId": "real",
            "maxAgeDays": 90,
            "maxFiles": 10,
            "maxTotalBytes": 16 * 1024 * 1024,
            "protectedLogIds": [protected],
        })
        assert result["event"] == "logs_cleaned"
        assert protected not in result["deletedLogIds"]
        assert native_host._log_path(protected).exists()
        assert ids[1] in result["deletedLogIds"], result
        assert result["after"]["fileCount"] <= 10
        assert result["limitsSatisfied"] is True
        assert result["deletedBytes"] > 0

        stats = native_host.log_store_stats()
        assert stats["fileCount"] == result["after"]["fileCount"]
        assert native_host.HOST_VERSION == "0.12.0"
    finally:
        if old_state is None:
            os.environ.pop("XDG_STATE_HOME", None)
        else:
            os.environ["XDG_STATE_HOME"] = old_state

print("PASS: Phase 28 v0.28.22 Native Host log retention protects unread/active IDs and enforces age, file-count and byte quotas.")
