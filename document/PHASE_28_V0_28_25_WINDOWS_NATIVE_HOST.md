# Phase 28 v0.28.25 — Windows Native Host

## Scope

This phase completes the final required item from the v0.28.19 feature audit: Native Messaging support for Firefox Desktop on Windows.

## Runtime

- Native Host 0.13.0 uses PowerShell (`pwsh.exe` or `powershell.exe`) with UTF-8 output and falls back to `cmd.exe`.
- Background commands run in a separate Windows process group without a console window.
- Terminal mode opens a new console and remains interactive after the command exits.
- Stop and shutdown target the complete process tree through `taskkill /T`, escalating to `/F` after the grace timeout.
- Downloads are validated against the Windows Downloads known-folder path.
- Logs and idempotent relocation receipts are stored below `%LOCALAPPDATA%\FirefoxChatAIAssistant\state`.

## Installation

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\native-host\install_native_host.ps1
```

The installer creates an absolute Python launcher and registers the manifest in the 32-bit and 64-bit registry views under:

```text
HKCU\Software\Mozilla\NativeMessagingHosts\com.duongtc.firefox_chat_assistant
```

Use `-Scope AllUsers` from an elevated PowerShell session for HKLM installation.

## Validation

```powershell
.\tools\test_native_host_windows.ps1
python .\tools\run_firefox_e2e.py --require-native
```

The cross-platform regression suite also verifies PowerShell command encoding, cmd fallback, state/download paths, dual-view installer contracts and process-tree stop construction.
