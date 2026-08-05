#!/usr/bin/env python3
"""Native Messaging host for Firefox ChatAI Assistant.

Protocol: JSON messages prefixed by an unsigned 32-bit native-endian length.
The host accepts only explicit actions from the extension background page.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import queue
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass, field
from typing import Any, BinaryIO, Callable

HOST_NAME = "com.duongtc.firefox_chat_assistant"
HOST_VERSION = "0.13.0"
MAX_MESSAGE_BYTES = 1024 * 1024
MAX_COMMAND_CHARS = 32768
MAX_ENVIRONMENT_ITEMS = 32
MAX_ENVIRONMENT_VALUE_CHARS = 8192
MAX_OUTPUT_CHUNK_CHARS = 65536
MAX_LOG_READ_BYTES = 256 * 1024
MAX_LOG_RETENTION_FILES = 10000
MAX_LOG_RETENTION_BYTES = 16 * 1024 * 1024 * 1024
MAX_LOG_RETENTION_DAYS = 3650
MOVE_RECEIPT_SCHEMA = 1
STOP_GRACE_SECONDS = 3.0
IS_WINDOWS = os.name == "nt"


class ProtocolError(RuntimeError):
    pass


def read_message(stream: BinaryIO = sys.stdin.buffer) -> dict[str, Any] | None:
    raw_length = stream.read(4)
    if not raw_length:
        return None
    if len(raw_length) != 4:
        raise ProtocolError("incomplete native message length")
    length = struct.unpack("=I", raw_length)[0]
    if length <= 0 or length > MAX_MESSAGE_BYTES:
        raise ProtocolError(f"invalid native message size: {length}")
    payload = stream.read(length)
    if len(payload) != length:
        raise ProtocolError("incomplete native message payload")
    value = json.loads(payload.decode("utf-8"))
    if not isinstance(value, dict):
        raise ProtocolError("native message must be a JSON object")
    return value


def encode_message(message: dict[str, Any]) -> bytes:
    payload = json.dumps(message, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(payload) > MAX_MESSAGE_BYTES:
        raise ProtocolError("native response exceeds maximum message size")
    return struct.pack("=I", len(payload)) + payload


class MessageWriter:
    def __init__(self, stream: BinaryIO = sys.stdout.buffer) -> None:
        self.stream = stream
        self.lock = threading.Lock()

    def send(self, message: dict[str, Any]) -> None:
        data = encode_message(message)
        with self.lock:
            self.stream.write(data)
            self.stream.flush()


def _require_non_root() -> None:
    if hasattr(os, "geteuid") and os.geteuid() == 0 and os.environ.get("FCI_NATIVE_HOST_ALLOW_ROOT_FOR_TEST") != "1":
        raise ValueError("The Native Host refuses to run commands as root.")


def _expanded_path(value: Any) -> Path:
    return Path(os.path.expandvars(str(value or ""))).expanduser()


def _platform_name(value: str | None = None) -> str:
    if value:
        return value.lower()
    return "windows" if IS_WINDOWS else "posix"


def _state_base_directory(platform_name: str | None = None) -> Path:
    if _platform_name(platform_name) == "windows":
        root = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
        base = _expanded_path(root) if root else Path.home() / "AppData" / "Local"
        directory = base / "FirefoxChatAIAssistant" / "state"
    else:
        root = Path(os.environ.get("XDG_STATE_HOME") or (Path.home() / ".local" / "state"))
        directory = root / "firefox-chat-ai-assistant"
    directory.mkdir(parents=True, exist_ok=True)
    return directory.resolve()


def _windows_known_download_directory() -> Path | None:
    if not IS_WINDOWS:
        return None
    try:
        import winreg  # type: ignore

        key_path = r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders"
        value_name = "{374DE290-123F-4565-9164-39C4925E467B}"
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path) as key:
            raw, _kind = winreg.QueryValueEx(key, value_name)
        candidate = _expanded_path(raw)
        if candidate.is_absolute():
            return candidate.resolve()
    except (OSError, ImportError, ValueError):
        pass
    return None


def _windows_shell_executable() -> tuple[str, str]:
    for name in ("pwsh.exe", "powershell.exe", "pwsh", "powershell"):
        resolved = shutil.which(name)
        if resolved:
            return resolved, "powershell"
    command_processor = os.environ.get("COMSPEC") or shutil.which("cmd.exe") or "cmd.exe"
    return command_processor, "cmd"


def _powershell_encoded_command(command: str, *, terminal: bool) -> str:
    prefix = (
        "$OutputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);"
        "$ErrorActionPreference='Continue';"
    )
    if terminal:
        suffix = (
            ";$fciCode=if($null-ne $LASTEXITCODE){$LASTEXITCODE}elseif($?){0}else{1};"
            "Write-Host '';Write-Host ('[Firefox ChatAI Assistant] command exited with status '+$fciCode)"
        )
    else:
        suffix = ";if($null-ne $LASTEXITCODE){exit $LASTEXITCODE}elseif($?){exit 0}else{exit 1}"
    payload = prefix + "& {" + command + "}" + suffix
    return base64.b64encode(payload.encode("utf-16le")).decode("ascii")


def windows_shell_invocation(command: str, mode: str, shell_executable: str | None = None) -> list[str]:
    if mode not in {"background", "terminal"}:
        raise ValueError("The command mode is invalid.")
    if shell_executable:
        executable = shell_executable
        shell_kind = "powershell" if "powershell" in Path(shell_executable).name.lower() or "pwsh" in Path(shell_executable).name.lower() else "cmd"
    else:
        executable, shell_kind = _windows_shell_executable()
    if shell_kind == "powershell":
        arguments = [executable, "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass"]
        if mode == "background":
            arguments.append("-NonInteractive")
        else:
            arguments.append("-NoExit")
        arguments.extend(["-EncodedCommand", _powershell_encoded_command(command, terminal=mode == "terminal")])
        return arguments
    return [executable, "/d", "/s", "/c" if mode == "background" else "/k", command]


def windows_terminal_launcher(command: str, shell_executable: str | None = None) -> list[str]:
    child = windows_shell_invocation(command, "terminal", shell_executable=shell_executable)
    command_processor = os.environ.get("COMSPEC") or shutil.which("cmd.exe") or "cmd.exe"
    command_line = 'start "" /wait ' + subprocess.list2cmdline(child)
    return [command_processor, "/d", "/s", "/c", command_line]


def _process_session_kwargs(*, terminal: bool) -> dict[str, Any]:
    if not IS_WINDOWS:
        return {"start_new_session": True}
    flags = int(getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))
    flags |= int(getattr(subprocess, "CREATE_NEW_CONSOLE" if terminal else "CREATE_NO_WINDOW", 0))
    return {"creationflags": flags}


def _terminate_process_tree(process: subprocess.Popen[str], *, force: bool) -> None:
    if process.poll() is not None:
        return
    if IS_WINDOWS:
        command = ["taskkill", "/PID", str(process.pid), "/T"]
        if force:
            command.append("/F")
        flags = int(getattr(subprocess, "CREATE_NO_WINDOW", 0))
        result = subprocess.run(
            command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            check=False, creationflags=flags
        )
        if result.returncode != 0 and process.poll() is None:
            if force:
                process.kill()
            else:
                process.terminate()
        return
    os.killpg(process.pid, signal.SIGKILL if force else signal.SIGTERM)


def _runtime_shell_name() -> str:
    if IS_WINDOWS:
        executable, kind = _windows_shell_executable()
        return f"{kind}:{Path(executable).name}"
    return "/bin/bash"


def validate_run_request(message: dict[str, Any]) -> tuple[str, int, Path, str, str]:
    run_id = str(message.get("runId") or "").strip()
    if not run_id or len(run_id) > 160:
        raise ValueError("The run ID is invalid.")
    tab_id = message.get("tabId")
    if not isinstance(tab_id, int) or tab_id < 0:
        raise ValueError("The tab ID is invalid.")
    raw_cwd = str(message.get("cwd") or "").strip()
    cwd = _expanded_path(raw_cwd)
    if not cwd.is_absolute():
        raise ValueError("The working directory must be an absolute path.")
    if not cwd.exists():
        raise ValueError("The working directory does not exist.")
    if not cwd.is_dir():
        raise ValueError("The working directory is not a directory.")
    command = str(message.get("command") or "")
    if not command.strip():
        raise ValueError("The command is empty.")
    if len(command) > MAX_COMMAND_CHARS:
        raise ValueError("The command exceeds the allowed length.")
    if "\x00" in command:
        raise ValueError("The command contains an invalid NUL character.")
    mode = str(message.get("mode") or "background")
    if mode not in {"background", "terminal"}:
        raise ValueError("The command mode is invalid.")
    _require_non_root()
    return run_id, tab_id, cwd.resolve(), command, mode


def _download_directory(platform_name: str | None = None) -> Path:
    explicit = (os.environ.get("FCI_DOWNLOAD_DIR") or os.environ.get("XDG_DOWNLOAD_DIR") or "").strip()
    if explicit:
        candidate = _expanded_path(explicit.replace("$HOME", str(Path.home())))
        if candidate.is_absolute():
            return candidate.resolve()
    if _platform_name(platform_name) == "windows":
        known = _windows_known_download_directory()
        if known is not None:
            return known
        user_profile = os.environ.get("USERPROFILE")
        return ((_expanded_path(user_profile) if user_profile else Path.home()) / "Downloads").resolve()
    config = Path.home() / ".config" / "user-dirs.dirs"
    if config.exists():
        try:
            for line in config.read_text(encoding="utf-8").splitlines():
                if not line.startswith("XDG_DOWNLOAD_DIR="):
                    continue
                raw = line.split("=", 1)[1].strip().strip('"')
                candidate = _expanded_path(raw.replace("$HOME", str(Path.home())))
                if candidate.is_absolute():
                    return candidate.resolve()
        except OSError:
            pass
    return (Path.home() / "Downloads").resolve()


def _xdg_download_directory() -> Path:
    """Backward-compatible alias retained for older tests and callers."""
    return _download_directory()


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _unique_destination(path: Path) -> Path:
    if not path.exists():
        return path
    stem = path.stem
    suffix = path.suffix
    for index in range(1, 100000):
        candidate = path.with_name(f"{stem} ({index}){suffix}")
        if not candidate.exists():
            return candidate
    raise ValueError("Could not create a unique destination filename.")


def validate_move_download_request(message: dict[str, Any]) -> tuple[str, int, Path, Path, str]:
    move_id = str(message.get("moveId") or "").strip()
    if not move_id or len(move_id) > 160:
        raise ValueError("The download move ID is invalid.")
    tab_id = message.get("tabId")
    if not isinstance(tab_id, int) or tab_id < 0:
        raise ValueError("The download tab ID is invalid.")
    source = _expanded_path(message.get("sourcePath"))
    destination_directory = _expanded_path(message.get("destinationDirectory"))
    if not source.is_absolute() or not destination_directory.is_absolute():
        raise ValueError("Download source and destination must be absolute paths.")
    source = source.resolve()
    download_root = _xdg_download_directory()
    if not _is_relative_to(source, download_root):
        raise ValueError(f"The source file is outside the Firefox download directory: {download_root}")
    destination_directory.mkdir(parents=True, exist_ok=True)
    if not destination_directory.is_dir():
        raise ValueError("The download destination is not a directory.")
    conflict_action = str(message.get("conflictAction") or "uniquify")
    if conflict_action not in {"uniquify", "overwrite", "fail"}:
        raise ValueError("The download conflict action is invalid.")
    return move_id, tab_id, source, destination_directory.resolve(), conflict_action


def _move_receipt_directory() -> Path:
    directory = _state_base_directory() / "moves"
    directory.mkdir(parents=True, exist_ok=True)
    return directory.resolve()


def _move_receipt_path(move_id: str) -> Path:
    digest = hashlib.sha256(move_id.encode("utf-8")).hexdigest()
    return _move_receipt_directory() / f"{digest}.json"


def _write_json_atomic(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def _load_move_receipt(move_id: str) -> dict[str, Any] | None:
    path = _move_receipt_path(move_id)
    if not path.is_file():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"The relocation receipt is unreadable: {exc}") from exc
    if not isinstance(value, dict) or value.get("schemaVersion") != MOVE_RECEIPT_SCHEMA:
        raise ValueError("The relocation receipt schema is invalid.")
    return value


def _move_response(message: dict[str, Any], receipt: dict[str, Any], *, recovered: bool) -> dict[str, Any]:
    destination = Path(str(receipt["destinationPath"]))
    if not destination.is_file():
        raise ValueError("The relocation receipt exists, but its destination file is missing.")
    return {
        "event": "download_moved",
        "requestId": message.get("requestId"),
        "moveId": receipt["moveId"],
        "tabId": receipt["tabId"],
        "sourcePath": receipt["sourcePath"],
        "destinationPath": str(destination),
        "filename": destination.name,
        "size": destination.stat().st_size,
        "recovered": recovered,
        "receiptState": receipt.get("state", "complete"),
    }


def _assert_receipt_matches(
    receipt: dict[str, Any], *, move_id: str, tab_id: int, source: Path,
    destination_directory: Path, conflict_action: str
) -> None:
    expected = {
        "moveId": move_id,
        "tabId": tab_id,
        "sourcePath": str(source),
        "destinationDirectory": str(destination_directory),
        "conflictAction": conflict_action,
    }
    for key, value in expected.items():
        if receipt.get(key) != value:
            raise ValueError(f"The relocation replay does not match its persisted receipt: {key}")


def move_download(message: dict[str, Any]) -> dict[str, Any]:
    """Move one download exactly once, even if the extension retries after restart.

    The pending receipt is written before the filesystem move. A replay with the
    same moveId either completes the pending move or returns the already moved
    destination. This closes the old crash window between shutil.move() and the
    Native Messaging response.
    """
    _require_non_root()
    move_id, tab_id, source, destination_directory, conflict_action = validate_move_download_request(message)
    receipt_path = _move_receipt_path(move_id)
    receipt = _load_move_receipt(move_id)
    if receipt is not None:
        try:
            _assert_receipt_matches(
                receipt, move_id=move_id, tab_id=tab_id, source=source,
                destination_directory=destination_directory, conflict_action=conflict_action
            )
        except ValueError:
            # Test/dev workflows may reuse a human-readable moveId after both
            # sides of an old transaction have been deleted. A live receipt is
            # never reusable, but a completely orphaned receipt may be retired.
            old_destination = Path(str(receipt.get("destinationPath") or ""))
            old_source = Path(str(receipt.get("sourcePath") or ""))
            if old_destination.exists() or old_source.exists():
                raise
            receipt_path.unlink(missing_ok=True)
            receipt = None
    if receipt is not None:
        destination = Path(str(receipt["destinationPath"]))
        if destination.is_file() and not source.exists():
            if receipt.get("state") != "complete":
                receipt = {**receipt, "state": "complete", "completedAt": time.time()}
                _write_json_atomic(receipt_path, receipt)
            return _move_response(message, receipt, recovered=True)
        if receipt.get("state") == "complete" and destination.is_file():
            return _move_response(message, receipt, recovered=True)
    else:
        if not source.exists() or not source.is_file():
            raise ValueError("The downloaded source file does not exist and no relocation receipt can recover it.")
        destination = destination_directory / source.name
        if destination.exists():
            if conflict_action == "fail":
                raise ValueError(f"The destination file already exists: {destination}")
            if conflict_action == "overwrite":
                if destination.is_dir():
                    raise ValueError("The destination path is a directory.")
                destination.unlink()
            else:
                destination = _unique_destination(destination)
        receipt = {
            "schemaVersion": MOVE_RECEIPT_SCHEMA,
            "state": "pending",
            "moveId": move_id,
            "tabId": tab_id,
            "sourcePath": str(source),
            "destinationDirectory": str(destination_directory),
            "destinationPath": str(destination),
            "conflictAction": conflict_action,
            "createdAt": time.time(),
        }
        _write_json_atomic(receipt_path, receipt)

    destination = Path(str(receipt["destinationPath"]))
    if not source.exists() or not source.is_file():
        if destination.is_file():
            receipt = {**receipt, "state": "complete", "completedAt": time.time()}
            _write_json_atomic(receipt_path, receipt)
            return _move_response(message, receipt, recovered=True)
        raise ValueError("Neither the relocation source nor the recorded destination exists.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(source), str(destination))
    receipt = {**receipt, "state": "complete", "completedAt": time.time()}
    _write_json_atomic(receipt_path, receipt)
    return _move_response(message, receipt, recovered=False)


def _log_directory() -> Path:
    directory = _state_base_directory() / "logs"
    directory.mkdir(parents=True, exist_ok=True)
    return directory.resolve()


def _log_id_for_run(run_id: str) -> str:
    return hashlib.sha256(run_id.encode("utf-8")).hexdigest()


def _validate_log_id(value: Any) -> str:
    log_id = str(value or "").strip().lower()
    if len(log_id) != 64 or any(character not in "0123456789abcdef" for character in log_id):
        raise ValueError("The shell log ID is invalid.")
    return log_id


def _log_path(log_id: str) -> Path:
    return _log_directory() / f"{_validate_log_id(log_id)}.log"


def _log_store_entries() -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for path in _log_directory().glob("*.log"):
        stem = path.stem.lower()
        if len(stem) != 64 or any(character not in "0123456789abcdef" for character in stem):
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        entries.append({
            "logId": stem,
            "path": path,
            "bytes": int(stat.st_size),
            "modifiedAt": float(stat.st_mtime),
        })
    entries.sort(key=lambda item: (item["modifiedAt"], item["logId"]))
    return entries


def log_store_stats() -> dict[str, Any]:
    entries = _log_store_entries()
    return {
        "fileCount": len(entries),
        "totalBytes": sum(int(item["bytes"]) for item in entries),
        "oldestModifiedAt": entries[0]["modifiedAt"] if entries else None,
        "newestModifiedAt": entries[-1]["modifiedAt"] if entries else None,
    }


def _retention_integer(message: dict[str, Any], key: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(message.get(key, default))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"The log retention value is invalid: {key}") from exc
    return max(minimum, min(maximum, value))


def cleanup_log_store(message: dict[str, Any], active_log_ids: set[str] | None = None) -> dict[str, Any]:
    """Delete completed shell logs by age, then oldest-first quota enforcement.

    Active runs and extension-provided unread/viewer logs are protected. Quotas
    can remain temporarily exceeded when protected logs alone exceed a limit.
    """
    max_age_days = _retention_integer(message, "maxAgeDays", 90, 1, MAX_LOG_RETENTION_DAYS)
    max_files = _retention_integer(message, "maxFiles", 500, 10, MAX_LOG_RETENTION_FILES)
    max_total_bytes = _retention_integer(
        message, "maxTotalBytes", 512 * 1024 * 1024, 16 * 1024 * 1024, MAX_LOG_RETENTION_BYTES
    )
    dry_run = bool(message.get("dryRun", False))
    protected: set[str] = set(active_log_ids or set())
    raw_protected = message.get("protectedLogIds") or []
    if not isinstance(raw_protected, list) or len(raw_protected) > MAX_LOG_RETENTION_FILES:
        raise ValueError("The protected shell log list is invalid or too large.")
    for value in raw_protected:
        protected.add(_validate_log_id(value))

    now = time.time()
    cutoff = now - max_age_days * 86400
    entries = _log_store_entries()
    before_files = len(entries)
    before_bytes = sum(int(item["bytes"]) for item in entries)
    selected: list[dict[str, Any]] = []
    selected_ids: set[str] = set()

    def select(item: dict[str, Any], reason: str) -> None:
        if item["logId"] in protected or item["logId"] in selected_ids:
            return
        selected_ids.add(item["logId"])
        selected.append({**item, "reason": reason})

    for item in entries:
        if float(item["modifiedAt"]) < cutoff:
            select(item, "age")

    remaining = [item for item in entries if item["logId"] not in selected_ids]
    remaining_files = len(remaining)
    remaining_bytes = sum(int(item["bytes"]) for item in remaining)
    for item in remaining:
        if remaining_files <= max_files and remaining_bytes <= max_total_bytes:
            break
        if item["logId"] in protected:
            continue
        select(item, "quota")
        remaining_files -= 1
        remaining_bytes -= int(item["bytes"])

    deleted: list[dict[str, Any]] = []
    for item in selected:
        path = item["path"]
        if not dry_run:
            try:
                path.unlink(missing_ok=True)
            except OSError as exc:
                raise ValueError(f"Could not delete shell log {item['logId']}: {exc}") from exc
        deleted.append({
            "logId": item["logId"],
            "bytes": int(item["bytes"]),
            "modifiedAt": float(item["modifiedAt"]),
            "reason": item["reason"],
        })

    after = log_store_stats() if not dry_run else {
        "fileCount": before_files - len(deleted),
        "totalBytes": before_bytes - sum(int(item["bytes"]) for item in deleted),
        "oldestModifiedAt": None,
        "newestModifiedAt": None,
    }
    return {
        "event": "logs_cleaned",
        "requestId": message.get("requestId"),
        "dryRun": dry_run,
        "policy": {
            "maxAgeDays": max_age_days,
            "maxFiles": max_files,
            "maxTotalBytes": max_total_bytes,
        },
        "before": {"fileCount": before_files, "totalBytes": before_bytes},
        "after": after,
        "deletedLogIds": [item["logId"] for item in deleted],
        "deleted": deleted,
        "deletedBytes": sum(int(item["bytes"]) for item in deleted),
        "protectedLogIds": sorted(protected),
        "protectedCount": len(protected),
        "limitsSatisfied": int(after["fileCount"]) <= max_files and int(after["totalBytes"]) <= max_total_bytes,
        "completedAt": now,
        "logStore": after,
    }


def read_log_chunk(message: dict[str, Any]) -> dict[str, Any]:
    log_id = _validate_log_id(message.get("logId"))
    path = _log_path(log_id)
    if not path.exists() or not path.is_file():
        raise ValueError("The shell log file does not exist.")
    total = path.stat().st_size
    max_bytes = max(1, min(MAX_LOG_READ_BYTES, int(message.get("maxBytes") or MAX_LOG_READ_BYTES)))
    if message.get("fromEnd"):
        offset = max(0, total - max_bytes)
        with path.open("rb") as stream:
            stream.seek(offset)
            while offset < total:
                byte = stream.read(1)
                if not byte or byte[0] & 0xC0 != 0x80:
                    if byte:
                        stream.seek(-1, os.SEEK_CUR)
                    break
                offset += 1
            data = stream.read(max_bytes)
    else:
        offset = max(0, min(total, int(message.get("offset") or 0)))
        with path.open("rb") as stream:
            stream.seek(offset)
            data = stream.read(max_bytes)
    # Every log write is UTF-8. Drop only an incomplete trailing code point and
    # return the exact byte offset consumed so sequential reads are lossless.
    decoded = data.decode("utf-8", errors="ignore")
    consumed = len(decoded.encode("utf-8"))
    data = data[:consumed]
    next_offset = offset + consumed
    return {
        "event": "log_chunk",
        "requestId": message.get("requestId"),
        "logId": log_id,
        "offset": offset,
        "nextOffset": next_offset,
        "totalBytes": total,
        "eof": next_offset >= total,
        "dataBase64": base64.b64encode(data).decode("ascii"),
    }


def delete_log_file(message: dict[str, Any]) -> dict[str, Any]:
    log_id = _validate_log_id(message.get("logId"))
    path = _log_path(log_id)
    path.unlink(missing_ok=True)
    return {
        "event": "log_deleted",
        "requestId": message.get("requestId"),
        "logId": log_id,
    }


def resolve_log_for_run(message: dict[str, Any]) -> dict[str, Any]:
    run_id = str(message.get("runId") or "").strip()
    if not run_id or len(run_id) > 160:
        raise ValueError("The run ID is invalid.")
    log_id = _log_id_for_run(run_id)
    path = _log_path(log_id)
    exists = path.is_file()
    return {
        "event": "log_resolved",
        "requestId": message.get("requestId"),
        "runId": run_id,
        "logId": log_id if exists else None,
        "logBytes": path.stat().st_size if exists else 0,
        "exists": exists,
    }


def find_terminal_launcher() -> tuple[str, list[str]] | None:
    candidates: list[tuple[str, list[str]]] = [
        ("gnome-terminal", ["--"]),
        ("kgx", ["--"]),
        ("xfce4-terminal", ["--execute"]),
        ("konsole", ["-e"]),
        ("x-terminal-emulator", ["-e"]),
    ]
    for executable, arguments in candidates:
        path = shutil.which(executable)
        if path:
            return path, arguments
    return None


def make_terminal_script(cwd: Path, command: str) -> Path:
    fd, raw_path = tempfile.mkstemp(prefix="firefox-chat-ai-command-", suffix=".sh")
    path = Path(raw_path)
    shell = os.environ.get("SHELL") or "/bin/bash"
    content = (
        "#!/usr/bin/env bash\n"
        "set +e\n"
        f"cd -- {json.dumps(str(cwd))} || exit 1\n"
        "self=$0\n"
        "rm -f -- \"$self\"\n"
        f"{command}\n"
        "status=$?\n"
        "printf '\\n[Firefox ChatAI Assistant] command exited with status %s\\n' \"$status\"\n"
        f"exec {json.dumps(shell)} -i\n"
    )
    os.write(fd, content.encode("utf-8"))
    os.close(fd)
    path.chmod(0o700)
    return path


def validate_run_environment(raw: Any) -> dict[str, str]:
    if raw is None:
        return {}
    if not isinstance(raw, dict) or len(raw) > MAX_ENVIRONMENT_ITEMS:
        raise ValueError("The shell environment is invalid or too large.")
    result: dict[str, str] = {}
    for raw_key, raw_value in raw.items():
        key = str(raw_key or "")
        value = str(raw_value or "")
        if not key.startswith("FCI_") or not key.replace("_", "").isalnum():
            raise ValueError("Only FCI_* environment variables are allowed.")
        if "\x00" in value or len(value) > MAX_ENVIRONMENT_VALUE_CHARS:
            raise ValueError(f"The shell environment value is invalid: {key}")
        result[key] = value
    return result


@dataclass
class RunContext:
    run_id: str
    tab_id: int
    cwd: str
    command: str
    mode: str
    log_id: str = ""
    log_path: str = ""
    log_bytes: int = 0
    environment: dict[str, str] = field(default_factory=dict)
    process: subprocess.Popen[str] | None = None
    started_at: float = field(default_factory=time.time)
    stopping: bool = False


class ProcessManager:
    def __init__(self, emit: Callable[[dict[str, Any]], None]) -> None:
        self.emit = emit
        self.lock = threading.RLock()
        self.runs: dict[str, RunContext] = {}

    def status(self) -> dict[str, Any]:
        with self.lock:
            active = [
                {
                    "runId": item.run_id,
                    "tabId": item.tab_id,
                    "mode": item.mode,
                    "pid": item.process.pid if item.process else None,
                    "cwd": item.cwd,
                    "startedAt": item.started_at,
                    "logId": item.log_id,
                    "logBytes": item.log_bytes,
                }
                for item in self.runs.values()
            ]
        return {"activeRuns": active, "logStore": log_store_stats(), "platform": sys.platform, "shell": _runtime_shell_name()}

    def start(self, message: dict[str, Any]) -> None:
        run_id, tab_id, cwd, command, mode = validate_run_request(message)
        environment = validate_run_environment(message.get("environment"))
        with self.lock:
            if run_id in self.runs:
                raise ValueError("The run ID already exists.")
            for current in self.runs.values():
                if current.tab_id == tab_id:
                    raise ValueError("This tab already has a background command running.")
            log_id = _log_id_for_run(run_id)
            log_path = _log_path(log_id)
            log_path.write_bytes(b"")
            context = RunContext(run_id, tab_id, str(cwd), command, mode, log_id, str(log_path), 0, environment)
            self.runs[run_id] = context
        environment_names = ",".join(sorted(environment)) or "none"
        self._append_log(context, "system", f"cwd={cwd}\ncommand={command}\nmode={mode}\nenvironment={environment_names}\n")

        if mode == "terminal":
            self._start_terminal(context, cwd, command)
        else:
            self._start_background(context, cwd, command)

    def _append_log(self, context: RunContext, stream_name: str, text: str) -> int:
        value = str(text or "")
        if not value or not context.log_path:
            return context.log_bytes
        timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        prefix = f"[{timestamp} {stream_name}] "
        payload = (prefix + value + ("" if value.endswith("\n") else "\n")).encode("utf-8")
        with self.lock:
            path = Path(context.log_path)
            with path.open("ab") as stream:
                stream.write(payload)
                stream.flush()
            context.log_bytes += len(payload)
            return context.log_bytes

    def _start_terminal(self, context: RunContext, cwd: Path, command: str) -> None:
        script: Path | None = None
        if IS_WINDOWS:
            invocation = windows_terminal_launcher(command)
        else:
            launcher = find_terminal_launcher()
            if launcher is None:
                with self.lock:
                    self.runs.pop(context.run_id, None)
                raise ValueError("No supported terminal was found: gnome-terminal, kgx, xfce4-terminal, konsole, or x-terminal-emulator.")
            script = make_terminal_script(cwd, command)
            executable, arguments = launcher
            invocation = [executable, *arguments, str(script)]
        try:
            process = subprocess.Popen(
                invocation,
                cwd=str(cwd),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                text=True,
                env={**os.environ, **context.environment},
                **_process_session_kwargs(terminal=True),
            )
        except Exception:
            if script is not None:
                script.unlink(missing_ok=True)
            with self.lock:
                self.runs.pop(context.run_id, None)
            raise
        context.process = process
        self.emit({
            "event": "started",
            "runId": context.run_id,
            "tabId": context.tab_id,
            "mode": context.mode,
            "pid": process.pid,
            "cwd": context.cwd,
            "hostVersion": HOST_VERSION,
            "logId": context.log_id,
            "logBytes": context.log_bytes,
        })
        threading.Thread(target=self._wait_terminal, args=(context,), daemon=True).start()

    def _wait_terminal(self, context: RunContext) -> None:
        assert context.process is not None
        return_code = context.process.wait()
        self._append_log(context, "system", f"process exited with returnCode={return_code} stopped={context.stopping}")
        with self.lock:
            self.runs.pop(context.run_id, None)
        self.emit({
            "event": "exited",
            "runId": context.run_id,
            "tabId": context.tab_id,
            "mode": context.mode,
            "returnCode": return_code,
            "stopped": context.stopping,
            "logId": context.log_id,
            "logBytes": context.log_bytes,
        })

    def _start_background(self, context: RunContext, cwd: Path, command: str) -> None:
        try:
            invocation = windows_shell_invocation(command, "background") if IS_WINDOWS else ["/bin/bash", "-lc", command]
            process = subprocess.Popen(
                invocation,
                cwd=str(cwd),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                env={**os.environ, **context.environment},
                **_process_session_kwargs(terminal=False),
            )
        except Exception:
            with self.lock:
                self.runs.pop(context.run_id, None)
            raise
        context.process = process
        self.emit({
            "event": "started",
            "runId": context.run_id,
            "tabId": context.tab_id,
            "mode": context.mode,
            "pid": process.pid,
            "cwd": context.cwd,
            "hostVersion": HOST_VERSION,
            "logId": context.log_id,
            "logBytes": context.log_bytes,
        })
        assert process.stdout is not None and process.stderr is not None
        readers = [
            threading.Thread(target=self._read_stream, args=(context, "stdout", process.stdout), daemon=True),
            threading.Thread(target=self._read_stream, args=(context, "stderr", process.stderr), daemon=True),
        ]
        for thread in readers:
            thread.start()
        threading.Thread(target=self._wait_background, args=(context, readers), daemon=True).start()

    def _read_stream(self, context: RunContext, stream_name: str, stream: Any) -> None:
        try:
            for line in iter(stream.readline, ""):
                for offset in range(0, len(line), MAX_OUTPUT_CHUNK_CHARS):
                    chunk = line[offset:offset + MAX_OUTPUT_CHUNK_CHARS]
                    log_bytes = self._append_log(context, stream_name, chunk)
                    self.emit({
                        "event": "output",
                        "runId": context.run_id,
                        "tabId": context.tab_id,
                        "stream": stream_name,
                        "text": chunk,
                        "logId": context.log_id,
                        "logBytes": log_bytes,
                    })
        finally:
            stream.close()

    def _wait_background(self, context: RunContext, readers: list[threading.Thread]) -> None:
        assert context.process is not None
        return_code = context.process.wait()
        for thread in readers:
            thread.join(timeout=1.0)
        self._append_log(context, "system", f"process exited with returnCode={return_code} stopped={context.stopping}")
        with self.lock:
            self.runs.pop(context.run_id, None)
        self.emit({
            "event": "exited",
            "runId": context.run_id,
            "tabId": context.tab_id,
            "mode": context.mode,
            "returnCode": return_code,
            "stopped": context.stopping,
            "logId": context.log_id,
            "logBytes": context.log_bytes,
        })

    def stop(self, run_id: str, tab_id: int | None = None) -> None:
        with self.lock:
            context = self.runs.get(run_id)
            if context is None or context.process is None:
                raise ValueError("No running command was found.")
            if tab_id is not None and context.tab_id != tab_id:
                raise ValueError("The tab ID does not match the running command.")
            if context.stopping:
                return
            context.stopping = True
            process = context.process
        self._append_log(context, "system", "process-tree termination requested")
        self.emit({"event": "stopping", "runId": context.run_id, "tabId": context.tab_id, "logId": context.log_id, "logBytes": context.log_bytes})
        try:
            _terminate_process_tree(process, force=False)
        except (ProcessLookupError, OSError):
            return
        threading.Thread(target=self._escalate_stop, args=(context,), daemon=True).start()

    def _escalate_stop(self, context: RunContext) -> None:
        assert context.process is not None
        try:
            context.process.wait(timeout=STOP_GRACE_SECONDS)
            return
        except subprocess.TimeoutExpired:
            pass
        try:
            _terminate_process_tree(context.process, force=True)
            self._append_log(context, "system", "forced process-tree termination sent after timeout")
            self.emit({"event": "killed", "runId": context.run_id, "tabId": context.tab_id, "logId": context.log_id, "logBytes": context.log_bytes})
        except (ProcessLookupError, OSError):
            pass

    def shutdown(self) -> None:
        with self.lock:
            contexts = list(self.runs.values())
        for context in contexts:
            if context.process is None or context.process.poll() is not None:
                continue
            context.stopping = True
            try:
                _terminate_process_tree(context.process, force=False)
            except (ProcessLookupError, OSError):
                pass


def run_host(reader: BinaryIO = sys.stdin.buffer, writer: MessageWriter | None = None) -> int:
    output = writer or MessageWriter()
    manager = ProcessManager(output.send)
    output.send({"event": "hello", "hostName": HOST_NAME, "hostVersion": HOST_VERSION, **manager.status()})
    try:
        while True:
            message = read_message(reader)
            if message is None:
                break
            action = str(message.get("action") or "")
            try:
                if action == "ping":
                    output.send({"event": "status", "hostName": HOST_NAME, "hostVersion": HOST_VERSION, **manager.status()})
                elif action == "run":
                    manager.start(message)
                elif action == "stop":
                    raw_tab_id = message.get("tabId")
                    tab_id = raw_tab_id if isinstance(raw_tab_id, int) else None
                    manager.stop(str(message.get("runId") or ""), tab_id)
                elif action == "move_download":
                    output.send(move_download(message))
                elif action == "read_log":
                    output.send(read_log_chunk(message))
                elif action == "resolve_log":
                    output.send(resolve_log_for_run(message))
                elif action == "delete_log":
                    output.send(delete_log_file(message))
                elif action == "cleanup_logs":
                    with manager.lock:
                        active_log_ids = {item.log_id for item in manager.runs.values() if item.log_id}
                    output.send(cleanup_log_store(message, active_log_ids))
                else:
                    raise ValueError("The Native Host action is not supported.")
            except Exception as error:
                output.send({
                    "event": "error",
                    "requestId": message.get("requestId"),
                    "moveId": message.get("moveId"),
                    "runId": message.get("runId"),
                    "tabId": message.get("tabId"),
                    "error": str(error),
                })
    except Exception as error:
        output.send({"event": "fatal", "error": str(error)})
        return 1
    finally:
        manager.shutdown()
    return 0


def self_test() -> int:
    os.environ["FCI_NATIVE_HOST_ALLOW_ROOT_FOR_TEST"] = "1"
    events: queue.Queue[dict[str, Any]] = queue.Queue()
    manager = ProcessManager(events.put)
    cwd = Path.cwd().resolve()
    manager.start({
        "action": "run",
        "runId": "self-test",
        "tabId": 1,
        "cwd": str(cwd),
        "command": (
            "Write-Output 'native-host-out'; [Console]::Error.WriteLine('native-host-err')"
            if IS_WINDOWS else
            "printf 'native-host-out\\n'; printf 'native-host-err\\n' >&2"
        ),
        "mode": "background",
    })
    received: list[dict[str, Any]] = []
    deadline = time.time() + 5
    while time.time() < deadline:
        try:
            event = events.get(timeout=0.2)
        except queue.Empty:
            continue
        received.append(event)
        if event.get("event") == "exited":
            break
    stdout = "".join(item.get("text", "") for item in received if item.get("stream") == "stdout")
    stderr = "".join(item.get("text", "") for item in received if item.get("stream") == "stderr")
    exited = next((item for item in received if item.get("event") == "exited"), None)
    if "native-host-out" not in stdout or "native-host-err" not in stderr or (not exited or exited.get("returnCode") != 0):
        print(json.dumps(received, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1
    print("PASS: native host protocol and background command lifecycle")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    args, _firefox_arguments = parser.parse_known_args()
    if args.self_test:
        return self_test()
    return run_host()


if __name__ == "__main__":
    raise SystemExit(main())
