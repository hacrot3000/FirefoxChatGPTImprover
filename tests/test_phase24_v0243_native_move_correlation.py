#!/usr/bin/env python3
import importlib.util
import tempfile
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("fci_native_host", ROOT / "native-host" / "native_host.py")
module = importlib.util.module_from_spec(spec); sys.modules[spec.name] = module; spec.loader.exec_module(module)
with tempfile.TemporaryDirectory() as temp:
    base = Path(temp)
    src = base / "Downloads" / "FirefoxChatImprover" / "capture" / "sample.bin"
    dst = base / "dest"
    src.parent.mkdir(parents=True); src.write_bytes(b"abc")
    old = module._xdg_download_directory
    old_root = module._require_non_root
    module._xdg_download_directory = lambda: (base / "Downloads").resolve()
    module._require_non_root = lambda: None
    try:
        result = module.move_download({"requestId":"move-req","moveId":"move-req","tabId":7,"sourcePath":str(src),"destinationDirectory":str(dst),"conflictAction":"uniquify"})
    finally:
        module._xdg_download_directory = old
        module._require_non_root = old_root
    assert result["event"] == "download_moved"
    assert result["requestId"] == "move-req"
    assert result["moveId"] == "move-req"
    assert Path(result["destinationPath"]).read_bytes() == b"abc"
print("PASS: Phase 24 v0.24.3 Native Host echoes move correlation IDs")
