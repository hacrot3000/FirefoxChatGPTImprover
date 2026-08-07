#!/usr/bin/env python3
"""Supervising runner for Python Patch Tool v5.

The supervisor isolates every patch in a child process, validates archives and
Python syntax before execution, captures a durable log, emits a standard summary,
creates a PASS/FAIL report ZIP, and can perform controlled Git add/commit/push.
"""

from __future__ import annotations

import argparse
import copy
import datetime as dt
import fnmatch
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import queue
import re
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import tempfile
import threading
import traceback
from typing import Any, Iterable, Optional
import time
import zipfile

from python_patch_transaction import SandboxTransaction, TransactionError
from python_patch_identity import (
    IdentityError,
    adopt_project_identity,
    append_success_history,
    inspect_patch_candidate,
    load_project_identity,
    load_successful_fingerprints,
    validate_project_key,
)

from python_patch_commands import (
    CommandPolicyError,
    decide_run as decide_post_command_run,
    normalize_manifest_request as normalize_post_command_request,
    normalize_policy as normalize_post_command_policy,
    run_commands as run_post_commands,
)

from python_patch_selector import select_patch_items

from python_patch_intelligence import (
    build_failure_delta,
    select_validation_profiles,
    write_validation_selection,
)

from python_patch_diagnostics import (
    SmartLogCapture,
    build_report_index,
    analyze_source_drift,
    cluster_root_causes,
    collect_code_context,
    collect_environment_fingerprint,
    create_ai_bundles,
    parse_diagnostics_from_text,
    redact_secrets,
    syntax_diagnostic,
    write_diagnostics,
    write_diagnostic_quality,
    write_root_causes,
)

TOOL_VERSION = "5.16.0"
MANIFEST_NAME = "PATCH_TOOL_MANIFEST.json"
OPS_NAME = "PATCH_TOOL_OPS.json"
DEFAULT_CONFIG_NAMES = (
    "tools/_patch_lib/python_patch_tool_config.json",
    "tools/python_patch_tool_config.json",
    ".python_patch_tool.json",
)
SUPPORTED_SUFFIXES = (".py", ".zip", ".tar.gz", ".tgz")

DEFAULT_CONFIG: dict[str, Any] = {
    "schema_version": 1,
    "automation": {
        "zero_argument": {
            "enabled": True,
            "selection": "prompt",
            "non_interactive_confirmed": False,
            "initial_selection": "none",
            "selector_ui": "auto",
            "move_success": True,
            "stop_on_failure": True,
            "keep_failed_input": True,
            "natural_sort": True,
            "inventory_mode": "compact",
            "max_inventory_items": 20,
            "write_last_run": True,
        },
        "queue_hygiene": {
            "enabled": True,
            "move_ignored": True,
            "ignored_dir": "patchs/ignored",
            "warn_non_patch": True,
            "warn_foreign_project": True,
        },
        "local_history": {
            "enabled": True,
            "skip_successful_duplicates": True,
            "file": "patchs/reports/.patch_tool_local_history/successful.jsonl",
        },
    },
    "project_identity": {
        "enabled": True,
        "require_patch_key": True,
        "adopt_from_first_patch": True,
        "identity_file": ".python_patch_tool_project.json",
    },
    "path_policy": {
        "display": "relative",
        "reports": "relative",
    },
    "console": {
        "color": "auto",
        "critical_paths": "absolute",
        "show_bundle_guide": True,
        "live_status": True,
        "live_status_interval_seconds": 0.5,
    },
    "package_policy": {
        "require_zip": False,
        "require_manifest": False,
        "require_standard_metadata": False,
        "warn_standalone": True,
        "allow_legacy_v4": True,
        "warn_legacy_v4_unscoped_project": True,
    },
    "execution": {
        "timeout_seconds": 0,
        "max_archive_members": 10000,
        "max_archive_total_bytes": 1024 * 1024 * 1024,
        "max_archive_member_bytes": 256 * 1024 * 1024,
        "max_log_bytes": 256 * 1024 * 1024,
        "console_mode": "smart",
        "raw_command_log_max_bytes": 256 * 1024 * 1024,
        "important_context_before": 2,
        "important_context_after": 2,
        "failure_tail_lines": 80,
        "max_important_lines": 4000,
        "redact_secret_values": True,
        "max_line_chars": 20000,
        "terminate_grace_seconds": 3.0,
        "kill_grace_seconds": 1.0,
    },
    "reports": {
        "enabled": True,
        "keep_work_directory": False,
        "ai_handoff": {
            "enabled": True,
            "max_code_files": 24,
            "max_code_total_bytes": 4194304,
            "full_file_max_bytes": 262144,
            "context_lines": 20,
            "max_diff_bytes": 1048576,
            "include_touched_files": True,
            "max_root_causes": 8,
            "max_symbols": 12,
            "max_symbol_lines": 800,
            "max_symbol_bytes": 524288,
            "handoff_max_tokens": 24000,
            "summary_max_tokens": 10000,
            "code_max_tokens": 28000,
            "per_text_file_max_tokens": 6000,
            "deduplicate_by_sha256": True,
            "semantic_safe_truncation": True,
            "split_compatibility_bundles": False
        },
        "retention": {
            "enabled": False,
            "max_pass_reports": 50,
            "max_pass_age_days": 0,
        },
    },
    "code_collection": {
        "enabled": True,
        "output_root": "artifacts/patch_tool_code_collections",
        "max_files": 1000,
        "max_total_bytes": 67108864,
        "max_file_bytes": 8388608,
        "max_search_matches": 500,
        "relative_paths_only": True,
        "redact_secret_values": True,
    },
    "source_drift": {
        "enabled": True,
        "fail_on_drift": True,
        "allow_file_hash_drift_when_symbol_matches": True,
        "max_file_bytes": 67108864
    },
    "transaction": {
        "mode": "auto",
        "keep_failed_sandbox": False,
        "overlay_paths": [],
        "exclude_paths": [
            "patchs/**",
            ".git/**"
        ],
        "max_apply_paths": 4000,
        "idempotency": "data_only"
    },
    "post_patch": {
        "enabled": True,
        "default_timeout_seconds": 300,
        "max_timeout_seconds": 1800,
        "max_commands": 8,
        "allow_no_change_override": True,
        "max_forced_commands": 1,
        "allowed_basic_commands": ["ls", "tree", "pwd", "find"],
        "allowed_interpreters": ["python", "python3", "bash", "sh", "node", "pwsh", "powershell"],
        "script_extensions": [".py", ".sh", ".bash", ".js", ".mjs", ".cjs", ".ps1", ".pl", ".rb"],
    },
    "validation": {
        "default_profiles": [],
        "profiles": {},
        "timeout_seconds": 0,
        "fail_on_error": True,
        "selection": {
            "mode": "off",
            "fallback_profiles": [],
            "rules": [],
        },
        "diagnostic_rerun": {
            "enabled": True,
            "max_commands": 1,
        },
    },
    "git": {
        "add": "changed",
        "commit": "off",
        "commit_message": "",
        "push": "off",
        "remote": "",
        "branch": "",
        "fail_on_error": True,
        "exclude_paths": [
            "patchs/backup/**",
            "patchs/failed_patch_files/**",
            "patchs/reports/**",
            "patchs/.patch_runner_tmp/**",
            "patchs/patched/**",
            "**/__pycache__/**",
            "**/*.pyc",
        ],
    },
}

BOOTSTRAP = r'''from pathlib import Path
import os
import runpy
import sys

patch_file = str(Path(sys.argv[1]).resolve())
patch_args = sys.argv[2:]
tools_dir = str(Path(os.environ["PYTHON_PATCH_PROJECT_TOOLS"]).resolve())

def normalized(value):
    if value == "":
        return str(Path.cwd().resolve())
    try:
        return str(Path(value).resolve())
    except Exception:
        return value

sys.path = [tools_dir] + [entry for entry in sys.path if normalized(entry) != tools_dir]
sys.argv = [patch_file, *patch_args]
runpy.run_path(patch_file, run_name="__main__")
'''

OPS_BOOTSTRAP = r'''from pathlib import Path
import os
import sys

tools_dir = str(Path(os.environ["PYTHON_PATCH_PROJECT_TOOLS"]).resolve())
sys.path.insert(0, tools_dir)
from python_patch_utils import run_ops_file

ops_file = str(Path(sys.argv[1]).resolve())
sys.argv = [ops_file, *sys.argv[2:]]
raise SystemExit(run_ops_file(ops_file))
'''


class RunnerError(RuntimeError):
    pass


class ItemLogger:
    def __init__(self, log_path: Path, max_bytes: int) -> None:
        self.log_path = log_path
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = self.log_path.open("ab")
        self.max_bytes = max(0, int(max_bytes))
        self.written = 0
        self.truncated = False
        self.lock = threading.Lock()

    def write_bytes(self, data: bytes, *, console: bool = True) -> None:
        if not data:
            return
        with self.lock:
            if console:
                try:
                    sys.stdout.buffer.write(data)
                    sys.stdout.buffer.flush()
                except Exception:
                    pass
            if self.max_bytes == 0 or self.written < self.max_bytes:
                allowed = len(data) if self.max_bytes == 0 else min(len(data), self.max_bytes - self.written)
                if allowed > 0:
                    self.handle.write(data[:allowed])
                    self.handle.flush()
                    self.written += allowed
            if self.max_bytes and self.written >= self.max_bytes and not self.truncated:
                marker = b"\n[PATCH TOOL V5] report log reached configured size limit; further child output is console-only.\n"
                self.handle.write(marker)
                self.handle.flush()
                self.truncated = True

    def line(self, text: str = "", *, error: bool = False) -> None:
        data = (text + "\n").encode("utf-8", "replace")
        with self.lock:
            stream = sys.stderr.buffer if error else sys.stdout.buffer
            try:
                stream.write(data)
                stream.flush()
            except Exception:
                pass
            if self.max_bytes == 0 or self.written < self.max_bytes:
                allowed = len(data) if self.max_bytes == 0 else min(len(data), self.max_bytes - self.written)
                if allowed > 0:
                    self.handle.write(data[:allowed])
                    self.handle.flush()
                    self.written += allowed

    def close(self) -> None:
        try:
            self.handle.close()
        except Exception:
            pass


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).astimezone().isoformat(timespec="seconds")


def timestamp() -> str:
    return dt.datetime.now().strftime("%Y%m%d_%H%M%S")


def slug(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "_", value.strip()).strip("._")
    return cleaned or "patch"


def deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    result = copy.deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = copy.deepcopy(value)
    return result


