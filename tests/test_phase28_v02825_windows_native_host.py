#!/usr/bin/env python3
from __future__ import annotations

import base64
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


host = load("fci_native_host_windows", ROOT / "native-host" / "native_host.py")
e2e = load("fci_e2e_windows", ROOT / "tools" / "run_firefox_e2e.py")

assert host.HOST_VERSION == "0.13.0"

powershell = host.windows_shell_invocation(
    "Write-Output 'windows-host-test'", "background", shell_executable="powershell.exe"
)
assert powershell[0] == "powershell.exe"
assert "-NonInteractive" in powershell and "-EncodedCommand" in powershell
payload = base64.b64decode(powershell[-1]).decode("utf-16le")
assert "windows-host-test" in payload
assert "OutputEncoding" in payload
assert "exit $LASTEXITCODE" in payload

terminal = host.windows_shell_invocation(
    "Write-Output 'interactive'", "terminal", shell_executable="pwsh.exe"
)
assert "-NoExit" in terminal
terminal_payload = base64.b64decode(terminal[-1]).decode("utf-16le")
assert "command exited with status" in terminal_payload

with mock.patch.dict(os.environ, {"COMSPEC": r"C:\Windows\System32\cmd.exe"}, clear=False):
    terminal_launcher = host.windows_terminal_launcher(
        "Write-Output 'interactive'", shell_executable="pwsh.exe"
    )
assert terminal_launcher[:4] == [r"C:\Windows\System32\cmd.exe", "/d", "/s", "/c"]
assert 'start "" /wait ' in terminal_launcher[4]
assert "pwsh.exe" in terminal_launcher[4]
assert "-NoExit" in terminal_launcher[4]

cmd = host.windows_shell_invocation("echo cmd-host-test", "background", shell_executable="cmd.exe")
assert cmd[:5] == ["cmd.exe", "/d", "/s", "/c", "echo cmd-host-test"]

with tempfile.TemporaryDirectory(prefix="fci-win-state-") as temp:
    with mock.patch.dict(os.environ, {"LOCALAPPDATA": temp}, clear=False):
        state = host._state_base_directory("windows")
        assert state == (Path(temp) / "FirefoxChatAIAssistant" / "state").resolve()
        explicit_download = Path(temp) / "Custom Downloads"
        explicit_download.mkdir()
        with mock.patch.dict(os.environ, {"FCI_DOWNLOAD_DIR": str(explicit_download)}, clear=False):
            assert host._download_directory("windows") == explicit_download.resolve()

class DummyProcess:
    pid = 4242
    def poll(self):
        return None
    def terminate(self):
        raise AssertionError("taskkill should be used before direct terminate")
    def kill(self):
        raise AssertionError("taskkill should be used before direct kill")

calls: list[list[str]] = []
def fake_run(command, **_kwargs):
    calls.append(list(command))
    return subprocess.CompletedProcess(command, 0)

with mock.patch.object(host, "IS_WINDOWS", True), mock.patch.object(host.subprocess, "run", fake_run):
    host._terminate_process_tree(DummyProcess(), force=False)
    host._terminate_process_tree(DummyProcess(), force=True)
assert calls[0] == ["taskkill", "/PID", "4242", "/T"]
assert calls[1] == ["taskkill", "/PID", "4242", "/T", "/F"]

marker = Path(tempfile.gettempdir()) / "fci windows marker.txt"
windows_command = e2e.native_shell_test_command(marker, "windows")
assert "Set-Content" in windows_command and "Test-Path" in windows_command
assert str(marker.resolve()).replace("'", "''") in windows_command

installer = (ROOT / "native-host" / "install_native_host.ps1").read_text(encoding="utf-8")
uninstaller = (ROOT / "native-host" / "uninstall_native_host.ps1").read_text(encoding="utf-8")
integration = (ROOT / "tools" / "test_native_host_windows.ps1").read_text(encoding="utf-8")
for token in (
    "Software\\Mozilla\\NativeMessagingHosts",
    "RegistryView]::Registry64",
    "RegistryView]::Registry32",
    "native_host.cmd",
    "--self-test",
    "CurrentUser",
    "AllUsers",
):
    assert token in installer, token
assert "DeleteSubKeyTree" in uninstaller
assert "-PurgeData" in uninstaller
assert "integration_test" in integration
assert "install_native_host.ps1" in integration and "uninstall_native_host.ps1" in integration

manifest = json.loads((ROOT / "extension" / "manifest.json").read_text(encoding="utf-8"))
assert tuple(map(int, manifest["version"].split("."))) >= (0, 28, 25)
description = str(manifest.get("description", ""))
is_extension_manifest = manifest.get("manifest_version") == 3
is_phase38_multibrowser_description = (
    is_extension_manifest
    and "Chromium" in description
    and "Native Host actions" in description
)
assert "Windows Native Host" in description or is_phase38_multibrowser_description

status = (ROOT / "document" / "CURRENT_PROJECT_STATUS.md").read_text(encoding="utf-8")
assert "Native Host Windows | Complete" in status
assert "No required implementation tasks remain" in status

result = subprocess.run(
    [os.environ.get("PYTHON", "python3"), str(ROOT / "native-host" / "native_host.py"), "--self-test"],
    cwd=ROOT,
    text=True,
    capture_output=True,
    check=False,
    env={**os.environ, "FCI_NATIVE_HOST_ALLOW_ROOT_FOR_TEST": "1"},
)
assert result.returncode == 0, result.stdout + result.stderr
assert "PASS: native host protocol" in result.stdout

print("PASS: Phase 28 v0.28.25 Windows Native Host runtime, installer, registry and process-tree contracts")
