#!/usr/bin/env python3
"""Native Messaging host for Firefox ChatAI Assistant.

Protocol: JSON messages prefixed by an unsigned 32-bit native-endian length.
The host accepts only explicit actions from the extension background page.
"""
from __future__ import annotations

import argparse
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
HOST_VERSION = "0.8.0"
MAX_MESSAGE_BYTES = 1024 * 1024
MAX_COMMAND_CHARS = 32768
MAX_OUTPUT_CHUNK_CHARS = 65536
STOP_GRACE_SECONDS = 3.0


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


def validate_run_request(message: dict[str, Any]) -> tuple[str, int, Path, str, str]:
    run_id = str(message.get("runId") or "").strip()
    if not run_id or len(run_id) > 160:
        raise ValueError("The run ID is invalid.")
    tab_id = message.get("tabId")
    if not isinstance(tab_id, int) or tab_id < 0:
        raise ValueError("The tab ID is invalid.")
    raw_cwd = str(message.get("cwd") or "").strip()
    cwd = Path(raw_cwd).expanduser()
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


def _xdg_download_directory() -> Path:
    explicit = os.environ.get("XDG_DOWNLOAD_DIR", "").strip()
    if explicit:
        candidate = Path(explicit.replace("$HOME", str(Path.home()))).expanduser()
        if candidate.is_absolute():
            return candidate.resolve()
    config = Path.home() / ".config" / "user-dirs.dirs"
    if config.exists():
        try:
            for line in config.read_text(encoding="utf-8").splitlines():
                if not line.startswith("XDG_DOWNLOAD_DIR="):
                    continue
                raw = line.split("=", 1)[1].strip().strip('"')
                raw = raw.replace("$HOME", str(Path.home()))
                candidate = Path(raw).expanduser()
                if candidate.is_absolute():
                    return candidate.resolve()
        except OSError:
            pass
    return (Path.home() / "Downloads").resolve()


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
    source = Path(str(message.get("sourcePath") or "")).expanduser()
    destination_directory = Path(str(message.get("destinationDirectory") or "")).expanduser()
    if not source.is_absolute() or not destination_directory.is_absolute():
        raise ValueError("Download source and destination must be absolute paths.")
    source = source.resolve()
    download_root = _xdg_download_directory()
    if not _is_relative_to(source, download_root):
        raise ValueError(f"The source file is outside the Firefox download directory: {download_root}")
    if not source.exists() or not source.is_file():
        raise ValueError("The downloaded source file does not exist.")
    destination_directory.mkdir(parents=True, exist_ok=True)
    if not destination_directory.is_dir():
        raise ValueError("The download destination is not a directory.")
    conflict_action = str(message.get("conflictAction") or "uniquify")
    if conflict_action not in {"uniquify", "overwrite", "fail"}:
        raise ValueError("The download conflict action is invalid.")
    return move_id, tab_id, source, destination_directory.resolve(), conflict_action


def move_download(message: dict[str, Any]) -> dict[str, Any]:
    _require_non_root()
    move_id, tab_id, source, destination_directory, conflict_action = validate_move_download_request(message)
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
    shutil.move(str(source), str(destination))
    return {
        "event": "download_moved",
        "moveId": move_id,
        "tabId": tab_id,
        "sourcePath": str(source),
        "destinationPath": str(destination),
        "filename": destination.name,
        "size": destination.stat().st_size,
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


@dataclass
class RunContext:
    run_id: str
    tab_id: int
    cwd: str
    command: str
    mode: str
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
                }
                for item in self.runs.values()
            ]
        return {"activeRuns": active}

    def start(self, message: dict[str, Any]) -> None:
        run_id, tab_id, cwd, command, mode = validate_run_request(message)
        with self.lock:
            if run_id in self.runs:
                raise ValueError("The run ID already exists.")
            for current in self.runs.values():
                if current.tab_id == tab_id:
                    raise ValueError("This tab already has a background command running.")
            context = RunContext(run_id, tab_id, str(cwd), command, mode)
            self.runs[run_id] = context

        if mode == "terminal":
            self._start_terminal(context, cwd, command)
        else:
            self._start_background(context, cwd, command)

    def _start_terminal(self, context: RunContext, cwd: Path, command: str) -> None:
        launcher = find_terminal_launcher()
        if launcher is None:
            with self.lock:
                self.runs.pop(context.run_id, None)
            raise ValueError("No supported terminal was found: gnome-terminal, kgx, xfce4-terminal, konsole, or x-terminal-emulator.")
        script = make_terminal_script(cwd, command)
        executable, arguments = launcher
        try:
            process = subprocess.Popen(
                [executable, *arguments, str(script)],
                cwd=str(cwd),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
                text=True,
            )
        except Exception:
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
        })
        threading.Thread(target=self._wait_terminal, args=(context,), daemon=True).start()

    def _wait_terminal(self, context: RunContext) -> None:
        assert context.process is not None
        return_code = context.process.wait()
        with self.lock:
            self.runs.pop(context.run_id, None)
        self.emit({
            "event": "exited",
            "runId": context.run_id,
            "tabId": context.tab_id,
            "mode": context.mode,
            "returnCode": return_code,
            "stopped": context.stopping,
        })

    def _start_background(self, context: RunContext, cwd: Path, command: str) -> None:
        try:
            process = subprocess.Popen(
                ["/bin/bash", "-lc", command],
                cwd=str(cwd),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                start_new_session=True,
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
                    self.emit({
                        "event": "output",
                        "runId": context.run_id,
                        "tabId": context.tab_id,
                        "stream": stream_name,
                        "text": line[offset:offset + MAX_OUTPUT_CHUNK_CHARS],
                    })
        finally:
            stream.close()

    def _wait_background(self, context: RunContext, readers: list[threading.Thread]) -> None:
        assert context.process is not None
        return_code = context.process.wait()
        for thread in readers:
            thread.join(timeout=1.0)
        with self.lock:
            self.runs.pop(context.run_id, None)
        self.emit({
            "event": "exited",
            "runId": context.run_id,
            "tabId": context.tab_id,
            "mode": context.mode,
            "returnCode": return_code,
            "stopped": context.stopping,
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
        self.emit({"event": "stopping", "runId": context.run_id, "tabId": context.tab_id})
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
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
            os.killpg(context.process.pid, signal.SIGKILL)
            self.emit({"event": "killed", "runId": context.run_id, "tabId": context.tab_id})
        except ProcessLookupError:
            pass

    def shutdown(self) -> None:
        with self.lock:
            contexts = list(self.runs.values())
        for context in contexts:
            if context.process is None or context.process.poll() is not None:
                continue
            context.stopping = True
            try:
                os.killpg(context.process.pid, signal.SIGTERM)
            except ProcessLookupError:
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
                else:
                    raise ValueError("The Native Host action is not supported.")
            except Exception as error:
                output.send({
                    "event": "error",
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
        "command": "printf 'native-host-out\\n'; printf 'native-host-err\\n' >&2",
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