def read_json(path: Path, label: str) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise RunnerError(f"Cannot read {label} {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise RunnerError(f"{label} must contain one JSON object: {path}")
    return data


def load_config(project_root: Path, explicit: Optional[Path]) -> tuple[dict[str, Any], list[str]]:
    config = copy.deepcopy(DEFAULT_CONFIG)
    loaded: list[str] = []
    candidates: list[Path]
    if explicit:
        candidates = [explicit.expanduser().resolve()]
    else:
        candidates = [project_root / name for name in DEFAULT_CONFIG_NAMES]
    for path in candidates:
        if not path.exists():
            continue
        data = read_json(path, "configuration")
        if data.get("schema_version", 1) != 1:
            raise RunnerError(f"Unsupported configuration schema_version in {path}")
        config = deep_merge(config, data)
        loaded.append(str(path))
    return config, loaded


def archive_kind(path: Path) -> str:
    name = path.name.lower()
    if name.endswith(".zip"):
        return "zip"
    if name.endswith((".tar.gz", ".tgz")):
        return "tar.gz"
    return ""


def natural_name_key(value: str) -> tuple[Any, ...]:
    """Sort patch names in human order so phase2 runs before phase10."""
    parts = re.split(r"(\d+)", value.casefold())
    return tuple(int(part) if part.isdigit() else part for part in parts)


def list_patch_items(patch_dir: Path, *, natural_sort: bool = True) -> list[Path]:
    if not patch_dir.is_dir():
        raise RunnerError(f"Patch directory not found: {patch_dir}")
    items = []
    for path in patch_dir.iterdir():
        if not path.is_file():
            continue
        lower = path.name.lower()
        if lower.endswith(SUPPORTED_SUFFIXES):
            items.append(path.resolve())
    key = (lambda p: natural_name_key(p.name)) if natural_sort else (lambda p: p.name)
    return sorted(items, key=key)


def normalize_zero_argument_config(config: dict[str, Any]) -> dict[str, Any]:
    raw = config.get("automation", {}).get("zero_argument", {})
    if not isinstance(raw, dict):
        raise RunnerError("automation.zero_argument must be an object")
    configured_selection = str(raw.get("selection", "prompt")).strip().lower()
    if configured_selection not in {"prompt", "all", "first", "newest"}:
        raise RunnerError("automation.zero_argument.selection must be prompt, all, first, or newest")
    non_interactive_confirmed = bool(raw.get("non_interactive_confirmed", False))
    automatic_selection_unconfirmed = configured_selection != "prompt" and not non_interactive_confirmed
    selection = "prompt" if automatic_selection_unconfirmed else configured_selection
    initial_selection = str(raw.get("initial_selection", "none")).strip().lower()
    if initial_selection not in {"none", "all"}:
        raise RunnerError("automation.zero_argument.initial_selection must be none or all")
    selector_ui = str(raw.get("selector_ui", "auto")).strip().lower()
    if selector_ui not in {"auto", "line"}:
        raise RunnerError("automation.zero_argument.selector_ui must be auto or line")
    inventory_mode = str(raw.get("inventory_mode", "compact")).strip().lower()
    if inventory_mode not in {"compact", "full", "off"}:
        raise RunnerError("automation.zero_argument.inventory_mode must be compact, full, or off")
    max_items = int(raw.get("max_inventory_items", 20))
    if max_items < 0:
        raise RunnerError("automation.zero_argument.max_inventory_items cannot be negative")
    return {
        "enabled": bool(raw.get("enabled", True)),
        "selection": selection,
        "configured_selection": configured_selection,
        "non_interactive_confirmed": non_interactive_confirmed,
        "automatic_selection_unconfirmed": automatic_selection_unconfirmed,
        "initial_selection": initial_selection,
        "selector_ui": selector_ui,
        "move_success": bool(raw.get("move_success", True)),
        "stop_on_failure": bool(raw.get("stop_on_failure", True)),
        "keep_failed_input": bool(raw.get("keep_failed_input", True)),
        "natural_sort": bool(raw.get("natural_sort", True)),
        "inventory_mode": inventory_mode,
        "max_inventory_items": max_items,
        "write_last_run": bool(raw.get("write_last_run", True)),
    }


def normalize_queue_hygiene_config(config: dict[str, Any]) -> dict[str, Any]:
    raw = config.get("automation", {}).get("queue_hygiene", {})
    if not isinstance(raw, dict):
        raise RunnerError("automation.queue_hygiene must be an object")
    ignored_dir = str(raw.get("ignored_dir", "patchs/ignored")).replace("\\", "/").strip("/")
    pure = PurePosixPath(ignored_dir)
    if pure.is_absolute() or any(part in {"", ".", ".."} for part in pure.parts):
        raise RunnerError("automation.queue_hygiene.ignored_dir must be a safe relative path")
    return {
        "enabled": bool(raw.get("enabled", True)),
        "move_ignored": bool(raw.get("move_ignored", True)),
        "ignored_dir": pure.as_posix(),
        "warn_non_patch": bool(raw.get("warn_non_patch", True)),
        "warn_foreign_project": bool(raw.get("warn_foreign_project", True)),
    }


def normalize_identity_config(config: dict[str, Any]) -> dict[str, Any]:
    raw = config.get("project_identity", {})
    if not isinstance(raw, dict):
        raise RunnerError("project_identity must be an object")
    return {
        "enabled": bool(raw.get("enabled", True)),
        "require_patch_key": bool(raw.get("require_patch_key", True)),
        "adopt_from_first_patch": bool(raw.get("adopt_from_first_patch", True)),
        "identity_file": str(raw.get("identity_file", ".python_patch_tool_project.json")),
    }


def normalize_local_history_config(config: dict[str, Any]) -> dict[str, Any]:
    raw = config.get("automation", {}).get("local_history", {})
    if not isinstance(raw, dict):
        raise RunnerError("automation.local_history must be an object")
    return {
        "enabled": bool(raw.get("enabled", True)),
        "skip_successful_duplicates": bool(raw.get("skip_successful_duplicates", True)),
        "file": str(raw.get("file", "patchs/reports/.patch_tool_local_history/successful.jsonl")),
    }


def relative_to(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except Exception:
        return str(path)


_ANSI = {
    "reset": "\033[0m",
    "bold": "\033[1m",
    "dim": "\033[2m",
    "red": "\033[31m",
    "green": "\033[32m",
    "yellow": "\033[33m",
    "blue": "\033[34m",
    "cyan": "\033[36m",
    "bright_green": "\033[92m",
    "bright_yellow": "\033[93m",
    "bright_blue": "\033[94m",
}


def _console_color_enabled(config: dict[str, Any]) -> bool:
    raw = config.get("console", {}) if isinstance(config.get("console", {}), dict) else {}
    mode = str(raw.get("color", "auto")).strip().lower()
    if os.environ.get("NO_COLOR") is not None or mode == "never":
        return False
    if mode == "always" or os.environ.get("FORCE_COLOR"):
        return True
    return bool(sys.stdout.isatty() and os.environ.get("TERM", "").lower() != "dumb")


def _paint(text: str, config: dict[str, Any], *styles: str) -> str:
    if not _console_color_enabled(config):
        return text
    prefix = "".join(_ANSI.get(style, "") for style in styles)
    return f"{prefix}{text}{_ANSI['reset']}" if prefix else text


class LiveStatus:
    """TTY-only ephemeral progress line. It never writes to ItemLogger/report logs."""

    def __init__(self, config: dict[str, Any]) -> None:
        raw = config.get("console", {}) if isinstance(config.get("console", {}), dict) else {}
        self.enabled = bool(raw.get("live_status", True)) and bool(sys.stdout.isatty())
        self.interval = max(0.2, float(raw.get("live_status_interval_seconds", 0.5)))
        self.started = 0.0
        self.last_draw = 0.0
        self.label = ""
        self.detail = ""
        self.lock = threading.Lock()
        self.visible = False

    def _render(self) -> str:
        elapsed = max(0.0, time.monotonic() - self.started) if self.started else 0.0
        detail = f" | {self.detail}" if self.detail else ""
        return _paint(f"⏳ {self.label} | {elapsed:.1f}s{detail}", config=self._config, *())

    def bind_config(self, config: dict[str, Any]) -> "LiveStatus":
        self._config = config
        return self

    def start(self, label: str, detail: str = "") -> None:
        if not self.enabled:
            return
        with self.lock:
            self.started = time.monotonic()
            self.last_draw = 0.0
            self.label = str(label)[:180]
            self.detail = str(detail)[:180]
            self._draw(force=True)

    def update(self, detail: str = "", *, label: Optional[str] = None, force: bool = False) -> None:
        if not self.enabled:
            return
        with self.lock:
            if label is not None:
                self.label = str(label)[:180]
            if detail:
                self.detail = str(detail)[:180]
            self._draw(force=force)

    def _draw(self, *, force: bool = False) -> None:
        now = time.monotonic()
        if not force and now - self.last_draw < self.interval:
            return
        elapsed = max(0.0, now - self.started) if self.started else 0.0
        detail = f" | {self.detail}" if self.detail else ""
        text = f"⏳ {self.label} | {elapsed:.1f}s{detail}"
        try:
            sys.stdout.write("\r\033[2K" + _paint(text, self._config, "bright_blue"))
            sys.stdout.flush()
            self.visible = True
            self.last_draw = now
        except Exception:
            pass

    def clear(self) -> None:
        if not self.enabled:
            return
        with self.lock:
            if self.visible:
                try:
                    sys.stdout.write("\r\033[2K")
                    sys.stdout.flush()
                except Exception:
                    pass
            self.visible = False

    def finish(self) -> None:
        self.clear()
        self.started = 0.0
        self.label = ""
        self.detail = ""


def _critical_console_path(path: Path, project_root: Path, config: dict[str, Any]) -> str:
    raw = config.get("console", {}) if isinstance(config.get("console", {}), dict) else {}
    mode = str(raw.get("critical_paths", "absolute")).strip().lower()
    if mode == "relative":
        return relative_to(path, project_root)
    return str(path.expanduser().resolve())


def _human_bytes(value: int) -> str:
    size = float(max(0, int(value)))
    units = ("B", "KiB", "MiB", "GiB")
    for unit in units:
        if size < 1024.0 or unit == units[-1]:
            return f"{int(size)} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024.0
    return f"{int(value)} B"


def _print_bundle_entry(
    *, config: dict[str, Any], project_root: Path, tag: str, title: str,
    purpose: str, usage: str, entry: dict[str, Any], tag_style: tuple[str, ...],
    path_style: tuple[str, ...] = (),
) -> None:
    path = Path(str(entry["path"]))
    print(_paint(f"{tag} {title}", config, *tag_style))
    print(f"  Meaning : {purpose}")
    print(f"  Use     : {usage}")
    print("  File    : " + _paint(_critical_console_path(path, project_root, config), config, *path_style))
    token_text = f"estimated_text_tokens={entry.get('estimated_text_tokens', 0)}"
    if int(entry.get("max_tokens", 0) or 0) > 0:
        token_text += f" / budget={entry.get('max_tokens')}"
    print(f"  Size    : {_human_bytes(int(entry.get('bytes', 0)))} | {token_text}")
    omitted = len(entry.get("omitted", []) or [])
    compacted = len(entry.get("compacted", []) or [])
    if omitted or compacted:
        print(f"  Budget  : compacted={compacted} | omitted={omitted} | within_budget={entry.get('within_budget', True)}")
    print()


def print_ai_handoff_guide(
    *, bundles: dict[str, Any], project_root: Path, config: dict[str, Any], report_zip: Path,
) -> None:
    print()
    print("================ AI HANDOFF FILES ================")
    print("PROJECT ROOT: " + _paint(str(project_root.resolve()), config, "bold", "bright_blue"))
    print(_paint("NORMAL ACTION: Upload only the [PRIMARY - UPLOAD] HANDOFF file.", config, "bold", "bright_green"))
    print()
    console_cfg = config.get("console", {}) if isinstance(config.get("console", {}), dict) else {}
    show_guide = bool(console_cfg.get("show_bundle_guide", True))
    if not show_guide:
        primary = Path(str(bundles["handoff"]["path"]))
        detail = Path(str(bundles["detail"]["path"]))
        print(_paint("[PRIMARY - UPLOAD] " + _critical_console_path(primary, project_root, config), config, "bold", "bright_green"))
        print(_paint("[DEBUG ONLY] " + _critical_console_path(detail, project_root, config), config, "yellow"))
        print("REPORT ZIP: same file as DETAIL.zip; not an additional ZIP.")
        return
    _print_bundle_entry(
        config=config, project_root=project_root, tag="[PRIMARY - UPLOAD]", title="HANDOFF.zip",
        purpose="Compact all-in-one package: root causes, relevant code, patch payload and next AI action.",
        usage="This is normally the only file you send to AI.", entry=bundles["handoff"],
        tag_style=("bold", "bright_green"), path_style=("bold", "bright_green"),
    )
    if bundles.get("summary", {}).get("path"):
        _print_bundle_entry(
            config=config, project_root=project_root, tag="[OPTIONAL]", title="SUMMARY.zip",
            purpose="Compact text diagnostics and summaries without the full code context.",
            usage="Usually unnecessary because HANDOFF already contains this information.", entry=bundles["summary"],
            tag_style=("bold", "cyan"), path_style=("cyan",),
        )
    if bundles.get("code", {}).get("path"):
        _print_bundle_entry(
            config=config, project_root=project_root, tag="[OPTIONAL]", title="CODE.zip",
            purpose="Relevant source snippets, symbols, diffs and stale-anchor candidates.",
            usage="Send only when AI explicitly asks for code context as a separate ZIP.", entry=bundles["code"],
            tag_style=("bold", "cyan"), path_style=("cyan",),
        )
    if not bundles.get("summary", {}).get("path") and not bundles.get("code", {}).get("path"):
        print(_paint("[INFO] SUMMARY.zip and CODE.zip are not generated by default in v5.16; their useful content is already inside HANDOFF.zip.", config, "dim"))
        print()
    _print_bundle_entry(
        config=config, project_root=project_root, tag="[DEBUG ONLY]", title="DETAIL.zip",
        purpose="Complete redacted raw logs, runner evidence, Git state and machine-readable diagnostics.",
        usage="Large evidence bundle; send only when AI requests deeper/raw evidence.", entry=bundles["detail"],
        tag_style=("bold", "bright_yellow"), path_style=("yellow",),
    )
    detail_path = Path(str(bundles["detail"]["path"])).resolve()
    same_report = detail_path == report_zip.resolve()
    alias_text = "same file as DETAIL.zip above; it is not an additional fifth ZIP" if same_report else "report archive"
    print(_paint("[ALIAS] REPORT ZIP", config, "dim") + f": {alias_text}.")
    if not same_report:
        print("  File    : " + _critical_console_path(report_zip, project_root, config))
    budget = bundles.get("handoff", {})
    if int(budget.get("max_tokens", 0) or 0) > 0:
        omitted = len(budget.get("omitted", []) or [])
        print(_paint(f"TOKEN BUDGET: HANDOFF {budget.get('estimated_text_tokens', 0)}/{budget.get('max_tokens')} estimated tokens; omitted={omitted}.", config, "bright_blue"))
        if omitted:
            print("  The omission list is inside AI_SUMMARY/ai_handoff_budget.md; DETAIL keeps complete redacted evidence.")
    print("SEND ORDER: HANDOFF only -> DETAIL only if AI requests raw evidence.")
    print("Do not paste the full console; it is preserved in DETAIL.zip.")


def redact_command(command: Iterable[str]) -> list[str]:
    return [redact_secrets(str(part))[0] for part in command]


def redact_text(value: str) -> str:
    return redact_secrets(value)[0]


def allocate_ignored_path(base: Path, name: str) -> Path:
    base.mkdir(parents=True, exist_ok=True)
    candidate = base / name
    if not candidate.exists():
        return candidate
    stem = Path(name).stem
    suffixes = "".join(Path(name).suffixes)
    for index in range(2, 100000):
        candidate = base / f"{stem}.duplicate{index}{suffixes}"
        if not candidate.exists():
            return candidate
    raise RunnerError(f"Cannot allocate ignored path for {name}")


def quarantine_item(item: Path, project_root: Path, hygiene: dict[str, Any], category: str) -> str:
    if not hygiene.get("move_ignored", True):
        return relative_to(item, project_root)
    base = project_root / hygiene["ignored_dir"] / category
    destination = allocate_ignored_path(base, item.name)
    shutil.move(str(item), str(destination))
    return relative_to(destination, project_root)


def prepare_patch_queue(
    *, project_root: Path, raw_items: list[Path], config: dict[str, Any], force_repeat: bool,
    enforce_hygiene: bool = True,
) -> tuple[list[Path], dict[str, dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    """Classify queue inputs without executing them and enforce only local optimizations."""
    hygiene = normalize_queue_hygiene_config(config)
    identity_cfg = normalize_identity_config(config)
    history_cfg = normalize_local_history_config(config)
    try:
        identity = load_project_identity(project_root, identity_cfg["identity_file"]) if identity_cfg["enabled"] else {"exists": False, "key": "", "path": None}
    except IdentityError as exc:
        raise RunnerError(str(exc)) from exc
    successful = (
        load_successful_fingerprints(project_root, history_cfg["file"])
        if history_cfg["enabled"] and history_cfg["skip_successful_duplicates"] and not force_repeat else set()
    )
    inspected: list[tuple[Path, dict[str, Any]]] = []
    skipped: list[dict[str, Any]] = []
    metadata: dict[str, dict[str, Any]] = {}
    for item in raw_items:
        info = inspect_patch_candidate(item)
        inspected.append((item, info))

    if not enforce_hygiene:
        metadata = {str(item.resolve()): info for item, info in inspected}
        identity_summary = {
            "enabled": identity_cfg["enabled"],
            "key": identity.get("key", ""),
            "exists": bool(identity.get("exists")),
            "adopted": bool(identity.get("adopted", False)),
            "file": relative_to(identity["path"], project_root) if identity.get("path") else "",
            "local_only": True,
        }
        return list(raw_items), metadata, [], identity_summary

    runnable: list[Path] = []
    for item, info in inspected:
        rel = relative_to(item, project_root)
        category = ""
        reason = ""
        if not info.get("is_patch"):
            category = "non_patch"
            reason = str(info.get("reason") or "not a recognized Patch Tool package")
        elif (
            identity_cfg["enabled"] and identity_cfg["require_patch_key"]
            and not info.get("project_key") and not info.get("legacy_v4")
        ):
            category = "missing_project_key"
            reason = "manifest has no project.key required by this project"
        elif (
            identity_cfg["enabled"] and identity.get("key") and info.get("project_key")
            and info.get("project_key") != identity.get("key")
        ):
            category = "foreign_project"
            reason = f"target project {info.get('project_key')!r} does not match local project {identity.get('key')!r}"
        elif info.get("fingerprint") in successful:
            category = "duplicate_success"
            reason = "same canonical patch payload already PASSed on this machine"

        if category:
            moved = quarantine_item(item, project_root, hygiene, category) if hygiene.get("enabled", True) else rel
            record = {
                "input": rel, "status": "SKIPPED", "category": category, "reason": reason,
                "moved_to": moved if moved != rel else "", "project_key": info.get("project_key", ""),
                "patch_id": info.get("patch_id", ""), "version": info.get("version", ""),
                "fingerprint": info.get("fingerprint", ""),
            }
            skipped.append(record)
            print(f"WARNING: skipped {rel}: {reason}")
            if record["moved_to"]:
                print(f"         moved to {record['moved_to']}")
            continue
        if info.get("legacy_v4") and bool(config.get("package_policy", {}).get("warn_legacy_v4_unscoped_project", True)):
            print(
                f"WARNING: accepted legacy Patch Tool v4 input {rel}; it has no project.key, "
                "so project targeting cannot be verified. Current source/Git state remains authoritative."
            )
        runnable.append(item)
        metadata[str(item.resolve())] = info
    identity_summary = {
        "enabled": identity_cfg["enabled"],
        "key": identity.get("key", ""),
        "exists": bool(identity.get("exists")),
        "adopted": bool(identity.get("adopted", False)),
        "file": relative_to(identity["path"], project_root) if identity.get("path") else "",
        "local_only": True,
    }
    return runnable, metadata, skipped, identity_summary


def safe_member_name(name: str) -> PurePosixPath:
    if not name or "\x00" in name:
        raise RunnerError(f"Invalid empty/NUL archive member name: {name!r}")
    normalized = name.replace("\\", "/")
    pure = PurePosixPath(normalized)
    if pure.is_absolute() or normalized.startswith("/"):
        raise RunnerError(f"Absolute archive member path is not allowed: {name!r}")
    if any(part in {"", ".", ".."} for part in pure.parts):
        raise RunnerError(f"Unsafe archive member path is not allowed: {name!r}")
    if pure.parts and re.match(r"^[A-Za-z]:$", pure.parts[0]):
        raise RunnerError(f"Drive-qualified archive member is not allowed: {name!r}")
    return pure


def check_archive_limits(count: int, total: int, config: dict[str, Any]) -> None:
    execution = config["execution"]
    if count > int(execution["max_archive_members"]):
        raise RunnerError(f"Archive has too many members: {count}")
    if total > int(execution["max_archive_total_bytes"]):
        raise RunnerError(f"Archive expands beyond total size limit: {total} bytes")


def extract_archive_safely(archive: Path, destination: Path, config: dict[str, Any]) -> list[str]:
    destination.mkdir(parents=True, exist_ok=True)
    member_limit = int(config["execution"]["max_archive_member_bytes"])
    inventory: list[str] = []
    seen: set[str] = set()
    kind = archive_kind(archive)
    if kind == "zip":
        with zipfile.ZipFile(archive, "r") as zf:
            infos = zf.infolist()
            check_archive_limits(len(infos), sum(info.file_size for info in infos), config)
            for info in infos:
                pure = safe_member_name(info.filename)
                key = pure.as_posix()
                if key in seen:
                    raise RunnerError(f"Duplicate archive member is not allowed: {key}")
                seen.add(key)
                if info.flag_bits & 0x1:
                    raise RunnerError(f"Encrypted archive member is not supported: {key}")
                unix_mode = (info.external_attr >> 16) & 0xFFFF
                if unix_mode and stat.S_ISLNK(unix_mode):
                    raise RunnerError(f"Symbolic link is not allowed: {key}")
                if info.file_size > member_limit:
                    raise RunnerError(f"Archive member exceeds size limit: {key}")
                target = destination.joinpath(*pure.parts)
                if info.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    inventory.append(f"DIR  {key}")
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info, "r") as source, target.open("wb") as output:
                    shutil.copyfileobj(source, output, length=1024 * 1024)
                inventory.append(f"FILE {info.file_size:12d} {key}")
    elif kind == "tar.gz":
        with tarfile.open(archive, "r:gz") as tf:
            members = tf.getmembers()
            check_archive_limits(len(members), sum(m.size for m in members if m.isfile()), config)
            for member in members:
                pure = safe_member_name(member.name)
                key = pure.as_posix()
                if key in seen:
                    raise RunnerError(f"Duplicate archive member is not allowed: {key}")
                seen.add(key)
                if member.issym() or member.islnk():
                    raise RunnerError(f"Archive links are not allowed: {key}")
                if not (member.isdir() or member.isfile()):
                    raise RunnerError(f"Special archive member is not allowed: {key}")
                if member.size > member_limit:
                    raise RunnerError(f"Archive member exceeds size limit: {key}")
                target = destination.joinpath(*pure.parts)
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                    inventory.append(f"DIR  {key}")
                    continue
                source = tf.extractfile(member)
                if source is None:
                    raise RunnerError(f"Cannot extract archive member: {key}")
                target.parent.mkdir(parents=True, exist_ok=True)
                with source, target.open("wb") as output:
                    shutil.copyfileobj(source, output, length=1024 * 1024)
                inventory.append(f"FILE {member.size:12d} {key}")
    else:
        raise RunnerError(f"Unsupported archive type: {archive.name}")
    return inventory


def collect_patch_scripts(extract_dir: Path) -> list[Path]:
    preferred = sorted(p for p in extract_dir.rglob("patch_*.py") if p.is_file())
    if preferred:
        return preferred
    return sorted(p for p in extract_dir.rglob("*.py") if p.is_file())


def load_manifest(extract_dir: Path) -> tuple[dict[str, Any], Optional[Path]]:
    path = extract_dir / MANIFEST_NAME
    if not path.exists():
        return {}, None
    data = read_json(path, "patch manifest")
    if data.get("schema_version", 1) != 1:
        raise RunnerError(f"Unsupported manifest schema_version in {path}")
    for section in ("project", "patch", "git", "execution", "validation"):
        if section in data and not isinstance(data[section], dict):
            raise RunnerError(f"Manifest field {section!r} must be an object")
    return data, path


def validate_mode(value: Any, allowed: set[str], field: str) -> str:
    text = str(value).strip().lower()
    if text not in allowed:
        raise RunnerError(f"Invalid {field}: {value!r}; allowed: {', '.join(sorted(allowed))}")
    return text


def _plain_single_line(value: Any, field: str, *, max_length: int) -> str:
    if not isinstance(value, str):
        raise RunnerError(f"{field} must be a string")
    text = value.strip()
    if not text:
        raise RunnerError(f"{field} cannot be empty")
    if "\x00" in text or "\n" in text or "\r" in text:
        raise RunnerError(f"{field} must be one plain line")
    if len(text) > max_length:
        raise RunnerError(f"{field} is too long (maximum {max_length} characters)")
    return text


def validate_manifest_standard(manifest: dict[str, Any], require_standard: bool) -> None:
    if not manifest:
        return
    patch = manifest.get("patch", {})
    if not isinstance(patch, dict):
        raise RunnerError("Manifest patch field must be an object")
    project = manifest.get("project", {})
    if project and not isinstance(project, dict):
        raise RunnerError("Manifest project field must be an object")
    if isinstance(project, dict) and project.get("key") not in (None, ""):
        try:
            project["key"] = validate_project_key(project.get("key"))
        except IdentityError as exc:
            raise RunnerError(str(exc)) from exc
    required_fields = {
        "id": 128,
        "version": 80,
        "phase": 240,
        "phase_under_test": 240,
        "summary": 600,
        "regression_scope": 1200,
    }
    if require_standard:
        missing = [name for name in required_fields if not isinstance(patch.get(name), str) or not patch.get(name, "").strip()]
        if not isinstance(project, dict) or not isinstance(project.get("key"), str) or not project.get("key", "").strip():
            missing.append("project.key")
        if missing:
            raise RunnerError("Manifest is missing standard patch metadata: " + ", ".join(missing))
    for name, limit in required_fields.items():
        if name in patch:
            patch[name] = _plain_single_line(patch[name], f"patch.{name}", max_length=limit)
    if "id" in patch and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", patch["id"]):
        raise RunnerError("patch.id may contain only letters, digits, dot, underscore, and hyphen")

    source_baseline = manifest.get("source_baseline", {})
    if not isinstance(source_baseline, dict):
        raise RunnerError("Manifest source_baseline field must be an object")
    unsupported_baseline = sorted(set(source_baseline) - {"files", "generated_from"})
    if unsupported_baseline:
        raise RunnerError("Unsupported source_baseline fields: " + ", ".join(unsupported_baseline))
    generated_from = source_baseline.get("generated_from", "")
    if generated_from and (not isinstance(generated_from, str) or len(generated_from) > 500 or any(ch in generated_from for ch in "\r\n\x00")):
        raise RunnerError("source_baseline.generated_from must be a short single-line string")
    baseline_files = source_baseline.get("files", [])
    if not isinstance(baseline_files, list) or len(baseline_files) > 200:
        raise RunnerError("source_baseline.files must be a list with at most 200 entries")
    for index, entry in enumerate(baseline_files, 1):
        if not isinstance(entry, dict):
            raise RunnerError(f"source_baseline.files[{index}] must be an object")
        unsupported = sorted(set(entry) - {"file", "sha256", "symbol", "symbol_sha256", "line_hint"})
        if unsupported:
            raise RunnerError(f"Unsupported source baseline fields at entry {index}: " + ", ".join(unsupported))
        rel = entry.get("file")
        if not isinstance(rel, str) or not rel.strip():
            raise RunnerError(f"source_baseline.files[{index}].file must be a non-empty relative path")
        pure = PurePosixPath(rel.replace("\\", "/"))
        if pure.is_absolute() or any(part in {"", ".."} for part in pure.parts):
            raise RunnerError(f"source_baseline.files[{index}].file must stay inside the project root")
        for field in ("sha256", "symbol_sha256"):
            value = str(entry.get(field, "")).strip().lower()
            if value and not re.fullmatch(r"[0-9a-f]{64}", value):
                raise RunnerError(f"source_baseline.files[{index}].{field} must be a SHA-256 hex digest")
            if value:
                entry[field] = value
        if not entry.get("sha256") and not entry.get("symbol_sha256"):
            raise RunnerError(f"source_baseline.files[{index}] must provide sha256 and/or symbol_sha256")
        if "symbol" in entry:
            symbol = str(entry.get("symbol", "")).strip()
            if not symbol or len(symbol) > 240 or any(ch in symbol for ch in "\r\n\x00"):
                raise RunnerError(f"source_baseline.files[{index}].symbol is invalid")
            entry["symbol"] = symbol
        line_hint = int(entry.get("line_hint", 0) or 0)
        if line_hint < 0:
            raise RunnerError(f"source_baseline.files[{index}].line_hint cannot be negative")
        entry["line_hint"] = line_hint

    git_cfg = manifest.get("git", {})
    if not isinstance(git_cfg, dict):
        raise RunnerError("Manifest git field must be an object")
    if "commit_message" in git_cfg and str(git_cfg.get("commit_message", "")).strip():
        git_cfg["commit_message"] = _plain_single_line(git_cfg["commit_message"], "git.commit_message", max_length=300)

    execution = manifest.get("execution", {})
    if not isinstance(execution, dict):
        raise RunnerError("Manifest execution field must be an object")
    unsupported_execution = sorted(set(execution) - {"timeout_seconds"})
    if unsupported_execution:
        raise RunnerError(
            "Manifest execution may only set timeout_seconds; console filtering and report policy belong to trusted project configuration: "
            + ", ".join(unsupported_execution)
        )
    if "timeout_seconds" in execution and float(execution["timeout_seconds"]) < 0:
        raise RunnerError("execution.timeout_seconds cannot be negative")

    post_patch = manifest.get("post_patch", {})
    if not isinstance(post_patch, dict):
        raise RunnerError("Manifest post_patch field must be an object")
    # Full policy-aware validation happens after project configuration is loaded.
    unsupported_post_patch = sorted(set(post_patch) - {"commands", "run_when_no_changes", "no_change_reason"})
    if unsupported_post_patch:
        raise RunnerError("Unsupported manifest post_patch fields: " + ", ".join(unsupported_post_patch))

    validation = manifest.get("validation", {})
    if not isinstance(validation, dict):
        raise RunnerError("Manifest validation field must be an object")
    unsupported = sorted(set(validation) - {"profiles"})
    if unsupported:
        raise RunnerError(
            "Manifest validation may only select trusted project profiles; unsupported fields: "
            + ", ".join(unsupported)
        )
    selected = validation.get("profiles", [])
    if not isinstance(selected, list) or any(not isinstance(name, str) or not name.strip() for name in selected):
        raise RunnerError("validation.profiles must be a list of non-empty profile names")
    if len(set(selected)) != len(selected):
        raise RunnerError("validation.profiles cannot contain duplicate names")


def _safe_relative_directory(value: Any, field: str) -> str:
    if not isinstance(value, str):
        raise RunnerError(f"{field} must be a string")
    normalized = value.strip().replace("\\", "/") or "."
    pure = PurePosixPath(normalized)
    if pure.is_absolute() or any(part in {"", ".."} for part in pure.parts):
        raise RunnerError(f"{field} must stay inside the project root")
    return pure.as_posix()


def _normalize_diagnostic_rerun(raw: Any, profile_name: str, command_index: int, default_timeout: float) -> Optional[dict[str, Any]]:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise RunnerError(f"diagnostic_rerun in profile {profile_name!r} command {command_index} must be an object")
    enabled = bool(raw.get("enabled", True))
    safe = bool(raw.get("safe", False))
    command = raw.get("command")
    append_args = raw.get("append_args")
    if command is not None and append_args is not None:
        raise RunnerError(f"diagnostic_rerun in profile {profile_name!r} command {command_index} cannot set both command and append_args")
    if command is not None:
        if not isinstance(command, list) or not command or any(not isinstance(part, str) or not part or "\x00" in part for part in command):
            raise RunnerError(f"diagnostic_rerun.command in profile {profile_name!r} command {command_index} must be a non-empty argv list")
        normalized_command = list(command)
        normalized_append: list[str] = []
    else:
        if append_args is None:
            append_args = []
        if not isinstance(append_args, list) or any(not isinstance(part, str) or not part or "\x00" in part for part in append_args):
            raise RunnerError(f"diagnostic_rerun.append_args in profile {profile_name!r} command {command_index} must be an argv list")
        normalized_command = []
        normalized_append = list(append_args)
    timeout = float(raw.get("timeout_seconds", default_timeout))
    if timeout < 0:
        raise RunnerError(f"diagnostic_rerun timeout in profile {profile_name!r} command {command_index} cannot be negative")
    name = str(raw.get("name", "Diagnostic rerun")).strip()
    if not name or "\n" in name or "\r" in name or len(name) > 240:
        raise RunnerError(f"diagnostic_rerun name is invalid in profile {profile_name!r} command {command_index}")
    only_exit_codes = raw.get("only_exit_codes", [])
    if not isinstance(only_exit_codes, list) or any(not isinstance(code, int) for code in only_exit_codes):
        raise RunnerError(f"diagnostic_rerun.only_exit_codes in profile {profile_name!r} command {command_index} must be integer exit codes")
    return {
        "enabled": enabled,
        "safe": safe,
        "name": name,
        "command": normalized_command,
        "append_args": normalized_append,
        "timeout_seconds": timeout,
        "only_exit_codes": only_exit_codes,
        "on_timeout": bool(raw.get("on_timeout", False)),
    }


def normalize_validation_config(cfg: dict[str, Any], selected_profiles: list[str]) -> dict[str, Any]:
    profiles = cfg.get("profiles", {})
    if not isinstance(profiles, dict):
        raise RunnerError("validation.profiles in project configuration must be an object")
    default_timeout = float(cfg.get("timeout_seconds", 0))
    if default_timeout < 0:
        raise RunnerError("validation.timeout_seconds cannot be negative")
    normalized_profiles: dict[str, list[dict[str, Any]]] = {}
    for raw_name, raw_commands in profiles.items():
        if not isinstance(raw_name, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", raw_name):
            raise RunnerError(f"Invalid validation profile name: {raw_name!r}")
        if not isinstance(raw_commands, list) or not raw_commands:
            raise RunnerError(f"Validation profile {raw_name!r} must contain at least one command")
        normalized_commands: list[dict[str, Any]] = []
        for index, raw in enumerate(raw_commands, 1):
            if not isinstance(raw, dict):
                raise RunnerError(f"Validation profile {raw_name!r} command {index} must be an object")
            command = raw.get("command")
            if not isinstance(command, list) or not command or any(not isinstance(part, str) or not part for part in command):
                raise RunnerError(
                    f"Validation profile {raw_name!r} command {index} must use a non-empty argv list; shell strings are not allowed"
                )
            if any("\x00" in part for part in command):
                raise RunnerError(f"Validation profile {raw_name!r} command {index} contains NUL")
            timeout = float(raw.get("timeout_seconds", default_timeout))
            if timeout < 0:
                raise RunnerError(f"Validation profile {raw_name!r} command {index} has a negative timeout")
            name = str(raw.get("name", "")).strip() or f"{raw_name} command {index}"
            if "\n" in name or "\r" in name or len(name) > 240:
                raise RunnerError(f"Validation command name is invalid in profile {raw_name!r}")
            normalized_commands.append({
                "name": name,
                "command": command,
                "cwd": _safe_relative_directory(raw.get("cwd", "."), f"validation profile {raw_name} cwd"),
                "timeout_seconds": timeout,
                "diagnostic_rerun": _normalize_diagnostic_rerun(raw.get("diagnostic_rerun"), raw_name, index, timeout),
            })
        normalized_profiles[raw_name] = normalized_commands

    unknown = [name for name in selected_profiles if name not in normalized_profiles]
    if unknown:
        raise RunnerError("Unknown validation profile(s): " + ", ".join(unknown))

    raw_selection = cfg.get("selection", {})
    if not isinstance(raw_selection, dict):
        raise RunnerError("validation.selection must be an object")
    selection_mode = validate_mode(raw_selection.get("mode", "off"), {"off", "append", "replace"}, "validation.selection.mode")
    fallback = raw_selection.get("fallback_profiles", [])
    if not isinstance(fallback, list) or any(not isinstance(name, str) or not name for name in fallback):
        raise RunnerError("validation.selection.fallback_profiles must be a list of profile names")
    rules = raw_selection.get("rules", [])
    if not isinstance(rules, list):
        raise RunnerError("validation.selection.rules must be a list")
    normalized_rules: list[dict[str, Any]] = []
    referenced = list(fallback)
    for index, rule in enumerate(rules, 1):
        if not isinstance(rule, dict):
            raise RunnerError(f"validation.selection rule {index} must be an object")
        include = rule.get("include", [])
        exclude = rule.get("exclude", [])
        rule_profiles = rule.get("profiles", [])
        if not isinstance(include, list) or not include or any(not isinstance(value, str) or not value.strip() for value in include):
            raise RunnerError(f"validation.selection rule {index} requires non-empty include glob patterns")
        if not isinstance(exclude, list) or any(not isinstance(value, str) or not value.strip() for value in exclude):
            raise RunnerError(f"validation.selection rule {index} exclude must be a list of glob patterns")
        if not isinstance(rule_profiles, list) or not rule_profiles or any(not isinstance(value, str) or not value for value in rule_profiles):
            raise RunnerError(f"validation.selection rule {index} requires profile names")
        referenced.extend(rule_profiles)
        normalized_rules.append({
            "name": str(rule.get("name", f"rule {index}")).strip() or f"rule {index}",
            "include": [value.replace("\\", "/") for value in include],
            "exclude": [value.replace("\\", "/") for value in exclude],
            "profiles": list(rule_profiles),
        })
    unknown_auto = sorted({name for name in referenced if name not in normalized_profiles})
    if unknown_auto:
        raise RunnerError("validation.selection references unknown profile(s): " + ", ".join(unknown_auto))

    raw_rerun = cfg.get("diagnostic_rerun", {})
    if not isinstance(raw_rerun, dict):
        raise RunnerError("validation.diagnostic_rerun must be an object")
    max_commands = int(raw_rerun.get("max_commands", 1))
    if max_commands < 0 or max_commands > 20:
        raise RunnerError("validation.diagnostic_rerun.max_commands must be between 0 and 20")

    return {
        "profiles": normalized_profiles,
        "selected_profiles": selected_profiles,
        "timeout_seconds": default_timeout,
        "fail_on_error": bool(cfg.get("fail_on_error", True)),
        "selection": {
            "mode": selection_mode,
            "fallback_profiles": list(fallback),
            "rules": normalized_rules,
        },
        "diagnostic_rerun": {
            "enabled": bool(raw_rerun.get("enabled", True)),
            "max_commands": max_commands,
        },
    }


def effective_policy(config: dict[str, Any], manifest: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    policy = copy.deepcopy(config)
    manifest_overlay: dict[str, Any] = {}
    if "git" in manifest:
        manifest_overlay["git"] = manifest["git"]
    if "execution" in manifest and "timeout_seconds" in manifest["execution"]:
        manifest_overlay["execution"] = {"timeout_seconds": manifest["execution"]["timeout_seconds"]}
    policy = deep_merge(policy, manifest_overlay)

    if args.require_zip is not None:
        policy["package_policy"]["require_zip"] = args.require_zip
    if args.require_manifest is not None:
        policy["package_policy"]["require_manifest"] = args.require_manifest
    if args.require_standard_metadata is not None:
        policy["package_policy"]["require_standard_metadata"] = args.require_standard_metadata
    if args.patch_timeout is not None:
        policy["execution"]["timeout_seconds"] = args.patch_timeout
    if args.console_mode is not None:
        policy["execution"]["console_mode"] = args.console_mode
    if args.ai_handoff_enabled is not None:
        policy.setdefault("reports", {}).setdefault("ai_handoff", {})["enabled"] = args.ai_handoff_enabled
    if args.git_add is not None:
        policy["git"]["add"] = args.git_add
    if args.git_commit is not None:
        policy["git"]["commit"] = args.git_commit
    if args.git_commit_message is not None:
        policy["git"]["commit_message"] = args.git_commit_message
        policy["git"]["commit"] = "auto"
    if args.git_push is not None:
        policy["git"]["push"] = args.git_push
    if args.git_remote is not None:
        policy["git"]["remote"] = args.git_remote
    if args.git_branch is not None:
        policy["git"]["branch"] = args.git_branch
    if args.git_fail_on_error is not None:
        policy["git"]["fail_on_error"] = args.git_fail_on_error
    if args.report_enabled is not None:
        policy["reports"]["enabled"] = args.report_enabled
    if args.keep_report_dir is not None:
        policy["reports"]["keep_work_directory"] = args.keep_report_dir
    if args.transaction_mode is not None:
        policy.setdefault("transaction", {})["mode"] = args.transaction_mode
    if args.idempotency_mode is not None:
        policy.setdefault("transaction", {})["idempotency"] = args.idempotency_mode
    if args.keep_failed_sandbox is not None:
        policy.setdefault("transaction", {})["keep_failed_sandbox"] = args.keep_failed_sandbox

    validation_cfg = copy.deepcopy(policy.get("validation", {}))
    default_selected = validation_cfg.get("default_profiles", [])
    if not isinstance(default_selected, list) or any(not isinstance(name, str) or not name.strip() for name in default_selected):
        raise RunnerError("validation.default_profiles must be a list of non-empty profile names")
    selected = list(default_selected)
    manifest_validation = manifest.get("validation", {})
    if isinstance(manifest_validation, dict) and "profiles" in manifest_validation:
        selected = list(manifest_validation.get("profiles", []))
    if args.validation_profiles is not None:
        selected = list(args.validation_profiles)
    if args.no_validation:
        selected = []
        validation_cfg["selection"] = {"mode": "off", "fallback_profiles": [], "rules": []}
    if args.validation_fail_on_error is not None:
        validation_cfg["fail_on_error"] = args.validation_fail_on_error
    policy["validation"] = normalize_validation_config(validation_cfg, selected)

    git_cfg = policy["git"]
    git_cfg["add"] = validate_mode(git_cfg.get("add", "off"), {"off", "changed", "all"}, "git.add")
    git_cfg["commit"] = validate_mode(git_cfg.get("commit", "off"), {"off", "auto"}, "git.commit")
    git_cfg["push"] = validate_mode(git_cfg.get("push", "off"), {"off", "auto"}, "git.push")
    if git_cfg["commit"] != "off" and not str(git_cfg.get("commit_message", "")).strip():
        raise RunnerError("git.commit=auto requires a non-empty git.commit_message")
    if str(git_cfg.get("commit_message", "")).strip():
        git_cfg["commit_message"] = _plain_single_line(git_cfg["commit_message"], "git.commit_message", max_length=300)
    remote = str(git_cfg.get("remote", "")).strip()
    if remote and ("://" in remote or "@" in remote or any(ch.isspace() for ch in remote)):
        raise RunnerError("git.remote must be a configured remote name, not a URL or credential-bearing value")
    timeout = float(policy["execution"].get("timeout_seconds", 0))
    if timeout < 0:
        raise RunnerError("execution.timeout_seconds cannot be negative")
    policy["execution"]["timeout_seconds"] = timeout
    drift_cfg = policy.get("source_drift", {})
    if not isinstance(drift_cfg, dict):
        raise RunnerError("source_drift project configuration must be an object")
    for field in ("enabled", "fail_on_drift", "allow_file_hash_drift_when_symbol_matches"):
        drift_cfg[field] = bool(drift_cfg.get(field, DEFAULT_CONFIG["source_drift"][field]))
    drift_cfg["max_file_bytes"] = int(drift_cfg.get("max_file_bytes", DEFAULT_CONFIG["source_drift"]["max_file_bytes"]))
    if drift_cfg["max_file_bytes"] < 1:
        raise RunnerError("source_drift.max_file_bytes must be positive")
    policy["source_drift"] = drift_cfg

    transaction_cfg = policy.get("transaction", {})
    if not isinstance(transaction_cfg, dict):
        raise RunnerError("transaction project configuration must be an object")
    transaction_cfg["mode"] = validate_mode(
        transaction_cfg.get("mode", "auto"), {"off", "auto", "required"}, "transaction.mode"
    )
    transaction_cfg["idempotency"] = validate_mode(
        transaction_cfg.get("idempotency", "data_only"), {"off", "data_only", "all"}, "transaction.idempotency"
    )
    transaction_cfg["keep_failed_sandbox"] = bool(transaction_cfg.get("keep_failed_sandbox", False))
    transaction_cfg["max_apply_paths"] = int(transaction_cfg.get("max_apply_paths", 4000))
    if transaction_cfg["max_apply_paths"] < 1:
        raise RunnerError("transaction.max_apply_paths must be positive")
    for field in ("overlay_paths", "exclude_paths"):
        values = transaction_cfg.get(field, [])
        if not isinstance(values, list) or any(not isinstance(value, str) or not value.strip() for value in values):
            raise RunnerError(f"transaction.{field} must be a list of non-empty relative path strings")
        transaction_cfg[field] = values
    policy["transaction"] = transaction_cfg
    try:
        policy["post_patch"] = normalize_post_command_policy(policy.get("post_patch", {}))
        policy["post_patch_request"] = normalize_post_command_request(
            manifest.get("post_patch", {}), policy["post_patch"]
        )
    except CommandPolicyError as exc:
        raise RunnerError(f"PTV-POST-COMMAND-POLICY-001: {exc}") from exc
    return policy


def run_command(command: list[str], cwd: Path, *, check: bool = False, text: bool = True) -> subprocess.CompletedProcess[Any]:
    return subprocess.run(command, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=text, check=check)


def git_available(project_root: Path) -> bool:
    if not shutil.which("git"):
        return False
    result = run_command(["git", "rev-parse", "--is-inside-work-tree"], project_root)
    return result.returncode == 0 and result.stdout.strip() == "true"


def parse_porcelain_z(data: bytes) -> dict[str, str]:
    tokens = data.split(b"\0")
    entries: dict[str, str] = {}
    i = 0
    while i < len(tokens):
        token = tokens[i]
        i += 1
        if not token:
            continue
        if len(token) < 4:
            continue
        xy = token[:2].decode("ascii", "replace")
        path = token[3:].decode("utf-8", "surrogateescape")
        entries[path] = xy
        if "R" in xy or "C" in xy:
            if i < len(tokens) and tokens[i]:
                other = tokens[i].decode("utf-8", "surrogateescape")
                entries[other] = xy
                i += 1
    return entries


def fingerprint(path: Path) -> str:
    try:
        info = path.lstat()
    except FileNotFoundError:
        return "missing"
    if stat.S_ISLNK(info.st_mode):
        return "symlink:" + os.readlink(path)
    if stat.S_ISREG(info.st_mode):
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return f"file:{info.st_mode & 0o7777:o}:{info.st_size}:{digest.hexdigest()}"
    if stat.S_ISDIR(info.st_mode):
        return f"dir:{info.st_mode & 0o7777:o}"
    return f"special:{info.st_mode}"


def git_snapshot(project_root: Path) -> dict[str, Any]:
    if not git_available(project_root):
        return {"available": False, "status": {}, "fingerprints": {}, "head": "", "branch": "", "upstream": "", "staged": []}
    status_result = run_command(
        ["git", "status", "--porcelain=v1", "-z", "--untracked-files=all"],
        project_root,
        text=False,
    )
    if status_result.returncode != 0:
        raise RunnerError(status_result.stderr.decode("utf-8", "replace").strip() or "git status failed")
    entries = parse_porcelain_z(status_result.stdout)
    fingerprints = {path: fingerprint(project_root / path) for path in entries}

    def git_text(args: list[str]) -> str:
        result = run_command(["git", *args], project_root)
        return result.stdout.strip() if result.returncode == 0 else ""

    staged_result = run_command(["git", "diff", "--cached", "--name-only", "-z"], project_root, text=False)
    staged = [p.decode("utf-8", "surrogateescape") for p in staged_result.stdout.split(b"\0") if p]
    return {
        "available": True,
        "status": entries,
        "fingerprints": fingerprints,
        "head": git_text(["rev-parse", "HEAD"]),
        "branch": git_text(["symbolic-ref", "--short", "-q", "HEAD"]),
        "upstream": git_text(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]),
        "staged": staged,
    }


def touched_paths(before: dict[str, Any], after: dict[str, Any]) -> list[str]:
    if not before.get("available") or not after.get("available"):
        return []
    paths = set(before["status"]) | set(after["status"])
    changed = []
    for path in sorted(paths):
        if before["status"].get(path) != after["status"].get(path):
            changed.append(path)
            continue
        if before["fingerprints"].get(path) != after["fingerprints"].get(path):
            changed.append(path)
    return changed


def is_excluded(path: str, patterns: Iterable[str], input_rel: str) -> bool:
    normalized = path.replace("\\", "/")
    if normalized == input_rel:
        return True
    for pattern in patterns:
        p = str(pattern).replace("\\", "/")
        if fnmatch.fnmatch(normalized, p):
            return True
        if p.endswith("/**") and normalized.startswith(p[:-3].rstrip("/") + "/"):
            return True
    return False


def git_run_logged(command: list[str], root: Path, logger: ItemLogger, result: dict[str, Any]) -> subprocess.CompletedProcess[str]:
    safe_command = redact_command(command)
    display = " ".join(safe_command)
    logger.line(f"$ {display}")
    completed = run_command(command, root)
    if completed.stdout:
        logger.line(completed.stdout.rstrip())
    if completed.stderr:
        logger.line(completed.stderr.rstrip(), error=completed.returncode != 0)
    result.setdefault("commands", []).append({
        "command": safe_command,
        "returncode": completed.returncode,
        "stdout": redact_text(completed.stdout or ""),
        "stderr": redact_text(completed.stderr or ""),
    })
    return completed


def apply_git_workflow(
    project_root: Path,
    before: dict[str, Any],
    after_patch: dict[str, Any],
    changed: list[str],
    policy: dict[str, Any],
    input_rel: str,
    logger: ItemLogger,
) -> tuple[dict[str, Any], Optional[str]]:
    cfg = policy["git"]
    result: dict[str, Any] = {
        "requested": {"add": cfg["add"], "commit": cfg["commit"], "push": cfg["push"]},
        "available": after_patch.get("available", False),
        "touched_paths": changed,
        "staged_paths": [],
        "commit_created": False,
        "pushed": False,
        "commands": [],
        "warnings": [],
    }
    actions_requested = any(cfg[key] != "off" for key in ("add", "commit", "push"))
    if not actions_requested:
        return result, None
    if not after_patch.get("available"):
        error = "Git workflow requested, but project is not a Git work tree or git is unavailable."
        return result, error if cfg.get("fail_on_error", True) else None

    excluded = cfg.get("exclude_paths", [])
    if cfg["add"] == "changed":
        add_paths = [p for p in changed if not is_excluded(p, excluded, input_rel)]
    elif cfg["add"] == "all":
        add_paths = [p for p in sorted(after_patch["status"]) if not is_excluded(p, excluded, input_rel)]
    else:
        add_paths = []

    if cfg["add"] != "off":
        if add_paths:
            for start in range(0, len(add_paths), 200):
                completed = git_run_logged(["git", "add", "-A", "--", *add_paths[start:start + 200]], project_root, logger, result)
                if completed.returncode != 0:
                    error = "git add failed"
                    return result, error if cfg.get("fail_on_error", True) else None
            result["staged_paths"] = add_paths
            logger.line(f"Git add: staged {len(add_paths)} path(s).")
        else:
            logger.line("Git add: no eligible changed paths; skipped.")

    commit_paths = result["staged_paths"]
    if cfg["commit"] != "off":
        if not commit_paths:
            logger.line("Git commit: no paths staged by this package; empty commit suppressed.")
        else:
            message = str(cfg.get("commit_message", "")).strip()
            completed = git_run_logged(
                ["git", "commit", "--only", "-m", message, "--", *commit_paths],
                project_root,
                logger,
                result,
            )
            if completed.returncode != 0:
                error = "git commit failed"
                return result, error if cfg.get("fail_on_error", True) else None
            result["commit_created"] = True
            result["commit_message"] = message
            result["commit_hash"] = run_command(["git", "rev-parse", "HEAD"], project_root).stdout.strip()

    if cfg["push"] != "off":
        remote = str(cfg.get("remote", "")).strip()
        branch = str(cfg.get("branch", "")).strip()
        command = ["git", "push"]
        if remote:
            command.append(remote)
            if branch:
                command.append(branch)
        elif branch:
            result["warnings"].append("git.branch is ignored unless git.remote is set")
        completed = git_run_logged(command, project_root, logger, result)
        if completed.returncode != 0:
            error = "git push failed"
            return result, error if cfg.get("fail_on_error", True) else None
        result["pushed"] = True

    return result, None


def _diagnostic_command_is_dangerous(command: list[str]) -> tuple[bool, str]:
    deny_markers = {
        "flash", "flashing", "deploy", "deployment", "push", "publish", "release",
        "ota", "upload", "erase", "provision", "burn", "dfu", "esptool", "openocd",
        "picotool", "avrdude", "west-flash", "kubectl", "terraform", "ansible-playbook",
    }
    inspected: list[str] = []
    skip_next_script = False
    for token in command:
        if skip_next_script:
            skip_next_script = False
            continue
        lower = token.lower().strip()
        if lower in {"-c", "--command"}:
            skip_next_script = True
            continue
        base = Path(lower).name
        inspected.append(base)
        pieces = {piece for piece in re.split(r"[^a-z0-9]+", base) if piece}
        hit = sorted(pieces & deny_markers)
        if hit:
            return True, hit[0]
    joined = " ".join(inspected[:6])
    for phrase in ("git push", "docker push", "kubectl apply", "idf.py flash", "west flash"):
        if phrase in joined:
            return True, phrase
    return False, ""


def _run_diagnostic_rerun(
    *,
    primary_command: list[str],
    primary_exit_code: int,
    primary_timed_out: bool,
    spec: Optional[dict[str, Any]],
    cwd: Path,
    env: dict[str, str],
    profile_name: str,
    command_index: int,
    logger: ItemLogger,
    policy: dict[str, Any],
) -> dict[str, Any]:
    global_cfg = policy.get("validation", {}).get("diagnostic_rerun", {})
    result: dict[str, Any] = {
        "status": "NOT_CONFIGURED" if not spec else "SKIPPED",
        "attempted": False,
        "reason": "",
    }
    if not spec:
        return result
    if not global_cfg.get("enabled", True):
        result["reason"] = "globally_disabled"
        return result
    if not spec.get("enabled", True):
        result["reason"] = "command_disabled"
        return result
    if not spec.get("safe", False):
        result["reason"] = "safe_confirmation_missing"
        return result
    if primary_timed_out and not spec.get("on_timeout", False):
        result["reason"] = "primary_timed_out"
        return result
    only_codes = list(spec.get("only_exit_codes", []))
    if only_codes and primary_exit_code not in only_codes:
        result["reason"] = "exit_code_not_selected"
        return result
    rerun_command = list(spec.get("command", [])) or (list(primary_command) + list(spec.get("append_args", [])))
    dangerous, marker = _diagnostic_command_is_dangerous(rerun_command)
    if dangerous:
        result.update({"status": "SKIPPED_DANGEROUS", "reason": f"dangerous_marker:{marker}", "command": redact_command(rerun_command)})
        logger.line(f"DIAGNOSTIC RERUN SKIPPED: command matched dangerous marker {marker!r}", error=True)
        return result
    timeout = float(spec.get("timeout_seconds", 0))
    name = str(spec.get("name", "Diagnostic rerun"))
    logger.line(f"DIAGNOSTIC RERUN: {name}")
    logger.line("$ " + " ".join(redact_command(rerun_command)))
    rerun_env = dict(env)
    rerun_env["PYTHON_PATCH_DIAGNOSTIC_RERUN"] = "1"
    exec_cfg = policy.get("execution", {})
    exec_cfg["_live_task_label"] = f"DIAGNOSTIC RERUN: {name}"
    try:
        exit_code, timed_out, log_result = stream_child(
            rerun_command, cwd, rerun_env, timeout, logger,
            capture_name=f"validation_{command_index:02d}_{profile_name}_diagnostic_rerun_{name}",
            execution_cfg=exec_cfg,
        )
    finally:
        exec_cfg.pop("_live_task_label", None)
    result.update({
        "status": "PASS" if exit_code == 0 else "FAIL",
        "attempted": True,
        "reason": "diagnostic_only",
        "name": name,
        "command": redact_command(rerun_command),
        "cwd": ".",
        "timeout_seconds": timeout,
        "exit_code": exit_code,
        "timed_out": timed_out,
        "log": log_result,
    })
    logger.line(
        f"DIAGNOSTIC RERUN {result['status']}: evidence captured; primary validation result remains FAIL.",
        error=exit_code != 0,
    )
    return result


def run_validation_profiles(
    project_root: Path,
    policy: dict[str, Any],
    logger: ItemLogger,
) -> tuple[dict[str, Any], Optional[str]]:
    cfg = policy.get("validation", {})
    selected = list(cfg.get("selected_profiles", []))
    rerun_budget = int(cfg.get("diagnostic_rerun", {}).get("max_commands", 1))
    rerun_used = 0
    result: dict[str, Any] = {
        "selected_profiles": selected,
        "commands": [],
        "passed": 0,
        "failed": 0,
        "status": "NOT_RUN" if not selected else "PASS",
        "diagnostic_reruns_attempted": 0,
        "diagnostic_reruns_skipped": 0,
    }
    if not selected:
        logger.line("Validation: no profile selected.")
        return result, None
    logger.line()
    logger.line("================ VALIDATION PROFILES ================")
    command_index = 0
    for profile_name in selected:
        logger.line(f"Validation profile: {profile_name}")
        for spec in cfg["profiles"][profile_name]:
            command_index += 1
            cwd = (project_root / spec["cwd"]).resolve()
            try:
                cwd.relative_to(project_root.resolve())
            except ValueError as exc:
                raise RunnerError(f"Validation cwd escaped project root: {spec['cwd']}") from exc
            if not cwd.is_dir():
                raise RunnerError(f"Validation cwd does not exist: {spec['cwd']}")
            command = list(spec["command"])
            timeout = float(spec.get("timeout_seconds", 0))
            logger.line(f"VALIDATE: {spec['name']}")
            logger.line("$ " + " ".join(redact_command(command)))
            env = os.environ.copy()
            env["PYTHON_PATCH_VALIDATION_PROFILE"] = profile_name
            exec_cfg = policy.get("execution", {})
            exec_cfg["_live_task_label"] = f"VALIDATION {command_index}: {spec['name']}"
            try:
                exit_code, timed_out, log_result = stream_child(
                    command, cwd, env, timeout, logger,
                    capture_name=f"validation_{command_index:02d}_{profile_name}_{spec['name']}",
                    execution_cfg=exec_cfg,
                )
            finally:
                exec_cfg.pop("_live_task_label", None)
            command_result = {
                "profile": profile_name,
                "name": spec["name"],
                "command": redact_command(command),
                "cwd": relative_to(cwd, project_root),
                "timeout_seconds": timeout,
                "exit_code": exit_code,
                "timed_out": timed_out,
                "status": "PASS" if exit_code == 0 else "FAIL",
                "log": log_result,
            }
            result["commands"].append(command_result)
            if exit_code == 0:
                result["passed"] += 1
                logger.line(f"VALIDATION PASS: {spec['name']}")
                continue
            result["failed"] += 1
            result["status"] = "FAIL"
            rerun_spec = spec.get("diagnostic_rerun")
            if rerun_spec and rerun_used >= rerun_budget:
                rerun = {"status": "SKIPPED", "attempted": False, "reason": "global_budget_exhausted"}
            else:
                rerun = _run_diagnostic_rerun(
                    primary_command=command, primary_exit_code=exit_code, primary_timed_out=timed_out,
                    spec=rerun_spec, cwd=cwd, env=env, profile_name=profile_name,
                    command_index=command_index, logger=logger, policy=policy,
                )
            command_result["diagnostic_rerun"] = rerun
            if rerun.get("attempted"):
                rerun_used += 1
                result["diagnostic_reruns_attempted"] += 1
            elif rerun_spec:
                result["diagnostic_reruns_skipped"] += 1
            message = f"Validation failed: {profile_name} / {spec['name']} (exit {exit_code})"
            logger.line(message, error=True)
            if cfg.get("fail_on_error", True):
                return result, message
    return result, None

def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def preflight_compile(
    script: Path,
    logger: ItemLogger,
    *,
    diagnostics: Optional[list[dict[str, Any]]] = None,
    diagnostic_dir: Optional[Path] = None,
    display_path: str = "",
) -> tuple[bool, str]:
    """Compile source bytes without importing or writing .pyc, with actionable context."""
    try:
        source = script.read_bytes()
        compile(source, str(script), "exec", dont_inherit=True)
        return True, ""
    except SyntaxError as exc:
        diag, output = syntax_diagnostic(script, exc, display_path=display_path or str(script))
        if diagnostics is not None:
            diagnostics.append(dict(diag.__dict__))
        if diagnostic_dir is not None:
            diagnostic_dir.mkdir(parents=True, exist_ok=True)
            name = slug(display_path or script.name)[:120] + ".syntax.txt"
            (diagnostic_dir / name).write_text(output, encoding="utf-8")
        for line in output.rstrip().splitlines():
            logger.line(line, error=True)
        return False, output
    except Exception:
        output = traceback.format_exc()
        logger.line(output, error=True)
        if diagnostics is not None:
            diagnostics.append({
                "severity": "error", "kind": "python_preflight", "message": output.splitlines()[-1] if output else "compile failed",
                "file": display_path or str(script), "line": 0, "column": 0, "source": "preflight",
                "suggestion": "Verify that the patch script is readable UTF-8 Python source.", "evidence": output[:8000],
            })
        return False, output


def _execution_log_config(execution_cfg: dict[str, Any]) -> dict[str, Any]:
    mode = str(execution_cfg.get("console_mode", "smart")).strip().lower()
    if mode not in {"smart", "full", "quiet"}:
        raise RunnerError("execution.console_mode must be smart, full, or quiet")
    return {
        "console_mode": mode,
        "context_before": int(execution_cfg.get("important_context_before", 2)),
        "context_after": int(execution_cfg.get("important_context_after", 2)),
        "failure_tail_lines": int(execution_cfg.get("failure_tail_lines", 80)),
        "max_raw_bytes": int(execution_cfg.get("raw_command_log_max_bytes", 256 * 1024 * 1024)),
        "max_important_lines": int(execution_cfg.get("max_important_lines", 4000)),
        "redact_secret_values": bool(execution_cfg.get("redact_secret_values", True)),
        "max_line_chars": int(execution_cfg.get("max_line_chars", 20000)),
    }


def _process_group_members(pgid: int) -> list[int]:
    """Best-effort Linux process-group inventory used only for diagnostics."""
    proc = Path("/proc")
    if not proc.is_dir():
        return []
    members: list[int] = []
    for entry in proc.iterdir():
        if not entry.name.isdigit():
            continue
        try:
            data = (entry / "stat").read_text(encoding="utf-8", errors="replace")
            close = data.rfind(")")
            fields = data[close + 2:].split()
            if len(fields) > 2 and fields[0] != "Z" and int(fields[2]) == pgid:
                members.append(int(entry.name))
        except Exception:
            continue
    return sorted(members)


def stream_child(
    command: list[str],
    cwd: Path,
    env: dict[str, str],
    timeout: float,
    logger: ItemLogger,
    *,
    capture_name: str,
    execution_cfg: dict[str, Any],
) -> tuple[int, bool, dict[str, Any]]:
    log_cfg = _execution_log_config(execution_cfg)
    live = execution_cfg.get("_live_status")
    live_label = str(execution_cfg.get("_live_task_label", "") or "RUNNING COMMAND")
    if live is not None:
        try:
            live.start(live_label, "starting process")
        except Exception:
            live = None
    logs_dir = logger.log_path.parent / "logs"
    safe_name = slug(capture_name)[:150] or "command"
    capture = SmartLogCapture(
        command=command,
        raw_path=logs_dir / f"{safe_name}.raw.log",
        important_path=logs_dir / f"{safe_name}.important.log",
        emit=lambda line, is_error: logger.line(line, error=is_error),
        **log_cfg,
    )
    terminate_grace = max(0.1, float(execution_cfg.get("terminate_grace_seconds", 3.0)))
    kill_grace = max(0.1, float(execution_cfg.get("kill_grace_seconds", 1.0)))
    started_monotonic = time.monotonic()
    process = subprocess.Popen(
        command,
        cwd=cwd,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    process_group_id = process.pid
    initial_group_members = _process_group_members(process_group_id)
    chunks: queue.Queue[Optional[bytes]] = queue.Queue()
    termination_events: list[dict[str, Any]] = []

    def signal_group(sig: signal.Signals, reason: str) -> None:
        members = _process_group_members(process_group_id)
        try:
            os.killpg(process_group_id, sig)
            outcome = "sent"
        except ProcessLookupError:
            outcome = "already_exited"
        except Exception as exc:
            outcome = f"error:{exc}"
        termination_events.append({
            "signal": sig.name, "reason": reason, "outcome": outcome,
            "members_before_signal": members,
        })

    def reader() -> None:
        assert process.stdout is not None
        try:
            while True:
                data = process.stdout.read(65536)
                if not data:
                    break
                chunks.put(data)
        finally:
            chunks.put(None)

    thread = threading.Thread(target=reader, name="patch-output-reader", daemon=True)
    thread.start()
    deadline = None if timeout <= 0 else time.monotonic() + timeout
    reader_done = False
    timed_out = False
    orphan_term_at: Optional[float] = None
    try:
        while True:
            wait = 0.2
            if deadline is not None:
                remaining = deadline - time.monotonic()
                if remaining <= 0 and process.poll() is None:
                    timed_out = True
                    signal_group(signal.SIGTERM, "timeout_soft_terminate")
                    try:
                        process.wait(timeout=terminate_grace)
                    except subprocess.TimeoutExpired:
                        signal_group(signal.SIGKILL, "timeout_hard_kill")
                        try:
                            process.wait(timeout=kill_grace)
                        except subprocess.TimeoutExpired:
                            pass
                    break
                wait = min(wait, max(0.01, remaining))
            try:
                item = chunks.get(timeout=wait)
                if item is None:
                    reader_done = True
                else:
                    if live is not None:
                        live.clear()
                    capture.feed(item)
            except queue.Empty:
                pass
            if live is not None:
                try:
                    live.update(f"process alive | output lines={capture.raw_lines}")
                except Exception:
                    pass
            if process.poll() is not None:
                if reader_done:
                    break
                now = time.monotonic()
                if orphan_term_at is None:
                    orphan_term_at = now
                    signal_group(signal.SIGTERM, "leader_exited_output_pipe_still_open")
                elif now - orphan_term_at > kill_grace:
                    signal_group(signal.SIGKILL, "orphan_hard_kill")
            if reader_done and process.poll() is not None:
                break
        while True:
            try:
                item = chunks.get_nowait()
            except queue.Empty:
                break
            if item:
                if live is not None:
                    live.clear()
                capture.feed(item)
    except KeyboardInterrupt:
        if live is not None:
            try:
                live.finish()
            except Exception:
                pass
        signal_group(signal.SIGTERM, "keyboard_interrupt")
        try:
            process.wait(timeout=terminate_grace)
        except subprocess.TimeoutExpired:
            signal_group(signal.SIGKILL, "keyboard_interrupt_hard_kill")
        raise
    finally:
        thread.join(timeout=terminate_grace)
    if timed_out:
        exit_code = 124
        logger.line(f"ERROR: command exceeded timeout of {timeout:g} seconds.", error=True)
    else:
        exit_code = process.wait()

    survivors = _process_group_members(process_group_id)
    if survivors:
        signal_group(signal.SIGKILL, "final_survivor_cleanup")
        time.sleep(min(kill_grace, 0.25))
    survivors_after_cleanup = _process_group_members(process_group_id)
    duration = round(time.monotonic() - started_monotonic, 3)
    log_result = capture.close(exit_code=exit_code, timed_out=timed_out)
    log_result.update({
        "duration_seconds": duration,
        "process_group_id": process_group_id,
        "initial_group_members": initial_group_members,
        "termination_events": termination_events,
        "survivors_before_final_cleanup": survivors,
        "survivors_after_cleanup": survivors_after_cleanup,
        "exit_signal": (-exit_code if exit_code < 0 else 0),
        "process_tree_status": "CLEAN" if not survivors_after_cleanup else "SURVIVORS_REMAIN",
    })
    for key in ("raw_log", "important_log"):
        try:
            log_result[key] = Path(log_result[key]).relative_to(logger.log_path.parent).as_posix()
        except Exception:
            pass
    if live is not None:
        try:
            live.finish()
        except Exception:
            pass
    logger.line(
        "LOG FILTER: "
        f"profile={log_result['profile']} raw_lines={log_result['raw_lines']} "
        f"important={log_result['important_lines']} noise_removed={log_result['suppressed_noise_lines']} "
        f"reduction={log_result['reduction_ratio']:.1%} duration={duration:.3f}s "
        f"process_tree={log_result['process_tree_status']}"
    )
    if survivors_after_cleanup:
        logger.line(
            f"WARNING: process-group survivors remain after cleanup: {survivors_after_cleanup}", error=True
        )
    return exit_code, timed_out, log_result

def _patch_environment(
    tools_dir: Path,
    extract_dir: Optional[Path],
    result_file: Path,
) -> dict[str, str]:
    env = os.environ.copy()
    pythonpath = [str(tools_dir)]
    if extract_dir:
        pythonpath.append(str(extract_dir))
    if env.get("PYTHONPATH"):
        pythonpath.append(env["PYTHONPATH"])
    env["PYTHONPATH"] = os.pathsep.join(pythonpath)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env["PYTHON_PATCH_PROJECT_TOOLS"] = str(tools_dir)
    env["PYTHON_PATCH_RESULT_FILE"] = str(result_file)
    return env


def run_patch_script(
    script: Path,
    display_name: str,
    extract_dir: Optional[Path],
    project_root: Path,
    tools_dir: Path,
    patch_cli_args: list[str],
    timeout: float,
    work_dir: Path,
    logger: ItemLogger,
    execution_cfg: dict[str, Any],
    diagnostics: list[dict[str, Any]],
) -> dict[str, Any]:
    logger.line()
    logger.line("============================================================")
    logger.line(f"Running: {display_name}")
    logger.line(f"Working directory: {project_root}")
    logger.line(f"Python: {sys.executable}")
    logger.line(f"Patch helper: {tools_dir / 'python_patch_utils.py'}")
    logger.line("============================================================")

    ok, _ = preflight_compile(
        script, logger, diagnostics=diagnostics,
        diagnostic_dir=work_dir / "diagnostics", display_path=display_name,
    )
    if not ok:
        logger.line(f"FAILED PREFLIGHT: {display_name} has invalid Python syntax.", error=True)
        return {"script": display_name, "status": "FAIL", "exit_code": 2, "preflight": "syntax_error"}

    result_stem = slug(display_name)[:100] + "_" + hashlib.sha256(display_name.encode("utf-8", "replace")).hexdigest()[:12]
    result_file = work_dir / (result_stem + ".helper_result.json")
    env = _patch_environment(tools_dir, extract_dir, result_file)
    command = [sys.executable, "-c", BOOTSTRAP, str(script), *patch_cli_args]
    live_phase = str(execution_cfg.get("_live_phase") or "PATCH PAYLOAD")
    execution_cfg["_live_task_label"] = f"{live_phase}: {Path(display_name).name}"
    try:
        exit_code, timed_out, log_result = stream_child(
            command, project_root, env, timeout, logger,
            capture_name=f"patch_{result_stem}", execution_cfg=execution_cfg,
        )
    finally:
        execution_cfg.pop("_live_task_label", None)
    helper_result: dict[str, Any] = {}
    if result_file.exists():
        try:
            helper_result = read_json(result_file, "helper result")
        except Exception as exc:
            helper_result = {"read_error": str(exc)}
    if exit_code == 0:
        logger.line(f"DONE: {display_name}")
        status = "PASS"
    else:
        if exit_code < 0:
            logger.line(f"FAILED: {display_name} terminated by signal {-exit_code}", error=True)
        else:
            logger.line(f"FAILED: {display_name} exited with code {exit_code}", error=True)
        status = "FAIL"
    return {
        "script": display_name,
        "payload_type": "python",
        "status": status,
        "exit_code": exit_code,
        "timed_out": timed_out,
        "helper_result": helper_result,
        "log": log_result,
    }


def validate_ops_payload(path: Path) -> dict[str, Any]:
    data = read_json(path, "patch operations")
    unsupported = sorted(set(data) - {"schema_version", "patch_name", "default_on_error", "ops"})
    if unsupported:
        raise RunnerError("Unsupported PATCH_TOOL_OPS.json fields: " + ", ".join(unsupported))
    if data.get("schema_version", 1) != 1:
        raise RunnerError("Unsupported PATCH_TOOL_OPS.json schema_version")
    ops = data.get("ops")
    if not isinstance(ops, list):
        raise RunnerError("PATCH_TOOL_OPS.json field ops must be a list")
    allowed_kinds = {
        "replace", "replace_any", "regex_replace", "insert_after", "insert_before",
        "append", "prepend", "write", "if", "first_success",
    }
    def walk(value: Any) -> None:
        if isinstance(value, dict):
            kind = value.get("kind")
            if kind is not None and str(kind) not in allowed_kinds:
                raise RunnerError(f"Unsupported data-only patch operation kind: {kind!r}")
            file_value = value.get("file")
            if file_value is not None:
                if not isinstance(file_value, str) or not file_value.strip():
                    raise RunnerError("Operation file must be a non-empty relative path")
                pure = PurePosixPath(file_value.replace("\\", "/"))
                if pure.is_absolute() or ".." in pure.parts:
                    raise RunnerError(f"Operation file escapes project root: {file_value}")
            for child in value.values():
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)
    walk(ops)
    return data


def run_ops_payload(
    ops_path: Path,
    display_name: str,
    extract_dir: Path,
    project_root: Path,
    tools_dir: Path,
    patch_cli_args: list[str],
    timeout: float,
    work_dir: Path,
    logger: ItemLogger,
    execution_cfg: dict[str, Any],
) -> dict[str, Any]:
    logger.line()
    logger.line("============================================================")
    logger.line(f"Running data-only patch: {display_name}")
    logger.line(f"Working directory: {project_root}")
    logger.line(f"Patch helper: {tools_dir / 'python_patch_utils.py'}")
    logger.line("============================================================")
    validate_ops_payload(ops_path)
    result_stem = slug(display_name)[:100] + "_" + hashlib.sha256(display_name.encode("utf-8", "replace")).hexdigest()[:12]
    result_file = work_dir / (result_stem + ".helper_result.json")
    env = _patch_environment(tools_dir, extract_dir, result_file)
    command = [sys.executable, "-c", OPS_BOOTSTRAP, str(ops_path), *patch_cli_args]
    live_phase = str(execution_cfg.get("_live_phase") or "PATCH OPS")
    execution_cfg["_live_task_label"] = f"{live_phase}: {Path(display_name).name}"
    try:
        exit_code, timed_out, log_result = stream_child(
            command, project_root, env, timeout, logger,
            capture_name=f"ops_{result_stem}", execution_cfg=execution_cfg,
        )
    finally:
        execution_cfg.pop("_live_task_label", None)
    helper_result: dict[str, Any] = {}
    if result_file.exists():
        try:
            helper_result = read_json(result_file, "helper result")
        except Exception as exc:
            helper_result = {"read_error": str(exc)}
    status = "PASS" if exit_code == 0 else "FAIL"
    logger.line(("DONE: " if status == "PASS" else "FAILED: ") + display_name, error=status == "FAIL")
    return {
        "script": display_name,
        "payload_type": "ops_json",
        "status": status,
        "exit_code": exit_code,
        "timed_out": timed_out,
        "helper_result": helper_result,
        "log": log_result,
    }

def allocate_path(path: Path) -> Path:
    if not path.exists():
        return path
    for index in range(2, 10000):
        candidate = path.with_name(f"{path.stem}.{index}{path.suffix}")
        if not candidate.exists():
            return candidate
    raise RunnerError(f"Cannot allocate output path near {path}")


def aggregate_log_stats(
    scripts: list[dict[str, Any]],
    validation: dict[str, Any],
    idempotency: Optional[dict[str, Any]] = None,
    post_commands: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    logs: list[dict[str, Any]] = []
    for script in scripts:
        if isinstance(script.get("log"), dict):
            logs.append(script["log"])
    for command in validation.get("commands", []) if isinstance(validation, dict) else []:
        if isinstance(command, dict) and isinstance(command.get("log"), dict):
            logs.append(command["log"])
        rerun = command.get("diagnostic_rerun", {}) if isinstance(command, dict) else {}
        if isinstance(rerun, dict) and isinstance(rerun.get("log"), dict):
            logs.append(rerun["log"])
    for command in post_commands.get("commands", []) if isinstance(post_commands, dict) else []:
        if isinstance(command, dict) and isinstance(command.get("log"), dict):
            logs.append(command["log"])
    for payload in idempotency.get("payloads", []) if isinstance(idempotency, dict) else []:
        if isinstance(payload, dict) and isinstance(payload.get("log"), dict):
            logs.append(payload["log"])
    raw_lines = sum(int(item.get("raw_lines", 0)) for item in logs)
    important_lines = sum(int(item.get("important_lines", 0)) for item in logs)
    removed = sum(int(item.get("suppressed_noise_lines", 0)) for item in logs)
    return {
        "commands": len(logs),
        "raw_lines": raw_lines,
        "important_lines": important_lines,
        "suppressed_noise_lines": removed,
        "reduction_ratio": round(0.0 if raw_lines == 0 else 1.0 - important_lines / raw_lines, 4),
        "raw_truncated_commands": sum(1 for item in logs if item.get("raw_truncated")),
        "raw_truncated": any(bool(item.get("raw_truncated")) for item in logs),
        "secret_redactions": sum(int(item.get("secret_redactions", 0)) for item in logs),
        "secret_redaction_types": {key: sum(int(item.get("secret_redaction_types", {}).get(key, 0)) for item in logs) for key in sorted({k for item in logs for k in item.get("secret_redaction_types", {})})},
        "truncated_long_lines": sum(int(item.get("truncated_long_lines", 0)) for item in logs),
        "profiles": sorted({str(item.get("profile", "generic")) for item in logs}),
        "duration_seconds": round(sum(float(item.get("duration_seconds", 0.0)) for item in logs), 3),
        "timed_out_commands": sum(1 for item in logs if item.get("timed_out")),
        "unclean_process_trees": sum(1 for item in logs if item.get("process_tree_status") == "SURVIVORS_REMAIN"),
        "termination_event_count": sum(len(item.get("termination_events", [])) for item in logs),
    }


def render_summary(summary: dict[str, Any]) -> str:
    patch = summary.get("patch", {})
    git = summary.get("git", {})
    stats = summary.get("aggregate_stats", {})
    validation = summary.get("validation", {})
    selected = validation.get("selected_profiles", [])
    validation_selection = summary.get("validation_selection", {})
    failure_delta = summary.get("failure_delta", {})
    diagnostics = summary.get("diagnostics_summary", {})
    log_stats = summary.get("log_filter", {})
    code_context = summary.get("code_context", {})
    root_causes = summary.get("root_causes", {})
    source_drift = summary.get("source_drift", {})
    transaction = summary.get("transaction", {})
    idempotency = summary.get("idempotency", {})
    post_commands = summary.get("post_patch_commands", {})
    payloads = sorted({str(item.get("payload_type", "python")) for item in summary.get("scripts", [])})
    lines = [
        "PATCH TOOL V5 SUMMARY",
        f"STATUS: {summary.get('status', 'UNKNOWN')}",
        f"MODE: {summary.get('mode', 'APPLY')}",
        f"TOOL_VERSION: {TOOL_VERSION}",
        f"PATCH_PACKAGE: {summary.get('input', '')}",
        f"PACKAGE_FORMAT: {summary.get('package_format', 'v5_or_unclassified')}",
        f"LEGACY_V4_COMPATIBILITY: {str(bool(summary.get('legacy_v4_compatibility', {}).get('enabled', False))).upper()}",
        f"PROJECT_SCOPE_VERIFIED: {str(bool(summary.get('legacy_v4_compatibility', {}).get('project_scope_verified', False))).upper()}",
        f"PROJECT_KEY: {summary.get('project_identity', {}).get('key', 'unspecified')}",
        "HISTORY_SCOPE: LOCAL_MACHINE_ONLY (not a patch-sequence constraint)",
        "PATH_POLICY: project-relative paths preferred",
        f"PATCH_VERSION: {patch.get('version', 'unspecified')}",
        f"PHASE: {patch.get('phase', 'unspecified')}",
        f"PHASE UNDER TEST: {patch.get('phase_under_test', 'unspecified')}",
        f"SUMMARY: {patch.get('summary', 'unspecified')}",
        f"REGRESSION_SCOPE: {patch.get('regression_scope', 'unspecified')}",
        f"PAYLOAD: {','.join(payloads) if payloads else 'none'}",
        f"SCRIPTS: pass={summary.get('scripts_passed', 0)} fail={summary.get('scripts_failed', 0)} total={len(summary.get('scripts', []))}",
        f"POST_COMMANDS: decision={post_commands.get('decision', 'NOT_EVALUATED')} status={post_commands.get('status', 'NOT_REQUESTED')} requested={post_commands.get('requested', 0)} executed={post_commands.get('executed', 0)} pass={post_commands.get('passed', 0)} fail={post_commands.get('failed', 0)} forced={str(bool(post_commands.get('forced', False))).upper()}",
        "FILES: " + " ".join(f"{key}={stats.get(key, 0)}" for key in ("patched", "created", "unchanged", "backups", "failed", "skipped", "ignored")),
        f"VALIDATION: profiles={','.join(selected) if selected else 'none'} pass={validation.get('passed', 0)} fail={validation.get('failed', 0)} status={validation.get('status', 'NOT_RUN')} diagnostic_reruns={validation.get('diagnostic_reruns_attempted', 0)}",
        f"VALIDATION_SELECTION: status={validation_selection.get('status', 'NOT_EVALUATED')} mode={validation_selection.get('mode', 'off')} auto={','.join(validation_selection.get('auto_profiles', [])) if validation_selection.get('auto_profiles') else 'none'} rules={len(validation_selection.get('matched_rules', []))}",
        f"FAILURE_DELTA: status={failure_delta.get('status', 'NOT_EVALUATED')} new={len(failure_delta.get('new_causes', []))} resolved={len(failure_delta.get('resolved_causes', []))} retained={len(failure_delta.get('retained_causes', []))}",
        f"DIAGNOSTICS: errors={diagnostics.get('errors', 0)} warnings={diagnostics.get('warnings', 0)} total={diagnostics.get('total', 0)}",
        f"ROOT_CAUSES: primary={root_causes.get('root_cause_count', 0)} secondary_suppressed={root_causes.get('secondary_or_suppressed_count', 0)}",
        f"SOURCE_DRIFT: status={source_drift.get('status', 'NOT_CHECKED')} checked={source_drift.get('checked', 0)} drifted={source_drift.get('drifted', 0)}",
        f"TRANSACTION: mode={transaction.get('mode', 'off')} status={transaction.get('status', 'NOT_REQUESTED')} delta={len(transaction.get('delta_paths', []))} applied={len(transaction.get('applied_paths', []))} rollback={transaction.get('rollback', 'NOT_NEEDED')}",
        f"IDEMPOTENCY: mode={idempotency.get('mode', 'off')} status={idempotency.get('status', 'SKIPPED')} additional_changes={len(idempotency.get('changed_paths', []))}",
        f"LOG_FILTER: commands={log_stats.get('commands', 0)} raw_lines={log_stats.get('raw_lines', 0)} important={log_stats.get('important_lines', 0)} reduction={float(log_stats.get('reduction_ratio', 0)):.1%} duration={float(log_stats.get('duration_seconds', 0)):.3f}s timeouts={log_stats.get('timed_out_commands', 0)} process_tree_warnings={log_stats.get('unclean_process_trees', 0)} secret_redactions={log_stats.get('secret_redactions', 0)} long_lines_truncated={log_stats.get('long_line_truncations', 0)} raw_truncated={str(bool(log_stats.get('raw_truncated', False))).upper()}",
        f"CODE_CONTEXT: included={code_context.get('included_count', 0)} symbols={code_context.get('symbol_count', 0)} candidates={code_context.get('candidate_count', 0)} bytes={code_context.get('included_bytes', 0)}",
        f"WORKTREE: touched={len(summary.get('worktree_touched_paths', []))}",
        f"GIT: add={git.get('requested', {}).get('add', 'off')} staged={len(git.get('staged_paths', []))} commit={git.get('commit_created', False)} push={git.get('pushed', False)}",
        f"REPORT_CREATED_AT: {summary.get('finished_at', '')}",
    ]
    if summary.get("error"):
        lines.append(f"ERROR: {summary['error']}")
    if summary.get("warnings"):
        lines.append("WARNINGS:")
        lines.extend(f"  - {item}" for item in summary["warnings"])
    return "\n".join(lines) + "\n"

def aggregate_helper_stats(scripts: list[dict[str, Any]]) -> dict[str, int]:
    keys = ("patched", "created", "unchanged", "backups", "failed", "skipped", "ignored")
    totals = {key: 0 for key in keys}
    for script in scripts:
        stats = script.get("helper_result", {}).get("stats", {})
        if not isinstance(stats, dict):
            continue
        for key in keys:
            try:
                totals[key] += int(stats.get(key, 0))
            except Exception:
                pass
    return totals


def prune_pass_reports(
    reports_dir: Path,
    reports_cfg: dict[str, Any],
    *,
    reserve_new_pass: bool,
    logger: ItemLogger,
) -> list[str]:
    retention = reports_cfg.get("retention", {})
    if not isinstance(retention, dict) or not retention.get("enabled", False):
        return []
    max_count = int(retention.get("max_pass_reports", 0))
    max_age_days = float(retention.get("max_pass_age_days", 0))
    if max_count < 0 or max_age_days < 0:
        raise RunnerError("Report retention limits cannot be negative")
    reports_dir.mkdir(parents=True, exist_ok=True)
    candidates = [
        path for path in reports_dir.glob("*.zip")
        if path.is_file() and re.search(r"(?:^|_)PASS(?:_|\.zip$)", path.name) and "FAIL" not in path.name
    ]
    candidates.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    delete: set[Path] = set()
    now = dt.datetime.now().timestamp()
    if max_age_days > 0:
        age_seconds = max_age_days * 86400
        delete.update(path for path in candidates if now - path.stat().st_mtime > age_seconds)
    remaining = [path for path in candidates if path not in delete]
    if max_count > 0:
        keep_existing = max(0, max_count - (1 if reserve_new_pass else 0))
        delete.update(remaining[keep_existing:])
    deleted: list[str] = []
    for path in sorted(delete, key=lambda item: item.name):
        try:
            path.unlink()
            deleted.append(path.name)
            logger.line(f"Report retention removed old PASS report: {path.name}")
        except OSError as exc:
            logger.line(f"WARNING: could not remove old PASS report {path.name}: {exc}", error=True)
    return deleted


def create_report_zip(report_dir: Path, reports_dir: Path, base: str, status: str) -> Path:
    reports_dir.mkdir(parents=True, exist_ok=True)
    final = allocate_path(reports_dir / f"{slug(base)}_{timestamp()}_{status}.zip")
    temp = final.with_suffix(final.suffix + ".tmp")
    with zipfile.ZipFile(temp, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for path in sorted(report_dir.rglob("*")):
            if path.is_file():
                zf.write(path, arcname=path.relative_to(report_dir).as_posix())
    os.replace(temp, final)
    return final


def copy_package_source(
    *,
    item: Path,
    extract_dir: Optional[Path],
    scripts_paths: list[Path],
    ops_path: Optional[Path],
    report_dir: Path,
) -> Path:
    destination = report_dir / "package_source"
    destination.mkdir(parents=True, exist_ok=True)
    if extract_dir:
        candidates: list[Path] = []
        for name in (MANIFEST_NAME, OPS_NAME):
            path = extract_dir / name
            if path.is_file():
                candidates.append(path)
        candidates.extend(scripts_paths)
        seen: set[str] = set()
        for source in candidates:
            try:
                rel = source.relative_to(extract_dir).as_posix()
            except Exception:
                rel = source.name
            if rel in seen or not source.is_file():
                continue
            seen.add(rel)
            target = destination / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
    elif item.is_file():
        shutil.copy2(item, destination / item.name)
    return destination


def collect_structured_diagnostics(
    *,
    report_dir: Path,
    scripts: list[dict[str, Any]],
    existing: list[dict[str, Any]],
    package_error: str,
) -> list[dict[str, Any]]:
    diagnostics: list[dict[str, Any]] = list(existing)
    seen = {
        (item.get("severity"), item.get("kind"), item.get("message"), item.get("file"), item.get("line"), item.get("column"))
        for item in diagnostics
    }
    for raw_path in sorted((report_dir / "logs").glob("*.raw.log")) if (report_dir / "logs").exists() else []:
        try:
            text = raw_path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        for diag in parse_diagnostics_from_text(text, source=raw_path.name):
            data = dict(diag.__dict__)
            key = (data.get("severity"), data.get("kind"), data.get("message"), data.get("file"), data.get("line"), data.get("column"))
            if key not in seen:
                diagnostics.append(data)
                seen.add(key)
    for script in scripts:
        helper = script.get("helper_result", {})
        if not isinstance(helper, dict):
            continue
        for failure in helper.get("failures", []) or []:
            if not isinstance(failure, dict):
                continue
            message = str(failure.get("message", "Patch operation failed"))
            data = {
                "severity": "error",
                "kind": "patch_anchor" if any(word in message.lower() for word in ("anchor", "expected", "locate", "found")) else "patch_operation",
                "message": message,
                "file": str(failure.get("file", "")),
                "line": 0,
                "column": 0,
                "source": str(script.get("script", "patch")),
                "suggestion": "Use CODE_CONTEXT ZIP to refresh the operation against current source; keep exact uniqueness checks whenever possible.",
                "evidence": str(failure.get("context", "") or failure.get("anchor", "") or failure.get("expected", ""))[:8000],
            }
            key = (data.get("severity"), data.get("kind"), data.get("message"), data.get("file"), 0, 0)
            if key not in seen:
                diagnostics.append(data)
                seen.add(key)
    if package_error:
        data = {
            "severity": "error", "kind": "package", "message": package_error,
            "file": "", "line": 0, "column": 0, "source": "runner",
            "suggestion": "Inspect the first structured diagnostic and important log before the final package error.",
            "evidence": package_error[:4000],
        }
        key = (data["severity"], data["kind"], data["message"], "", 0, 0)
        if key not in seen:
            diagnostics.append(data)
    return diagnostics[:300]


def aggregate_important_log(report_dir: Path) -> None:
    parts: list[str] = []
    runner_path = report_dir / "runner.log"
    if runner_path.exists():
        text = runner_path.read_text(encoding="utf-8", errors="replace")
        # The runner log is already compact in smart mode. Bound it for the summary bundle.
        if len(text.encode("utf-8")) > 1024 * 1024:
            encoded = text.encode("utf-8")
            text = encoded[:512 * 1024].decode("utf-8", "ignore") + "\n... [middle omitted] ...\n" + encoded[-512 * 1024:].decode("utf-8", "ignore")
        parts.append("===== RUNNER / COMPACT CONSOLE =====\n" + text.rstrip())
    logs_dir = report_dir / "logs"
    if logs_dir.exists():
        for path in sorted(logs_dir.glob("*.important.log")):
            parts.append(f"===== {path.name} =====\n" + path.read_text(encoding="utf-8", errors="replace").rstrip())
    (report_dir / "important_log.txt").write_text("\n\n".join(parts).rstrip() + "\n", encoding="utf-8")


def write_ai_readme(
    *, report_dir: Path, status: str, error: str, diagnostics_summary: dict[str, int],
    log_stats: dict[str, Any], code_context: dict[str, Any],
    root_causes: dict[str, Any], source_drift: dict[str, Any],
) -> None:
    roots=root_causes.get('root_causes',[]) if isinstance(root_causes,dict) else []
    primary=roots[0] if roots else {}
    code=primary.get('code','PTV-UNKNOWN-001'); message=primary.get('message',error or 'No primary error detected')
    location=str(primary.get('file',''))
    if primary.get('line'): location+=f":{primary['line']}"
    action=primary.get('suggestion','Inspect the compact evidence and update only the affected patch/code.')
    try:
        failure_delta=json.loads((report_dir/'failure_delta.json').read_text(encoding='utf-8'))
    except Exception:
        failure_delta={}
    try:
        validation_selection=json.loads((report_dir/'validation_selection.json').read_text(encoding='utf-8'))
    except Exception:
        validation_selection={}
    text=f"""# AI handoff generated by Python Patch Tool v{TOOL_VERSION}

Status: **{status}**
Primary root cause: `{code}` — {message}
Location: `{location or '<not detected>'}`
Source drift: **{source_drift.get('status','NOT_CHECKED')}**
Failure comparison: **{failure_delta.get('status','NOT_EVALUATED')}**
Validation impact selection: **{validation_selection.get('status','NOT_EVALUATED')}**
Structured diagnostics: {diagnostics_summary.get('errors',0)} error(s), {diagnostics_summary.get('warnings',0)} warning(s)
Root-cause compression: {root_causes.get('root_cause_count',0)} primary, {root_causes.get('secondary_or_suppressed_count',0)} secondary/duplicate suppressed
Console reduction: {float(log_stats.get('reduction_ratio',0)):.1%} ({log_stats.get('raw_lines',0)} raw lines → {log_stats.get('important_lines',0)} important lines)
Security redaction: {log_stats.get('secret_redactions',0)} value(s) redacted; raw logs in reports are redacted
Long-line control: {log_stats.get('long_line_truncations',0)} line(s) truncated; raw-log budget exceeded: {str(bool(log_stats.get('raw_truncated',False))).upper()}
Code context: {code_context.get('included_count',0)} file(s), {code_context.get('symbol_count',0)} symbol(s)

## Preferred send order

1. Send only `HANDOFF.zip` first. It combines compact diagnostics, relevant symbols/snippets, source drift, and the patch payload.
2. Send `DETAIL.zip` only when the AI explicitly needs raw logs or deeper evidence.
3. The separate `SUMMARY.zip` and `CODE.zip` remain for backward compatibility.

## Read first

1. `START_HERE.md`
2. `AI_SUMMARY/failure_delta.md`
3. `AI_SUMMARY/root_causes.md`
4. `AI_SUMMARY/diagnostic_quality.md`
5. `AI_SUMMARY/security_redaction.json`
6. `AI_SUMMARY/environment_fingerprint.md`
7. `AI_SUMMARY/validation_selection.md`
8. `AI_SUMMARY/multi_machine_context.md`
9. `NEXT_AI_ACTION.md`
10. `CODE_CONTEXT/` only for listed files/symbols

Local patch history is only a duplicate-suppression optimization. Do not infer missing phases or require history continuity across machines. Git/source is authoritative. Do not paste the full console. Raw logs remain in the detail bundle.
"""
    (report_dir/'AI_README.md').write_text(text,encoding='utf-8')
    start_here=f"""# START HERE

Patch Tool: v{TOOL_VERSION}
Status: {status}
Primary code: {code}
Primary issue: {message}
Location: {location or '<not detected>'}

Recommended action: {action}

Read `AI_SUMMARY/failure_delta.md`, `AI_SUMMARY/root_causes.md`, `AI_SUMMARY/diagnostic_quality.md`, `AI_SUMMARY/security_redaction.json`, `AI_SUMMARY/environment_fingerprint.md`, `AI_SUMMARY/multi_machine_context.md`, and `NEXT_AI_ACTION.md`, then inspect only the matching files under `CODE_CONTEXT/`. Do not require patch-history continuity across machines. Return one corrected Patch Tool ZIP with the same project key, relative paths, and strict uniqueness checks.
"""
    (report_dir/'START_HERE.md').write_text(start_here,encoding='utf-8')
    files=[]
    if primary.get('file'): files.append(str(primary['file']))
    for entry in source_drift.get('entries',[]) if isinstance(source_drift,dict) else []:
        if entry.get('drift') and entry.get('file') not in files: files.append(str(entry.get('file')))
    next_action=['# NEXT AI ACTION','',f'Primary diagnostic: `{code}`',f'Failure delta: `{failure_delta.get("status","NOT_EVALUATED")}`',f'Action: {action}','','## Files to inspect']
    next_action += [f'{i}. `{name}`' for i,name in enumerate(files[:10],1)] or ['1. Use the locations listed in `root_causes.md`.']
    next_action += ['','## Constraints','- Return one ZIP patch using the standard manifest.','- Update the source baseline hashes when the corrected patch is generated against current code.','- Do not weaken exact-match or uniqueness checks merely to force the patch to pass.','- Do not modify unrelated files or project validation policy.']
    (report_dir/'NEXT_AI_ACTION.md').write_text('\n'.join(next_action)+'\n',encoding='utf-8')
    (report_dir/'DETAIL_INDEX.md').write_text('# Detail bundle\n\nThe separate DETAIL ZIP contains complete raw command logs, runner logs, Git evidence, and machine-readable results. Send it only when compact evidence is insufficient.\n',encoding='utf-8')
    request=(f"Analyze this Patch Tool v{TOOL_VERSION} AI_HANDOFF ZIP. Start with START_HERE.md, AI_SUMMARY/failure_delta.md, AI_SUMMARY/root_causes.md, and AI_SUMMARY/diagnostic_quality.md. "
             "Use only the relevant CODE_CONTEXT symbols/snippets and PATCH_PAYLOAD. Return one corrected standard ZIP patch; do not request the full console unless DETAIL is actually required.\n")
    (report_dir/'AI_REQUEST_TEMPLATE.txt').write_text(request,encoding='utf-8')

def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def move_to_patched(item: Path, patched_dir: Path) -> Path:
    patched_dir.mkdir(parents=True, exist_ok=True)
    target = allocate_path(patched_dir / item.name)
    shutil.move(str(item), str(target))
    return target


def should_move(args: argparse.Namespace, item_rel: str) -> bool:
    if args.move_mode == "move":
        return True
    if args.move_mode == "keep":
        return False
    answer = input(f"Move successful input to patchs/patched: {item_rel}? [Y/n]: ").strip().lower()
    return answer in {"", "y", "yes"}


def helper_changed_paths(scripts: list[dict[str, Any]]) -> list[str]:
    paths: list[str] = []
    for script in scripts:
        helper = script.get("helper_result", {})
        values = helper.get("changed_files", []) if isinstance(helper, dict) else []
        if not isinstance(values, list):
            continue
        for value in values:
            if not isinstance(value, str) or not value.strip():
                continue
            normalized = value.replace("\\", "/")
            pure = PurePosixPath(normalized)
            if pure.is_absolute() or ".." in pure.parts:
                continue
            if normalized not in paths:
                paths.append(normalized)
    return paths


def run_idempotency_check(
    *,
    mode: str,
    ops_path: Optional[Path],
    scripts_paths: list[Path],
    extract_dir: Optional[Path],
    execution_root: Path,
    tools_dir: Path,
    patch_cli_args: list[str],
    timeout: float,
    report_dir: Path,
    logger: ItemLogger,
    execution_cfg: dict[str, Any],
    diagnostics: list[dict[str, Any]],
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "mode": mode, "status": "SKIPPED", "payloads": [], "changed_paths": [],
        "reason": "disabled" if mode == "off" else "not_applicable",
    }
    if mode == "off":
        return result
    if mode == "data_only" and not ops_path:
        result["reason"] = "python_payload_requires_idempotency=all"
        return result
    before = git_snapshot(execution_root)
    previous_live_phase = execution_cfg.get("_live_phase")
    execution_cfg["_live_phase"] = "IDEMPOTENCY"
    logger.line()
    logger.line("================ IDEMPOTENCY CHECK ================")
    logger.line("Re-running patch payload inside sandbox; validation and Git actions are not repeated.")
    payloads: list[dict[str, Any]] = []
    if ops_path:
        display = f"IDEMPOTENCY::{OPS_NAME}"
        payloads.append(run_ops_payload(
            ops_path, display, extract_dir or ops_path.parent, execution_root, tools_dir,
            patch_cli_args, timeout, report_dir, logger, execution_cfg,
        ))
    else:
        for script in scripts_paths:
            display = f"IDEMPOTENCY::{relative_to(script, extract_dir) if extract_dir else script.name}"
            payloads.append(run_patch_script(
                script, display, extract_dir, execution_root, tools_dir, patch_cli_args,
                timeout, report_dir, logger, execution_cfg, diagnostics,
            ))
            if payloads[-1].get("status") != "PASS":
                break
    after = git_snapshot(execution_root)
    changed = touched_paths(before, after)
    failed = [entry for entry in payloads if entry.get("status") != "PASS"]
    result.update({
        "payloads": payloads,
        "changed_paths": changed,
        "status": "PASS" if not failed and not changed else "FAIL",
        "reason": "no_additional_changes" if not failed and not changed else (
            "payload_failed_on_second_run" if failed else "second_run_changed_files"
        ),
    })
    logger.line(
        f"IDEMPOTENCY {result['status']}: payload_failures={len(failed)} additional_changed_paths={len(changed)}"
    , error=result["status"] != "PASS")
    if previous_live_phase is None:
        execution_cfg.pop("_live_phase", None)
    else:
        execution_cfg["_live_phase"] = previous_live_phase
    return result


def process_item(
    item: Path,
    project_root: Path,
    config: dict[str, Any],
    args: argparse.Namespace,
    patch_cli_args: list[str],
    package_info: Optional[dict[str, Any]] = None,
    project_identity: Optional[dict[str, Any]] = None,
) -> tuple[int, Optional[Path], Optional[Path]]:
    helper_dir = Path(os.environ.get("PYTHON_PATCH_LIBRARY_DIR", project_root / "tools" / "_patch_lib")).expanduser().resolve()
    patch_dir = project_root / "patchs"
    temp_root = patch_dir / ".patch_runner_tmp"
    reports_dir = patch_dir / "reports"
    patched_dir = patch_dir / "patched"
    temp_root.mkdir(parents=True, exist_ok=True)
    report_dir = Path(tempfile.mkdtemp(prefix="report.", dir=temp_root))
    handoff_zip: Optional[Path] = None
    extract_dir: Optional[Path] = None
    scripts_paths: list[Path] = []
    ops_path: Optional[Path] = None
    package_source_dir: Optional[Path] = None
    logger = ItemLogger(report_dir / "runner.log", int(config["execution"]["max_log_bytes"]))
    live_status = LiveStatus(config).bind_config(config)
    item_rel = relative_to(item, project_root)
    legacy_v4 = bool((package_info or {}).get("legacy_v4"))
    package_format = str((package_info or {}).get("package_format") or ("legacy_v4" if legacy_v4 else "v5_or_unclassified"))
    started = now_iso()
    initial_input_hash = sha256_file(item) if item.exists() and item.is_file() else ""
    scripts: list[dict[str, Any]] = []
    manifest: dict[str, Any] = {}
    inventory: list[str] = []
    warnings: list[str] = []
    structured_diagnostics: list[dict[str, Any]] = []
    git_result: dict[str, Any] = {}
    validation_result: dict[str, Any] = {
        "selected_profiles": [], "commands": [], "passed": 0, "failed": 0, "status": "NOT_RUN"
    }
    validation_selection_result: dict[str, Any] = {
        "mode": "off", "status": "NOT_EVALUATED", "changed_paths": [],
        "requested_profiles": [], "auto_profiles": [], "selected_profiles": [], "matched_rules": [],
    }
    failure_delta_result: dict[str, Any] = {
        "status": "NOT_EVALUATED", "new_causes": [], "resolved_causes": [], "retained_causes": [],
    }
    patch_changed_paths: list[str] = []
    error = ""
    status = "FAIL"
    mode = "PREFLIGHT_ONLY" if args.preflight_only else "APPLY"
    report_zip: Optional[Path] = None
    bundles: dict[str, Any] = {}
    moved_to = ""
    before_git: dict[str, Any] = {}
    after_patch_git: dict[str, Any] = {}
    after_validation_git: dict[str, Any] = {}
    final_git: dict[str, Any] = {}
    worktree_touched: list[str] = []
    retention_deleted: list[str] = []
    code_context_result: dict[str, Any] = {}
    source_drift_result: dict[str, Any] = {"status": "NOT_CHECKED", "checked": 0, "drifted": 0, "entries": [], "diagnostics": []}
    root_cause_result: dict[str, Any] = {"root_causes": [], "root_cause_count": 0, "secondary_or_suppressed_count": 0}
    policy = copy.deepcopy(config)
    transaction: Optional[SandboxTransaction] = None
    transaction_result: dict[str, Any] = {"mode": "off", "status": "NOT_REQUESTED", "delta_paths": [], "applied_paths": []}
    idempotency_result: dict[str, Any] = {"mode": "off", "status": "SKIPPED", "changed_paths": [], "payloads": []}
    post_command_result: dict[str, Any] = {
        "status": "NOT_REQUESTED", "decision": "NOT_EVALUATED", "requested": 0,
        "executed": 0, "passed": 0, "failed": 0, "commands": [], "forced": False,
    }
    idempotency_checked_before_commands = False
    execution_root = project_root
    execution_before_git: dict[str, Any] = {}
    execution_after_patch_git: dict[str, Any] = {}
    execution_after_validation_git: dict[str, Any] = {}

    try:
        logger.line("Python Patch Tool v5 supervised package run")
        logger.line(f"Tool version : {TOOL_VERSION}")
        logger.line(f"Mode         : {mode}")
        logger.line("Project root : .")
        logger.line(f"Input        : {item_rel}")
        logger.line(f"Package format: {package_format}")
        if legacy_v4:
            logger.line("Compatibility: Patch Tool v4 manifestless package; project scope is not cryptographically/manifest verified.")
        logger.line(f"Started      : {started}")
        before_git = git_snapshot(project_root)

        kind = archive_kind(item)
        require_zip = bool(config["package_policy"].get("require_zip", False)) if args.require_zip is None else bool(args.require_zip)
        if require_zip and kind != "zip" and not legacy_v4:
            raise RunnerError("This project requires patch delivery as a .zip package.")
        if require_zip and kind != "zip" and legacy_v4:
            warnings.append(
                "Legacy Patch Tool v4 standalone/tar input bypassed the v5 ZIP-only delivery rule for compatibility."
            )
        if not kind:
            if config["package_policy"].get("warn_standalone", True):
                warnings.append("Standalone .py patch accepted for backward compatibility; standard v5 delivery is ZIP.")
            scripts_paths = [item]
        else:
            extract_dir = report_dir / "extracted"
            logger.line(f"Extracting {kind} package safely...")
            inventory = extract_archive_safely(item, extract_dir, config)
            manifest, manifest_path = load_manifest(extract_dir)
            if project_identity and project_identity.get("key") and not legacy_v4:
                manifest_project = manifest.get("project", {}) if isinstance(manifest.get("project", {}), dict) else {}
                manifest_key = str(manifest_project.get("key", "")).strip().lower()
                if manifest_key != project_identity.get("key"):
                    raise RunnerError(
                        f"PTV-PROJECT-IDENTITY-001: patch project {manifest_key!r} does not match local project {project_identity.get('key')!r}"
                    )
            if manifest_path:
                shutil.copy2(manifest_path, report_dir / "manifest.json")
            scripts_paths = collect_patch_scripts(extract_dir)
            candidate_ops = extract_dir / OPS_NAME
            ops_path = candidate_ops if candidate_ops.is_file() else None
            if scripts_paths and ops_path:
                raise RunnerError(f"Package must use either Python scripts or {OPS_NAME}, not both.")

        policy = effective_policy(config, manifest, args)
        policy.setdefault("execution", {})["_live_status"] = live_status
        command_request = policy.get("post_patch_request", {"commands": []})
        if not scripts_paths and not ops_path and not command_request.get("commands"):
            raise RunnerError(
                f"No patch payload or safe command-only request found. Add patch_*.py, {OPS_NAME}, or manifest post_patch.commands."
            )
        allow_legacy_v4 = bool(policy["package_policy"].get("allow_legacy_v4", True))
        if legacy_v4 and not allow_legacy_v4:
            raise RunnerError("PTV-LEGACY-V4-001: legacy Patch Tool v4 inputs are disabled by project policy")
        if bool(policy["package_policy"].get("require_manifest", False)) and not manifest and not legacy_v4:
            raise RunnerError(f"Package is missing required {MANIFEST_NAME}.")
        if not manifest:
            if legacy_v4:
                warnings.append(
                    "Legacy Patch Tool v4 package accepted without manifest/project.key. "
                    "Selection is user confirmation; current Git/source state is authoritative."
                )
            else:
                warnings.append(f"Package has no {MANIFEST_NAME}; summary metadata and per-package Git policy are unavailable.")
        validate_manifest_standard(
            manifest,
            bool(policy["package_policy"].get("require_standard_metadata", False)) and not legacy_v4,
        )
        identity_cfg = normalize_identity_config(policy)
        if identity_cfg["enabled"] and identity_cfg["require_patch_key"] and not legacy_v4:
            manifest_project = manifest.get("project", {}) if isinstance(manifest.get("project", {}), dict) else {}
            if not str(manifest_project.get("key", "")).strip():
                raise RunnerError("PTV-PROJECT-IDENTITY-002: patch manifest is missing required project.key")
        validation_result["selected_profiles"] = list(policy.get("validation", {}).get("selected_profiles", []))
        validation_selection_result = select_validation_profiles(policy.get("validation", {}), [])
        if args.preflight_only and validation_selection_result.get("mode") != "off":
            validation_selection_result["status"] = "DEFERRED_UNTIL_PATCH_DELTA"
        write_validation_selection(report_dir, validation_selection_result)
        source_drift_result = analyze_source_drift(
            project_root=project_root, baseline=manifest.get("source_baseline", {}),
            output_dir=report_dir, policy=policy.get("source_drift", {}),
        )
        structured_diagnostics.extend(source_drift_result.get("diagnostics", []))
        logger.line(
            f"Source drift: status={source_drift_result.get('status')} checked={source_drift_result.get('checked', 0)} "
            f"drifted={source_drift_result.get('drifted', 0)}"
        )
        if source_drift_result.get("blocking"):
            raise RunnerError("PTV-SOURCE-DRIFT-001: patch baseline no longer matches current source; regenerate the patch before execution")

        logger.line("Patch payloads:")
        if ops_path:
            logger.line(f"   1) {OPS_NAME} [data-only operation DSL]")
        elif scripts_paths:
            for index, script in enumerate(scripts_paths, 1):
                display = relative_to(script, extract_dir) if extract_dir else item_rel
                logger.line(f"  {index:2d}) {display} [Python]")
        else:
            logger.line("   -) command-only package [no source payload]")
        if command_request.get("commands"):
            logger.line(f"Post-patch commands requested: {len(command_request['commands'])}")

        if args.preflight_only:
            if any(policy["git"][key] != "off" for key in ("add", "commit", "push")):
                warnings.append("Git actions were suppressed by preflight-only mode.")
            if args.move_mode == "move":
                warnings.append("Moving the input was suppressed by preflight-only mode.")
            if ops_path:
                validate_ops_payload(ops_path)
                scripts.append({
                    "script": f"{item_rel}::{OPS_NAME}", "payload_type": "ops_json",
                    "status": "PASS", "exit_code": 0, "preflight": "ops_schema_ok",
                })
            else:
                for script in scripts_paths:
                    display = f"{item_rel}::{relative_to(script, extract_dir)}" if extract_dir else item_rel
                    ok, _ = preflight_compile(
                        script, logger, diagnostics=structured_diagnostics,
                        diagnostic_dir=report_dir / "diagnostics", display_path=display,
                    )
                    result = {
                        "script": display, "payload_type": "python",
                        "status": "PASS" if ok else "FAIL",
                        "exit_code": 0 if ok else 2,
                        "preflight": "syntax_ok" if ok else "syntax_error",
                    }
                    scripts.append(result)
                    if not ok:
                        raise RunnerError(f"Preflight syntax validation failed: {display}")
            # Validate command shape and policy. Script existence may depend on patch-created files,
            # so final path validation remains deferred until APPLY inside the sandbox.
            post_command_result.update({
                "status": "PREFLIGHT_VALIDATED" if command_request.get("commands") else "NOT_REQUESTED",
                "decision": "DEFERRED_UNTIL_PATCH_DELTA" if command_request.get("commands") else "NOT_REQUESTED",
                "requested": len(command_request.get("commands", [])),
                "executed": 0,
            })
            logger.line("PREFLIGHT PASS: archive, manifest, policy, payload syntax/schema, and command declarations are valid; no patch code or command was executed.")
            status = "PASS"
        else:
            timeout = float(policy["execution"].get("timeout_seconds", 0))
            transaction_cfg = policy.get("transaction", {})
            transaction_mode = str(transaction_cfg.get("mode", "auto"))
            if transaction_mode != "off":
                try:
                    live_status.start("SANDBOX: preparing isolated worktree", "git worktree + dirty/config overlay")
                    transaction = SandboxTransaction(
                        real_root=project_root,
                        temp_root=temp_root,
                        report_dir=report_dir,
                        config=transaction_cfg,
                        log=lambda text, is_error=False: (live_status.clear(), logger.line(text, error=is_error)),
                        status=lambda text: live_status.update(text),
                    )
                    execution_root = transaction.start()
                    live_status.finish()
                    transaction_result = transaction.result
                except Exception as transaction_exc:
                    live_status.finish()
                    if transaction_mode == "required":
                        raise RunnerError(f"PTV-TRANSACTION-SETUP-001: {transaction_exc}") from transaction_exc
                    warnings.append(f"Transactional sandbox unavailable; using guarded in-place compatibility mode: {transaction_exc}")
                    logger.line(f"WARNING: transaction fallback to real worktree: {transaction_exc}", error=True)
                    transaction = None
                    execution_root = project_root
                    transaction_result = {
                        "mode": "in_place_fallback", "status": "FALLBACK_IN_PLACE",
                        "warning": str(transaction_exc), "delta_paths": [], "applied_paths": [],
                    }

            execution_before_git = git_snapshot(execution_root)
            if ops_path:
                display = f"{item_rel}::{OPS_NAME}"
                result = run_ops_payload(
                    ops_path, display, extract_dir or ops_path.parent, execution_root, helper_dir,
                    patch_cli_args, timeout, report_dir, logger, policy.get("execution", {}),
                )
                scripts.append(result)
                if result["status"] != "PASS":
                    if transaction:
                        transaction.mark_discarded("PATCH_FAILED_SANDBOX_DISCARDED")
                    raise RunnerError(f"Stopping package after failed data-only patch: {display}")
            elif scripts_paths:
                for script in scripts_paths:
                    display = f"{item_rel}::{relative_to(script, extract_dir)}" if extract_dir else item_rel
                    script_result = run_patch_script(
                        script, display, extract_dir, execution_root, helper_dir,
                        patch_cli_args, timeout, report_dir, logger,
                        policy.get("execution", {}), structured_diagnostics,
                    )
                    scripts.append(script_result)
                    if script_result["status"] != "PASS":
                        if transaction:
                            transaction.mark_discarded("PATCH_FAILED_SANDBOX_DISCARDED")
                        raise RunnerError(f"Stopping package after failed patch: {display}")

            execution_after_patch_git = git_snapshot(execution_root)
            excluded = policy.get("git", {}).get("exclude_paths", [])
            patch_changed_paths = [
                path for path in touched_paths(execution_before_git, execution_after_patch_git)
                if not is_excluded(path, excluded, item_rel)
            ]
            for helper_path in helper_changed_paths(scripts):
                if not is_excluded(helper_path, excluded, item_rel) and helper_path not in patch_changed_paths:
                    patch_changed_paths.append(helper_path)
            patch_changed_paths.sort()

            command_request = policy.get("post_patch_request", {"commands": []})
            # When post commands exist, check patch-payload idempotency before command side effects.
            # Post commands are intentionally not replayed: command-only packages and project scripts
            # may represent one-time operations. Their resulting delta is still validated/applied transactionally.
            if transaction and command_request.get("commands"):
                idempotency_result = run_idempotency_check(
                    mode=str(transaction_cfg.get("idempotency", "data_only")),
                    ops_path=ops_path, scripts_paths=scripts_paths, extract_dir=extract_dir,
                    execution_root=execution_root, tools_dir=helper_dir,
                    patch_cli_args=patch_cli_args, timeout=timeout, report_dir=report_dir,
                    logger=logger, execution_cfg=policy.get("execution", {}),
                    diagnostics=structured_diagnostics,
                )
                idempotency_checked_before_commands = True
                if idempotency_result.get("status") == "FAIL":
                    transaction.mark_discarded("IDEMPOTENCY_FAILED_SANDBOX_DISCARDED")
                    raise RunnerError(
                        "PTV-IDEMPOTENCY-001: second patch run failed or produced additional file changes"
                    )

            try:
                command_decision = decide_post_command_run(
                    has_payload=bool(ops_path or scripts_paths),
                    changed_paths=patch_changed_paths,
                    request=command_request,
                    policy=policy.get("post_patch", {}),
                )
            except CommandPolicyError as exc:
                if transaction:
                    transaction.mark_discarded("POST_COMMAND_POLICY_FAILED_SANDBOX_DISCARDED")
                raise RunnerError(f"PTV-POST-COMMAND-POLICY-001: {exc}") from exc
            post_command_result.update({
                "decision": command_decision.get("status", "UNKNOWN"),
                "decision_reason": command_decision.get("reason", ""),
                "forced": bool(command_decision.get("forced", False)),
                "requested": len(command_request.get("commands", [])),
            })
            logger.line(
                "Post-patch command gate: "
                f"decision={post_command_result['decision']} payload={bool(ops_path or scripts_paths)} "
                f"patch_changed={len(patch_changed_paths)} requested={post_command_result['requested']}"
            )
            if command_decision.get("run"):
                command_env = os.environ.copy()
                command_env["PYTHONDONTWRITEBYTECODE"] = "1"
                command_env["PYTHON_PATCH_PROJECT_ROOT"] = str(execution_root)
                try:
                    executed = run_post_commands(
                        execution_root=execution_root, request=command_request, policy=policy.get("post_patch", {}),
                        execution_cfg=policy.get("execution", {}), logger=logger, stream_child=stream_child,
                        env=command_env, redact_command=redact_command,
                    )
                except CommandPolicyError as exc:
                    if transaction:
                        transaction.mark_discarded("POST_COMMAND_POLICY_FAILED_SANDBOX_DISCARDED")
                    raise RunnerError(f"PTV-POST-COMMAND-POLICY-001: {exc}") from exc
                post_command_result.update(executed)
                post_command_result["decision"] = command_decision.get("status", "RUN")
                post_command_result["decision_reason"] = command_decision.get("reason", "")
                post_command_result["forced"] = bool(command_decision.get("forced", False))
                if executed.get("status") == "FAIL":
                    if transaction:
                        transaction.mark_discarded("POST_COMMAND_FAILED_SANDBOX_DISCARDED")
                    raise RunnerError(executed.get("error") or "PTV-POST-COMMAND-EXEC-001: post-patch command failed")
                # Commands may create or modify files. Recompute the complete delta before validation.
                execution_after_patch_git = git_snapshot(execution_root)
                patch_changed_paths = [
                    path for path in touched_paths(execution_before_git, execution_after_patch_git)
                    if not is_excluded(path, excluded, item_rel)
                ]
                for helper_path in helper_changed_paths(scripts):
                    if not is_excluded(helper_path, excluded, item_rel) and helper_path not in patch_changed_paths:
                        patch_changed_paths.append(helper_path)
                patch_changed_paths.sort()
            else:
                post_command_result["status"] = command_decision.get("status", "NOT_REQUESTED")
                post_command_result["executed"] = 0
                post_command_result["passed"] = 0
                post_command_result["failed"] = 0

            validation_selection_result = select_validation_profiles(policy.get("validation", {}), patch_changed_paths)
            policy["validation"]["selected_profiles"] = list(validation_selection_result.get("selected_profiles", []))
            validation_result["selected_profiles"] = list(policy["validation"]["selected_profiles"])
            write_validation_selection(report_dir, validation_selection_result)
            logger.line(
                "Validation impact selection: "
                f"status={validation_selection_result.get('status')} "
                f"changed={len(patch_changed_paths)} "
                f"auto={','.join(validation_selection_result.get('auto_profiles', [])) or 'none'} "
                f"final={','.join(validation_selection_result.get('selected_profiles', [])) or 'none'}"
            )
            validation_result, validation_error = run_validation_profiles(execution_root, policy, logger)
            execution_after_validation_git = git_snapshot(execution_root)
            excluded = policy.get("git", {}).get("exclude_paths", [])
            worktree_touched = [
                path for path in touched_paths(execution_before_git, execution_after_validation_git)
                if not is_excluded(path, excluded, item_rel)
            ]
            for helper_path in helper_changed_paths(scripts):
                if not is_excluded(helper_path, excluded, item_rel) and helper_path not in worktree_touched:
                    worktree_touched.append(helper_path)
            worktree_touched.sort()
            if validation_error:
                if transaction:
                    transaction.mark_discarded("VALIDATION_FAILED_SANDBOX_DISCARDED")
                raise RunnerError(validation_error)
            if validation_result.get("status") == "FAIL" and transaction:
                transaction.mark_discarded("VALIDATION_FAILED_SANDBOX_DISCARDED")
                raise RunnerError(
                    "PTV-TRANSACTION-VALIDATION-001: sandbox delta was not applied because validation did not pass"
                )

            if transaction:
                if not idempotency_checked_before_commands:
                    idempotency_result = run_idempotency_check(
                        mode=str(transaction_cfg.get("idempotency", "data_only")),
                        ops_path=ops_path, scripts_paths=scripts_paths, extract_dir=extract_dir,
                        execution_root=execution_root, tools_dir=helper_dir,
                        patch_cli_args=patch_cli_args, timeout=timeout, report_dir=report_dir,
                        logger=logger, execution_cfg=policy.get("execution", {}),
                        diagnostics=structured_diagnostics,
                    )
                    if idempotency_result.get("status") == "FAIL":
                        transaction.mark_discarded("IDEMPOTENCY_FAILED_SANDBOX_DISCARDED")
                        raise RunnerError(
                            "PTV-IDEMPOTENCY-001: second patch run failed or produced additional file changes"
                        )
                live_status.start("APPLY DELTA", f"verified paths={len(worktree_touched)}")
                transaction.apply_delta(worktree_touched)
                live_status.finish()
                transaction_result = transaction.result
                after_patch_git = git_snapshot(project_root)
                after_validation_git = after_patch_git
            else:
                after_patch_git = execution_after_patch_git
                after_validation_git = execution_after_validation_git

            if validation_result.get("status") == "FAIL":
                warnings.append(
                    "One or more validation commands failed in compatibility mode; Git actions were suppressed."
                )
                git_cfg = policy.get("git", {})
                git_result = {
                    "requested": {key: git_cfg.get(key, "off") for key in ("add", "commit", "push")},
                    "available": after_validation_git.get("available", False),
                    "touched_paths": worktree_touched,
                    "staged_paths": [], "commit_created": False, "pushed": False, "commands": [],
                    "warnings": ["Git suppressed because validation did not pass."],
                    "suppressed": True, "suppressed_reason": "validation_failed",
                }
                logger.line("Git workflow suppressed because validation did not pass.")
            else:
                live_status.start("GIT WORKFLOW", f"changed paths={len(worktree_touched)}")
                git_result, git_error = apply_git_workflow(
                    project_root, before_git, git_snapshot(project_root), worktree_touched,
                    policy, item_rel, logger,
                )
                live_status.finish()
                if git_error:
                    raise RunnerError(git_error)

            status = "PASS"
            if should_move(args, item_rel):
                destination = move_to_patched(item, patched_dir)
                moved_to = relative_to(destination, project_root)
                logger.line(f"Moved: {item_rel} -> {moved_to}")
            else:
                logger.line(f"Kept: {item_rel}")
    except KeyboardInterrupt:
        live_status.finish()
        error = "Interrupted by user"
        logger.line(f"ERROR: {error}", error=True)
    except BaseException as exc:
        live_status.finish()
        error = str(exc) or exc.__class__.__name__
        logger.line(f"ERROR: {error}", error=True)
        logger.line(traceback.format_exc(), error=True)
    finally:
        live_status.finish()
        # Preserve the exact patch payload before deleting extraction working files.
        try:
            package_source_dir = copy_package_source(
                item=item, extract_dir=extract_dir, scripts_paths=scripts_paths,
                ops_path=ops_path, report_dir=report_dir,
            )
        except Exception as source_exc:
            warnings.append(f"Could not preserve package source: {source_exc}")

        if mode == "APPLY":
            try:
                excluded = policy.get("git", {}).get("exclude_paths", [])
                if transaction and transaction.sandbox_root and transaction.sandbox_root.exists():
                    current_execution_git = git_snapshot(transaction.sandbox_root)
                    if execution_before_git.get("available") and current_execution_git.get("available"):
                        sandbox_delta = [
                            path for path in touched_paths(execution_before_git, current_execution_git)
                            if not is_excluded(path, excluded, item_rel)
                        ]
                        if sandbox_delta:
                            worktree_touched = sorted(set(worktree_touched) | set(sandbox_delta))
                        transaction.result["delta_paths"] = worktree_touched
                        transaction.preserve_delta(worktree_touched)
                    transaction_result = transaction.result
                elif before_git.get("available"):
                    if not after_patch_git:
                        after_patch_git = git_snapshot(project_root)
                    if not after_validation_git:
                        after_validation_git = git_snapshot(project_root)
                    worktree_touched = [
                        path for path in touched_paths(before_git, after_validation_git)
                        if not is_excluded(path, excluded, item_rel)
                    ]
            except Exception as snapshot_exc:
                warnings.append(f"Could not capture final worktree/transaction evidence: {snapshot_exc}")
        try:
            final_git = git_snapshot(project_root)
        except Exception as snapshot_exc:
            warnings.append(f"Could not capture final Git snapshot: {snapshot_exc}")

        try:
            structured_diagnostics = collect_structured_diagnostics(
                report_dir=report_dir, scripts=scripts, existing=structured_diagnostics,
                package_error=error,
            )
            write_diagnostics(report_dir, structured_diagnostics)
            ai_cfg_for_roots = policy.get("reports", {}).get("ai_handoff", {})
            root_cause_result = cluster_root_causes(
                structured_diagnostics, max_root_causes=int(ai_cfg_for_roots.get("max_root_causes", 8)) if isinstance(ai_cfg_for_roots, dict) else 8,
            )
            write_root_causes(report_dir, root_cause_result)
        except Exception as diagnostic_exc:
            warnings.append(f"Structured diagnostic collection failed: {diagnostic_exc}")

        helper_results = [
            script.get("helper_result", {}) for script in scripts
            if isinstance(script.get("helper_result", {}), dict)
        ]
        try:
            ai_cfg = policy.get("reports", {}).get("ai_handoff", {})
            if not isinstance(ai_cfg, dict):
                ai_cfg = {}
            context_project_root = (
                transaction.sandbox_root
                if transaction and transaction.sandbox_root and transaction.sandbox_root.exists()
                else project_root
            )
            code_context_result = collect_code_context(
                project_root=context_project_root,
                output_dir=report_dir / "code_context",
                diagnostics=structured_diagnostics,
                helper_results=helper_results,
                touched_paths=worktree_touched,
                package_source_dir=package_source_dir,
                limits=ai_cfg,
                source_drift=source_drift_result,
            )
        except Exception as context_exc:
            warnings.append(f"Code context collection failed: {context_exc}")
            code_context_result = {"error": str(context_exc), "included_count": 0, "candidate_count": 0, "included_bytes": 0}

        if transaction:
            try:
                keep_failed = status != "PASS" and bool(policy.get("transaction", {}).get("keep_failed_sandbox", False))
                transaction.cleanup(keep=keep_failed)
                transaction_result = transaction.result
                if keep_failed:
                    warnings.append(f"Failed transaction sandbox kept for inspection: {transaction_result.get('sandbox', '')}")
            except Exception as cleanup_exc:
                warnings.append(f"Could not clean transaction sandbox: {cleanup_exc}")
                transaction_result = transaction.result

        if extract_dir and extract_dir.exists():
            try:
                shutil.rmtree(extract_dir)
                logger.line("Removed extracted temporary files.")
            except Exception as cleanup_exc:
                warnings.append(f"Could not remove extracted temporary files: {cleanup_exc}")

        finished = now_iso()
        patch_meta = manifest.get("patch", {}) if isinstance(manifest.get("patch", {}), dict) else {}
        try:
            failure_delta_result = build_failure_delta(
                reports_dir=reports_dir, output_dir=report_dir,
                patch_key=str(patch_meta.get("id") or item.stem), status=status, mode=mode,
                root_causes=root_cause_result, validation=validation_result,
                error=error, finished_at=finished,
            )
        except Exception as history_exc:
            warnings.append(f"Failure history comparison failed: {history_exc}")
            failure_delta_result = {
                "status": "ERROR", "error": str(history_exc),
                "new_causes": [], "resolved_causes": [], "retained_causes": [],
            }
        git_result.setdefault("requested", {
            "add": policy.get("git", {}).get("add", "off"),
            "commit": policy.get("git", {}).get("commit", "off"),
            "push": policy.get("git", {}).get("push", "off"),
        })
        git_result.setdefault("staged_paths", [])
        git_result.setdefault("commit_created", False)
        git_result.setdefault("pushed", False)
        try:
            retention_deleted = prune_pass_reports(
                reports_dir, policy.get("reports", {}),
                reserve_new_pass=status == "PASS", logger=logger,
            )
        except Exception as retention_exc:
            warnings.append(f"Report retention failed: {retention_exc}")

        diagnostics_summary = {
            "total": len(structured_diagnostics),
            "errors": sum(1 for item in structured_diagnostics if item.get("severity") == "error"),
            "warnings": sum(1 for item in structured_diagnostics if item.get("severity") == "warning"),
        }
        log_stats = aggregate_log_stats(scripts, validation_result, idempotency_result, post_command_result)
        try:
            environment_fingerprint = collect_environment_fingerprint(project_root, report_dir)
        except Exception as env_exc:
            warnings.append(f"Environment fingerprint failed: {env_exc}")
            environment_fingerprint = {"status": "ERROR", "error": str(env_exc)}
        try:
            diagnostic_quality = write_diagnostic_quality(
                report_dir, diagnostics=structured_diagnostics, log_stats=log_stats, root_causes=root_cause_result,
            )
        except Exception as quality_exc:
            warnings.append(f"Diagnostic quality report failed: {quality_exc}")
            diagnostic_quality = {"status": "ERROR", "error": str(quality_exc)}
        security_redaction = {
            "schema_version": 1, "enabled": bool(policy.get("execution", {}).get("redact_secret_values", True)),
            "redacted_value_count": int(log_stats.get("secret_redactions", 0)),
            "redaction_types": log_stats.get("secret_redaction_types", {}),
            "raw_logs_are_redacted": bool(policy.get("execution", {}).get("redact_secret_values", True)),
            "sensitive_files_excluded_from_ai_bundles": True,
        }
        try:
            write_json(report_dir / "security_redaction.json", security_redaction)
        except Exception as security_exc:
            warnings.append(f"Security redaction report failed: {security_exc}")
        summary = {
            "schema_version": 5,
            "tool_version": TOOL_VERSION,
            "status": status,
            "mode": mode,
            "input": item_rel,
            "input_sha256": initial_input_hash,
            "canonical_patch_fingerprint": (package_info or {}).get("fingerprint", ""),
            "package_format": package_format,
            "legacy_v4_compatibility": {
                "enabled": legacy_v4,
                "source_format": "Patch Tool v4" if legacy_v4 else "Patch Tool v5",
                "manifest_present": bool(manifest),
                "project_scope_verified": bool((package_info or {}).get("project_scope_verified", False)),
                "history_is_not_sequence_constraint": True,
            },
            "project_identity": project_identity or {"enabled": False, "key": "", "local_only": True},
            "local_history_note": "Machine-local optimization only; Git/source is authoritative and no patch sequence is required.",
            "moved_to": moved_to,
            "started_at": started,
            "finished_at": finished,
            "patch": patch_meta,
            "scripts": scripts,
            "scripts_passed": sum(1 for script in scripts if script.get("status") == "PASS"),
            "scripts_failed": sum(1 for script in scripts if script.get("status") != "PASS"),
            "aggregate_stats": aggregate_helper_stats(scripts),
            "post_patch_commands": post_command_result,
            "validation": validation_result,
            "validation_selection": validation_selection_result,
            "failure_delta": failure_delta_result,
            "diagnostics_summary": diagnostics_summary,
            "root_causes": root_cause_result,
            "source_drift": source_drift_result,
            "transaction": transaction_result,
            "idempotency": idempotency_result,
            "log_filter": log_stats,
            "diagnostic_quality": diagnostic_quality,
            "environment_fingerprint": environment_fingerprint,
            "security_redaction": security_redaction,
            "code_context": code_context_result,
            "worktree_touched_paths": worktree_touched,
            "git": git_result,
            "git_before": {
                "available": before_git.get("available", False), "head": before_git.get("head", ""),
                "branch": before_git.get("branch", ""), "upstream": before_git.get("upstream", ""),
                "staged": before_git.get("staged", []), "dirty_path_count": len(before_git.get("status", {})),
            },
            "git_after_patch": {
                "available": after_patch_git.get("available", False), "head": after_patch_git.get("head", ""),
                "branch": after_patch_git.get("branch", ""), "upstream": after_patch_git.get("upstream", ""),
                "staged": after_patch_git.get("staged", []), "dirty_path_count": len(after_patch_git.get("status", {})),
            },
            "git_after_validation": {
                "available": after_validation_git.get("available", False), "head": after_validation_git.get("head", ""),
                "branch": after_validation_git.get("branch", ""), "upstream": after_validation_git.get("upstream", ""),
                "staged": after_validation_git.get("staged", []), "dirty_path_count": len(after_validation_git.get("status", {})),
            },
            "git_final": {
                "available": final_git.get("available", False), "head": final_git.get("head", ""),
                "branch": final_git.get("branch", ""), "upstream": final_git.get("upstream", ""),
                "staged": final_git.get("staged", []), "dirty_path_count": len(final_git.get("status", {})),
            },
            "report_retention_deleted": retention_deleted,
            "warnings": warnings,
            "error": error,
            "execution_timeout_seconds": policy.get("execution", {}).get("timeout_seconds", 0),
        }
        try:
            (report_dir / "package_inventory.txt").write_text("\n".join(inventory) + ("\n" if inventory else ""), encoding="utf-8")
            (report_dir / "worktree_touched_paths.txt").write_text("\n".join(worktree_touched) + ("\n" if worktree_touched else ""), encoding="utf-8")
            write_json(report_dir / "summary.json", summary)
            multi_machine_context = {
                "schema_version": 1,
                "project_key": (project_identity or {}).get("key", ""),
                "identity_file": (project_identity or {}).get("file", ""),
                "identity_scope": "LOCAL_MACHINE_ONLY",
                "history_scope": "LOCAL_MACHINE_ONLY",
                "history_is_not_sequence_constraint": True,
                "source_of_truth": "CURRENT_GIT_AND_SOURCE",
                "patch_history_sync_expected": False,
                "missing_history_is_error": False,
                "path_policy": "PROJECT_RELATIVE_PREFERRED",
                "ai_instruction": "Do not require prior patch history or continuous phase numbers across machines; inspect current Git/source and preserve project.key.",
            }
            write_json(report_dir / "multi_machine_context.json", multi_machine_context)
            (report_dir / "multi_machine_context.md").write_text(
                "# Multi-machine patch context\n\n"
                f"- Project key: `{multi_machine_context['project_key']}`\n"
                "- Identity/history scope: **local machine only**\n"
                "- Patch history continuity required: **NO**\n"
                "- Missing history is an error: **NO**\n"
                "- Source of truth: **current Git/source and patch preconditions**\n"
                "- Paths: **project-relative preferred**\n\n"
                "AI must not request patch history from another machine, infer missing phases from local history, or reject a patch solely because history is incomplete. Preserve the same `project.key`.\n",
                encoding="utf-8",
            )
            summary_text = render_summary(summary)
            (report_dir / "summary.txt").write_text(summary_text, encoding="utf-8")
            logger.line()
            for line in summary_text.rstrip().splitlines():
                logger.line(line)
            logger.close()
            aggregate_important_log(report_dir)
            write_ai_readme(
                report_dir=report_dir, status=status, error=error,
                diagnostics_summary=diagnostics_summary, log_stats=log_stats,
                code_context=code_context_result,
                root_causes=root_cause_result, source_drift=source_drift_result,
            )
            build_report_index(report_dir, extra={
                "status": status, "mode": mode, "input": item_rel,
                "recommended_send_order": ["AI_HANDOFF", "DETAIL"],
            })

            if bool(policy.get("reports", {}).get("enabled", True)):
                report_status = status if mode != "PREFLIGHT_ONLY" else f"PREFLIGHT_{status}"
                ai_cfg = policy.get("reports", {}).get("ai_handoff", {})
                ai_enabled = not isinstance(ai_cfg, dict) or bool(ai_cfg.get("enabled", True))
                if ai_enabled:
                    short_stamp = dt.datetime.now().strftime("%y%m%d_%H%M%S")
                    fingerprint_tag = (initial_input_hash or hashlib.sha256(item_rel.encode("utf-8")).hexdigest())[:6]
                    base = f"PTV_{short_stamp}_{fingerprint_tag}"
                    live_status.start("REPORT: building AI bundles", "HANDOFF + DETAIL")
                    bundles = create_ai_bundles(
                        report_dir=report_dir, reports_dir=reports_dir,
                        base_name=base, status=report_status, allocate=allocate_path,
                        config=ai_cfg if isinstance(ai_cfg, dict) else {},
                    )
                    live_status.finish()
                    report_zip = Path(bundles["detail"]["path"])
                    handoff_zip = Path(bundles["handoff"]["path"])
                    print_ai_handoff_guide(
                        bundles=bundles, project_root=project_root, config=config, report_zip=report_zip,
                    )
                else:
                    report_zip = create_report_zip(report_dir, reports_dir, item.stem, report_status)
                    print("PROJECT ROOT: " + str(project_root.resolve()))
                    print(f"REPORT ZIP: {_critical_console_path(report_zip, project_root, config)}")
            else:
                print("PROJECT ROOT: " + str(project_root.resolve()))
                print(f"REPORT DIRECTORY: {_critical_console_path(report_dir, project_root, config)}")
        except BaseException as report_exc:
            try:
                logger.line(f"CRITICAL: Could not create report ZIP: {report_exc}", error=True)
                logger.close()
            except Exception:
                pass
            print(f"CRITICAL: Could not create report ZIP: {report_exc}", file=sys.stderr)
            print(f"Fallback report directory: {report_dir}", file=sys.stderr)
            status = "FAIL"
            if bool(policy.get("reports", {}).get("enabled", True)) and report_dir.exists():
                try:
                    report_zip = create_report_zip(report_dir, reports_dir, item.stem, "REPORT_CREATION_FAIL")
                    print(f"FALLBACK REPORT ZIP: {_critical_console_path(report_zip, project_root, config)}", file=sys.stderr)
                except Exception as fallback_exc:
                    print(f"CRITICAL: fallback report ZIP also failed: {fallback_exc}", file=sys.stderr)
        finally:
            keep_dir = bool(policy.get("reports", {}).get("keep_work_directory", False))
            if report_zip and not keep_dir:
                shutil.rmtree(report_dir, ignore_errors=True)

    return (0 if status == "PASS" else 1), report_zip, handoff_zip

def resolve_selector(selector: str, items: list[Path], project_root: Path) -> Path:
    if selector.isdigit():
        index = int(selector) - 1
        if index < 0 or index >= len(items):
            raise RunnerError(f"Patch number out of range: {selector}")
        return items[index]
    matches = []
    for item in items:
        rel = relative_to(item, project_root)
        if selector in {str(item), rel, item.name}:
            matches.append(item)
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        raise RunnerError(f"Patch selector is ambiguous: {selector}")
    raise RunnerError(f"Patch not found: {selector}")


def print_items(items: list[Path], project_root: Path, *, mode: str = "full", max_items: int = 20) -> None:
    if mode == "off":
        return
    print(f"Patch queue: {len(items)} item(s)")
    visible = items if mode == "full" or max_items == 0 else items[:max_items]
    for index, item in enumerate(visible, 1):
        kind = archive_kind(item) or "python"
        print(f"  {index:2d}) {relative_to(item, project_root)}  [{kind}]")
    hidden = len(items) - len(visible)
    if hidden > 0:
        print(f"  ... {hidden} additional item(s) hidden; use --list for the full queue")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Select and run patch packages with crash isolation, reports, and controlled Git actions.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""Examples:
  ./tools/run_python_patches.sh
  ./tools/run_python_patches.sh --select
  ./tools/run_python_patches.sh --all --move
  ./tools/run_python_patches.sh --patch patch_feature_a.zip --patch patch_feature_b.zip
  ./tools/run_python_patches.sh --patch patch_feature.zip --git-add changed
  ./tools/run_python_patches.sh patch_feature.zip --git-add changed --git-commit-message "Complete feature X"
  ./tools/run_python_patches.sh --all --require-zip --require-manifest --require-standard-metadata
  ./tools/run_python_patches.sh patch_feature.zip --preflight-only
  ./tools/run_python_patches.sh patch_feature.zip --validation-profile quick
""",
    )
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument("-a", "--all", action="store_true", help="Run all patch inputs")
    selection.add_argument("-p", "--patch", dest="patch_options", action="append", help="Run one patch by number/name/path; may be repeated")
    selection.add_argument("-s", "--select", action="store_true", help="Open the interactive multi-select patch menu")
    selection.add_argument("-l", "--list", action="store_true", help="List inputs and exit")
    parser.add_argument("patch_positional", nargs="?", help="Positional alias for --patch")
    parser.add_argument("-y", "--yes", action="store_true", help="Run all by default, move successful inputs, and keep failed-file ZIPs")
    move = parser.add_mutually_exclusive_group()
    move.add_argument("--move", dest="move_mode", action="store_const", const="move")
    move.add_argument("--keep", "--no-move", dest="move_mode", action="store_const", const="keep")
    parser.set_defaults(move_mode="ask")

    parser.add_argument("--zip-failed", dest="zip_failed", action="store_const", const="--zip-failed")
    parser.add_argument("--no-zip-failed", dest="zip_failed", action="store_const", const="--no-zip-failed")
    parser.add_argument("--delete-failed-zip", dest="delete_failed_zip", action="store_const", const="--delete-failed-zip")
    parser.add_argument("--keep-failed-zip", dest="delete_failed_zip", action="store_const", const="--keep-failed-zip")

    package = parser.add_mutually_exclusive_group()
    package.add_argument("--require-zip", dest="require_zip", action="store_true")
    package.add_argument("--allow-standalone", dest="require_zip", action="store_false")
    manifest = parser.add_mutually_exclusive_group()
    manifest.add_argument("--require-manifest", dest="require_manifest", action="store_true")
    manifest.add_argument("--allow-missing-manifest", dest="require_manifest", action="store_false")
    metadata = parser.add_mutually_exclusive_group()
    metadata.add_argument("--require-standard-metadata", dest="require_standard_metadata", action="store_true")
    metadata.add_argument("--allow-incomplete-metadata", dest="require_standard_metadata", action="store_false")
    parser.set_defaults(require_zip=None, require_manifest=None, require_standard_metadata=None)

    parser.add_argument("--preflight-only", action="store_true", help="Validate archive, manifest, policy, and Python syntax without executing patch code")
    parser.add_argument("--validation-profile", dest="validation_profiles", action="append", help="Select a trusted project validation profile; may be repeated")
    parser.add_argument("--no-validation", action="store_true", help="Suppress all validation profiles for this run")
    validation_error = parser.add_mutually_exclusive_group()
    validation_error.add_argument("--validation-fail-closed", dest="validation_fail_on_error", action="store_true")
    validation_error.add_argument("--validation-fail-open", dest="validation_fail_on_error", action="store_false")
    parser.set_defaults(validation_profiles=None, validation_fail_on_error=None)

    git_add = parser.add_mutually_exclusive_group()
    git_add.add_argument("--git-add", choices=("changed", "all", "off"))
    git_add.add_argument("--no-git-add", dest="git_add", action="store_const", const="off")
    git_commit = parser.add_mutually_exclusive_group()
    git_commit.add_argument("--git-commit", dest="git_commit", action="store_const", const="auto")
    git_commit.add_argument("--no-git-commit", dest="git_commit", action="store_const", const="off")
    parser.add_argument("--git-commit-message")
    git_push = parser.add_mutually_exclusive_group()
    git_push.add_argument("--git-push", dest="git_push", action="store_const", const="auto")
    git_push.add_argument("--no-git-push", dest="git_push", action="store_const", const="off")
    parser.add_argument("--git-remote")
    parser.add_argument("--git-branch")
    git_error = parser.add_mutually_exclusive_group()
    git_error.add_argument("--git-fail-closed", dest="git_fail_on_error", action="store_true")
    git_error.add_argument("--git-fail-open", dest="git_fail_on_error", action="store_false")
    parser.set_defaults(git_fail_on_error=None)

    report = parser.add_mutually_exclusive_group()
    report.add_argument("--report-zip", dest="report_enabled", action="store_true")
    report.add_argument("--no-report-zip", dest="report_enabled", action="store_false")
    keep_report = parser.add_mutually_exclusive_group()
    keep_report.add_argument("--keep-report-dir", dest="keep_report_dir", action="store_true")
    keep_report.add_argument("--delete-report-dir", dest="keep_report_dir", action="store_false")
    parser.set_defaults(report_enabled=None, keep_report_dir=None)
    parser.add_argument("--console-mode", choices=("smart", "full", "quiet"), help="smart filters noise while preserving raw logs; full prints all; quiet prints runner status only")
    ai_handoff = parser.add_mutually_exclusive_group()
    ai_handoff.add_argument("--ai-handoff", dest="ai_handoff_enabled", action="store_true", help="Create summary/detail/code-context bundles")
    ai_handoff.add_argument("--no-ai-handoff", dest="ai_handoff_enabled", action="store_false", help="Create only the legacy report ZIP")
    parser.set_defaults(ai_handoff_enabled=None)
    parser.add_argument("--patch-timeout", type=float, help="Per-script timeout in seconds; 0 disables timeout")
    parser.add_argument("--transaction", dest="transaction_mode", choices=("off", "auto", "required"), help="Execute and validate in an isolated Git worktree before applying the verified delta")
    parser.add_argument("--idempotency", dest="idempotency_mode", choices=("off", "data_only", "all"), help="Re-run patch payload in the sandbox and require zero additional changes")
    sandbox_keep = parser.add_mutually_exclusive_group()
    sandbox_keep.add_argument("--keep-failed-sandbox", dest="keep_failed_sandbox", action="store_true")
    sandbox_keep.add_argument("--delete-failed-sandbox", dest="keep_failed_sandbox", action="store_false")
    parser.set_defaults(keep_failed_sandbox=None)
    parser.add_argument("--force-repeat", action="store_true", help="Run even if the same canonical patch already PASSed on this machine")
    parser.add_argument("--config", type=Path, help="Explicit JSON configuration path")
    args = parser.parse_args()
    args.zero_argument_requested = len(sys.argv) == 1
    return args


def emergency_report(project_root: Path, exc: BaseException) -> Optional[Path]:
    try:
        reports = project_root / "patchs" / "reports"
        reports.mkdir(parents=True, exist_ok=True)
        path = allocate_path(reports / f"runner_emergency_{timestamp()}_FAIL.zip")
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("summary.txt", f"PATCH TOOL V5 EMERGENCY REPORT\nSTATUS: FAIL\nERROR: {exc}\n")
            zf.writestr("traceback.txt", traceback.format_exc())
        return path
    except Exception:
        return None


def ensure_local_git_excludes(project_root: Path) -> None:
    """Keep machine-local identity/history out of Git without editing tracked .gitignore."""
    git_dir = project_root / ".git"
    if not git_dir.is_dir():
        return
    exclude = git_dir / "info" / "exclude"
    exclude.parent.mkdir(parents=True, exist_ok=True)
    existing = exclude.read_text(encoding="utf-8", errors="replace") if exclude.exists() else ""
    lines = set(existing.splitlines())
    required = [
        "/.python_patch_tool_project.json",
        "/patchs/reports/.patch_tool_local_history/",
        "/patchs/reports/.environment_fingerprint_cache.json",
        "/artifacts/.patch_tool_indexes/",
    ]
    missing = [value for value in required if value not in lines]
    if not missing:
        return
    with exclude.open("a", encoding="utf-8") as handle:
        if existing and not existing.endswith("\n"):
            handle.write("\n")
        handle.write("# Python Patch Tool machine-local identity/history\n")
        for value in missing:
            handle.write(value + "\n")


def acquire_runner_lock(patch_dir: Path):
    """Hold one advisory process lock for the whole runner invocation."""
    lock_path = patch_dir / ".patch_runner_tmp" / "runner.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    handle = lock_path.open("a+", encoding="utf-8")
    try:
        import fcntl

        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except ImportError:
        print("WARNING: advisory runner lock is unavailable on this platform.", file=sys.stderr)
        return handle
    except BlockingIOError as exc:
        handle.seek(0)
        holder = handle.read().strip()
        handle.close()
        suffix = f" (holder: {holder})" if holder else ""
        raise RunnerError(f"Another Python Patch Tool runner is active{suffix}") from exc
    handle.seek(0)
    handle.truncate()
    handle.write(f"pid={os.getpid()} started={now_iso()}\n")
    handle.flush()
    return handle


def write_last_run_summary(
    *, reports_dir: Path, project_root: Path, run_id: str, mode: str,
    selected: list[Path], results: list[dict[str, Any]], status: str,
    skipped: Optional[list[dict[str, Any]]] = None, project_identity: Optional[dict[str, Any]] = None,
) -> None:
    reports_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": 1,
        "tool_version": TOOL_VERSION,
        "run_id": run_id,
        "mode": mode,
        "status": status,
        "selected_count": len(selected),
        "processed_count": len(results),
        "remaining_count": max(0, len(selected) - len(results)),
        "finished_at": now_iso(),
        "results": results,
        "skipped": list(skipped or []),
        "skipped_count": len(skipped or []),
        "project_identity": project_identity or {},
        "history_scope": "LOCAL_MACHINE_ONLY",
        "history_is_not_sequence_constraint": True,
    }
    write_json(reports_dir / "last_run.json", payload)
    lines = [
        f"# Python Patch Tool v{TOOL_VERSION} last run", "",
        f"- Project root: `{project_root.resolve()}`",
        f"- Run ID: `{run_id}`",
        f"- Mode: **{mode}**",
        f"- Status: **{status}**",
        f"- Processed: {len(results)}/{len(selected)}",
        f"- Skipped before execution: {len(skipped or [])}",
        f"- Project key: `{(project_identity or {}).get('key', '')}`",
        "- History scope: **local optimization only; never a patch-sequence requirement**", "",
        "## Output file guide", "",
        "| Priority | File | Meaning | Normal action |",
        "|---|---|---|---|",
        "| **PRIMARY** | `*_HANDOFF.zip` | Compact all-in-one AI evidence and relevant code | **Upload this file first** |",
        "| Optional | `*_SUMMARY.zip` | Text summaries and diagnostics only | Usually not needed separately |",
        "| Optional | `*_CODE.zip` | Relevant source snippets, symbols and diffs | Send only when AI asks separately |",
        "| Debug only | `*_DETAIL.zip` | Full redacted raw logs and technical evidence | Send only when AI requests raw evidence |",
        "| Local info | `LAST_RUN.md` | Human-readable local run status | Do not upload unless requested |", "",
        "`REPORT ZIP` is normally the same physical file as `DETAIL.zip`; it is not an extra fifth ZIP.", "",
    ]
    for index, result in enumerate(results, 1):
        lines.append(f"{index}. `{result['input']}` — **{result['status']}**")
        if result.get("ai_handoff"):
            lines.append(f"   - Send to AI: `{result['ai_handoff']}`")
        if result.get("detail"):
            lines.append(f"   - Detail: `{result['detail']}`")
    if skipped:
        lines.append("## Skipped inputs")
        lines.append("")
        for entry in skipped:
            lines.append(f"- `{entry.get('input', '')}` — **{entry.get('category', 'skipped')}**: {entry.get('reason', '')}")
            if entry.get("moved_to"):
                lines.append(f"  - Moved to: `{entry['moved_to']}`")
    (reports_dir / "LAST_RUN.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    try:
        sys.stdout.reconfigure(line_buffering=True)
        sys.stderr.reconfigure(line_buffering=True)
    except Exception:
        pass
    args = parse_args()
    script_dir = Path(__file__).resolve().parent
    project_root = Path(os.environ.get("PYTHON_PATCH_PROJECT_ROOT", script_dir.parent.parent)).expanduser().resolve()
    os.environ.setdefault("PYTHON_PATCH_LIBRARY_DIR", str(script_dir))
    patch_dir = project_root / "patchs"
    ensure_local_git_excludes(project_root)
    lock_handle = acquire_runner_lock(patch_dir)
    config, loaded = load_config(project_root, args.config)
    zero_cfg = normalize_zero_argument_config(config)
    zero_mode = bool(args.zero_argument_requested and zero_cfg["enabled"])
    if zero_mode and zero_cfg.get("automatic_selection_unconfirmed"):
        print(
            "WARNING: legacy/unconfirmed automation.zero_argument.selection="
            f"{zero_cfg.get('configured_selection')!r} was changed to prompt for safety. "
            "Use --all or set non_interactive_confirmed=true to enable unattended selection.",
            file=sys.stderr,
        )
    queue_hygiene_mode = bool(zero_mode or args.select)
    raw_items = list_patch_items(patch_dir, natural_sort=zero_cfg["natural_sort"] if zero_mode else True)
    items, package_metadata, skipped_items, project_identity = prepare_patch_queue(
        project_root=project_root, raw_items=raw_items, config=config, force_repeat=bool(args.force_repeat),
        enforce_hygiene=queue_hygiene_mode,
    )

    if args.patch_options and args.patch_positional:
        raise RunnerError("Positional PATCH conflicts with --patch.")
    if args.all and args.patch_positional:
        raise RunnerError("Positional PATCH conflicts with --all.")
    if args.list and args.patch_positional:
        raise RunnerError("Positional PATCH conflicts with --list.")
    if args.select and args.patch_positional:
        raise RunnerError("Positional PATCH conflicts with --select.")

    if zero_mode:
        args.move_mode = "move" if zero_cfg["move_success"] else "keep"
        args.zip_failed = args.zip_failed or "--zip-failed"
        if zero_cfg["keep_failed_input"]:
            args.delete_failed_zip = args.delete_failed_zip or "--keep-failed-zip"
    elif args.select:
        if args.move_mode == "ask":
            args.move_mode = "move" if zero_cfg["move_success"] else "keep"
        args.zip_failed = args.zip_failed or "--zip-failed"
        if zero_cfg["keep_failed_input"]:
            args.delete_failed_zip = args.delete_failed_zip or "--keep-failed-zip"
    elif args.yes:
        if not args.all and not args.patch_options and not args.patch_positional and not args.list:
            args.all = True
        if args.move_mode == "ask":
            args.move_mode = "move"
        if args.zip_failed is None:
            args.zip_failed = "--zip-failed"
        if args.delete_failed_zip is None:
            args.delete_failed_zip = "--keep-failed-zip"

    patch_cli_args = [value for value in (args.zip_failed, args.delete_failed_zip) if value]
    print(f"Python patch runner mini-AI v5 ({TOOL_VERSION})")
    print(f"Run mode     : {'ZERO-ARGUMENT SELECTION' if zero_mode else 'CLI/INTERACTIVE'}")
    print("Project root : " + _paint(str(project_root.resolve()), config, "bold", "bright_blue"))
    print("Patch folder : " + str((project_root / "patchs").resolve()))
    print("Reports      : " + str((project_root / "patchs" / "reports").resolve()))
    print(f"Configuration: {', '.join(relative_to(Path(value), project_root) for value in loaded) if loaded else 'built-in safe defaults'}")
    print()

    if not items:
        idle_status = "IDLE_WITH_WARNINGS" if skipped_items else "IDLE"
        idle_style = ("bold", "blue") if idle_status == "IDLE" else ("bold", "bright_yellow")
        print("AUTO STATUS: " + _paint(idle_status, config, *idle_style) + " — no runnable patch package is waiting.")
        if skipped_items:
            print(f"QUEUE HYGIENE: skipped={len(skipped_items)}; see patchs/reports/LAST_RUN.md")
        if zero_mode and zero_cfg["write_last_run"]:
            write_last_run_summary(
                reports_dir=patch_dir / "reports", project_root=project_root,
                run_id=timestamp(), mode="ZERO_ARGUMENT", selected=[], results=[], status=idle_status,
                skipped=skipped_items, project_identity=project_identity,
            )
        return 0

    inventory_mode = zero_cfg["inventory_mode"] if zero_mode else "full"
    print_items(items, project_root, mode=inventory_mode, max_items=zero_cfg["max_inventory_items"])

    if args.list:
        return 0

    selection_mode = "prompt"
    if args.all:
        selection_mode = "all"
    elif args.patch_options or args.patch_positional:
        selection_mode = "explicit"
    elif args.select:
        selection_mode = "prompt"
    elif zero_mode:
        selection_mode = zero_cfg["selection"]

    if selection_mode == "all":
        selected = items
    elif selection_mode == "first":
        selected = items[:1]
    elif selection_mode == "newest":
        selected = [max(items, key=lambda path: path.stat().st_mtime)]
    elif selection_mode == "explicit":
        selectors = list(args.patch_options or [])
        if args.patch_positional:
            selectors.append(args.patch_positional)
        selected = []
        seen: set[str] = set()
        for selector in selectors:
            item = resolve_selector(selector, items, project_root)
            key = str(item.resolve())
            if key not in seen:
                seen.add(key)
                selected.append(item)
    else:
        selection_result = select_patch_items(
            items, project_root,
            initial_selection=zero_cfg["initial_selection"] if zero_mode else "none",
            force_line_mode=bool(zero_mode and zero_cfg["selector_ui"] == "line"),
            skipped_before=skipped_items,
        )
        deleted_entries = [
            {
                "input": path,
                "category": "user_deleted",
                "reason": "Permanently deleted by the user from the patch-selection menu before execution.",
                "moved_to": "",
            }
            for path in selection_result.deleted
        ]
        skipped_items.extend(deleted_entries)
        items = selection_result.remaining
        if selection_result.cancelled:
            print(_paint("CANCELLED: no patch was executed.", config, "bold", "cyan"))
            if zero_mode and zero_cfg["write_last_run"]:
                cancelled_entries = list(skipped_items) + [
                    {
                        "input": relative_to(path, project_root),
                        "category": "user_cancelled",
                        "reason": "Run cancelled before patch execution; package remains in patchs/.",
                        "moved_to": "",
                    }
                    for path in items
                ]
                write_last_run_summary(
                    reports_dir=patch_dir / "reports", project_root=project_root,
                    run_id=timestamp(), mode="ZERO_ARGUMENT_INTERACTIVE", selected=items, results=[], status="CANCELLED",
                    skipped=cancelled_entries, project_identity=project_identity,
                )
            return 0
        selected = selection_result.selected

    # On a new machine, adopt project identity from the first patch actually
    # selected for execution, never from an unrelated package merely present in
    # the queue. Then re-run zero-argument hygiene so foreign-project packages
    # are warning-only and removed from the runnable set.
    identity_cfg = normalize_identity_config(config)
    if selected and identity_cfg["enabled"] and not project_identity.get("exists") and identity_cfg["adopt_from_first_patch"]:
        # Legacy v4 packages carry no project.key. Adopt from the first selected
        # keyed v5 package, while still allowing earlier selected v4 inputs to
        # run as explicitly unscoped compatibility packages.
        identity_source = next(
            (
                path for path in selected
                if str(package_metadata.get(str(path.resolve()), {}).get("project_key") or "")
            ),
            None,
        )
        first_info = package_metadata.get(str(identity_source.resolve()), {}) if identity_source else {}
        first_key = str(first_info.get("project_key") or "")
        if first_key and identity_source is not None:
            try:
                adopted = adopt_project_identity(
                    project_root, first_key, source_patch=relative_to(identity_source, project_root),
                    configured=identity_cfg["identity_file"],
                )
            except IdentityError as exc:
                raise RunnerError(str(exc)) from exc
            print(f"PROJECT IDENTITY ADOPTED: {adopted['key']} from selected patch {relative_to(identity_source, project_root)}")
            if queue_hygiene_mode:
                filtered_items, filtered_metadata, identity_skipped, project_identity = prepare_patch_queue(
                    project_root=project_root, raw_items=items, config=config, force_repeat=bool(args.force_repeat),
                    enforce_hygiene=True,
                )
                allowed = {str(path.resolve()) for path in filtered_items}
                selected = [path for path in selected if str(path.resolve()) in allowed]
                items = filtered_items
                package_metadata = filtered_metadata
                skipped_items.extend(identity_skipped)
            else:
                project_identity = {
                    "enabled": True, "key": adopted.get("key", ""), "exists": True, "adopted": True,
                    "file": relative_to(adopted.get("path"), project_root) if adopted.get("path") else "",
                    "local_only": True,
                }

    queue_order = {str(path.resolve()): index for index, path in enumerate(items)}
    selected = sorted(selected, key=lambda path: queue_order.get(str(path.resolve()), len(queue_order)))

    if not selected:
        print("No selected patch remains runnable after project identity and queue policy checks.")
        if zero_mode and zero_cfg["write_last_run"]:
            write_last_run_summary(
                reports_dir=patch_dir / "reports", project_root=project_root, run_id=timestamp(),
                mode="ZERO_ARGUMENT_INTERACTIVE", selected=[], results=[], status="IDLE_WITH_WARNINGS",
                skipped=skipped_items, project_identity=project_identity,
            )
        return 0

    selected_keys = {str(path.resolve()) for path in selected}
    user_skipped = [
        {
            "input": relative_to(path, project_root),
            "category": "user_not_selected",
            "reason": "Not selected in this run; package remains in patchs/.",
            "moved_to": "",
        }
        for path in items if str(path.resolve()) not in selected_keys
    ]
    run_skipped_items = list(skipped_items) + user_skipped
    if zero_mode:
        print(f"RUN PLAN: selected={len(selected)} unselected={len(user_skipped)} move_success={zero_cfg['move_success']} stop_on_failure={zero_cfg['stop_on_failure']}")

    run_id = timestamp()
    run_results: list[dict[str, Any]] = []
    final_code = 0
    for item in selected:
        info = package_metadata.get(str(item.resolve()), {})
        code, detail_zip, handoff_zip = process_item(
            item, project_root, config, args, patch_cli_args,
            package_info=info, project_identity=project_identity,
        )
        result = {
            "input": relative_to(item, project_root),
            "status": "PASS" if code == 0 else "FAIL",
            "detail": relative_to(detail_zip, project_root) if detail_zip else "",
            "ai_handoff": relative_to(handoff_zip, project_root) if handoff_zip else "",
        }
        run_results.append(result)
        result_style = ("bold", "bright_green") if result["status"] == "PASS" else ("bold", "red")
        print("PATCH RESULT: " + _paint(f"[{result['status']}]", config, *result_style) + f" {item.name}")
        if code == 0 and info.get("fingerprint"):
            history_cfg = normalize_local_history_config(config)
            if history_cfg["enabled"]:
                try:
                    append_success_history(project_root, history_cfg["file"], {
                        "fingerprint": info.get("fingerprint", ""),
                        "project_key": info.get("project_key", ""),
                        "patch_id": info.get("patch_id", ""),
                        "version": info.get("version", ""),
                        "input": result["input"],
                        "moved_to": relative_to(project_root / "patchs" / "patched" / item.name, project_root) if not item.exists() else "",
                        "git_head": git_snapshot(project_root).get("head", ""),
                    })
                except Exception as history_exc:
                    print(f"WARNING: could not update local successful-patch history: {history_exc}", file=sys.stderr)
        if code != 0:
            final_code = code
            if zero_mode and zero_cfg["stop_on_failure"]:
                print(_paint("AUTO STOP: failed patch remains in patchs/ for the next corrected package/run.", config, "bold", "red"))
                break
            if not zero_mode:
                print("Stopping after failed patch file/package.")
                break

    if len(run_results) < len(selected):
        for path in selected[len(run_results):]:
            run_skipped_items.append({
                "input": relative_to(path, project_root),
                "category": "not_executed_after_failure",
                "reason": "Selected for this run but not executed because an earlier selected patch failed and stop_on_failure is enabled.",
                "moved_to": "",
            })
    run_status = "PASS" if final_code == 0 and len(run_results) == len(selected) else "FAIL"
    if zero_mode and zero_cfg["write_last_run"]:
        write_last_run_summary(
            reports_dir=patch_dir / "reports", project_root=project_root, run_id=run_id,
            mode="ZERO_ARGUMENT_INTERACTIVE" if zero_cfg["selection"] == "prompt" else "ZERO_ARGUMENT", selected=selected, results=run_results, status=run_status,
            skipped=run_skipped_items, project_identity=project_identity,
        )
    print()
    print("================ ZERO-ARGUMENT RUN SUMMARY ================" if zero_mode else "================ RUN SUMMARY ================")
    print("PROJECT ROOT: " + _paint(str(project_root.resolve()), config, "bold", "bright_blue"))
    status_style = ("bold", "bright_green") if run_status == "PASS" else ("bold", "red")
    print("STATUS: " + _paint(run_status, config, *status_style))
    print(f"PROCESSED: {len(run_results)}/{len(selected)}")
    print("SKIPPED / NOT EXECUTED: " + _paint(str(len(run_skipped_items)), config, "bold", "bright_yellow") if run_skipped_items else "SKIPPED / NOT EXECUTED: 0")
    if project_identity.get("key"):
        print(f"PROJECT KEY: {project_identity['key']}")

    if run_results:
        print()
        print("PATCHES EXECUTED:")
        for index, result in enumerate(run_results, 1):
            state = str(result.get("status", "UNKNOWN"))
            style = ("bold", "bright_green") if state == "PASS" else ("bold", "red")
            name = Path(str(result.get("input", ""))).name or str(result.get("input", ""))
            print(f"  {index}. " + _paint(f"[{state}]", config, *style) + f" {name}")
            print(f"     Source: {result.get('input', '')}")

    if run_skipped_items:
        print()
        print("PATCHES SKIPPED / NOT EXECUTED:")
        for index, entry in enumerate(run_skipped_items, 1):
            category = str(entry.get("category", "skipped")).upper()
            label = "DELETED" if category == "USER_DELETED" else "SKIPPED"
            style = ("bold", "red") if category == "USER_DELETED" else ("bold", "bright_yellow")
            name = Path(str(entry.get("input", ""))).name or str(entry.get("input", ""))
            print(f"  {index}. " + _paint(f"[{label}:{category}]", config, *style) + f" {name}")

    if run_results and run_results[-1].get("ai_handoff") and run_results[-1]["status"] == "FAIL":
        primary_path = project_root / run_results[-1]["ai_handoff"]
        print()
        print(_paint("[PRIMARY - UPLOAD] SEND TO AI FIRST:", config, "bold", "bright_green"))
        print("  " + _paint(_critical_console_path(primary_path, project_root, config), config, "bold", "bright_green"))
    if zero_mode:
        last_run_path = patch_dir / "reports" / "LAST_RUN.md"
        print(_paint("[LOCAL INFO] LAST RUN SUMMARY (do not upload unless requested):", config, "bold", "blue"))
        print("  " + _critical_console_path(last_run_path, project_root, config))
    return final_code


if __name__ == "__main__":
    script_dir = Path(__file__).resolve().parent
    root = Path(os.environ.get("PYTHON_PATCH_PROJECT_ROOT", script_dir.parent.parent)).expanduser().resolve()
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        report = emergency_report(root, KeyboardInterrupt("Interrupted by user"))
        print("Interrupted by user.", file=sys.stderr)
        if report:
            print(f"EMERGENCY REPORT ZIP: {report}", file=sys.stderr)
        raise SystemExit(130)
    except Exception as exc:
        report = emergency_report(root, exc)
        print(f"ERROR: {exc}", file=sys.stderr)
        if report:
            print(f"EMERGENCY REPORT ZIP: {report}", file=sys.stderr)
        raise SystemExit(1)
