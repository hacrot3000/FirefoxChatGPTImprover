#!/usr/bin/env python3
"""Safe declarative post-patch command policy for Python Patch Tool v5.16.

Commands are argv arrays, never shell strings. The manifest may request only:
1. bounded read-only discovery commands (ls, tree, pwd, find), or
2. execution of a script that resolves inside the current project worktree.
"""
from __future__ import annotations

from pathlib import Path, PurePosixPath
import os
import re
from typing import Any, Callable

TOOL_VERSION = "5.16.0"


class CommandPolicyError(RuntimeError):
    pass


DEFAULT_POLICY: dict[str, Any] = {
    "enabled": True,
    "default_timeout_seconds": 300,
    "max_timeout_seconds": 1800,
    "max_commands": 8,
    "allow_no_change_override": True,
    "max_forced_commands": 1,
    "allowed_basic_commands": ["ls", "tree", "pwd", "find"],
    "allowed_interpreters": ["python", "python3", "bash", "sh", "node", "pwsh", "powershell"],
    "script_extensions": [".py", ".sh", ".bash", ".js", ".mjs", ".cjs", ".ps1", ".pl", ".rb"],
}

_DANGEROUS_FIND_TOKENS = {
    "-exec", "-execdir", "-ok", "-okdir", "-delete", "-fprint", "-fprint0", "-fprintf", "-fls",
}
_TREE_WRITE_TOKENS = {"-o", "--outfile"}
_INTERPRETER_CODE_FLAGS = {
    "-c", "-e", "--eval", "--print", "-m", "-command", "--command", "-encodedcommand", "--encodedcommand",
    "-file",  # PowerShell -File is handled as the script selector below, not as free inline execution.
}
_INTERPRETER_STDIN_FLAGS = {"-", "-s", "--stdin"}
_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _./:+-]{0,239}$")
_SENSITIVE_ARG_RE = re.compile(
    r"(?i)(authorization|cookie|password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|secret|bearer)\s*[:=]"
    r"|https?://[^/@\s:]+:[^/@\s]+@"
)


def _safe_rel(value: Any, field: str, *, allow_dot: bool = True) -> str:
    if not isinstance(value, str):
        raise CommandPolicyError(f"{field} must be a string")
    normalized = value.strip().replace("\\", "/")
    if not normalized and allow_dot:
        normalized = "."
    pure = PurePosixPath(normalized)
    if pure.is_absolute() or any(part in {"", ".."} for part in pure.parts):
        raise CommandPolicyError(f"{field} must stay inside the project root")
    return pure.as_posix()


def _plain_arg(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value or any(ch in value for ch in "\x00\r\n"):
        raise CommandPolicyError(f"{field} must be a non-empty single-line string")
    if len(value) > 4096:
        raise CommandPolicyError(f"{field} is too long")
    if _SENSITIVE_ARG_RE.search(value):
        raise CommandPolicyError(f"{field} appears to contain a credential or secret; use project-local configuration instead")
    return value


def normalize_policy(raw: Any) -> dict[str, Any]:
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise CommandPolicyError("post_patch project configuration must be an object")
    policy = dict(DEFAULT_POLICY)
    policy.update(raw)
    policy["enabled"] = bool(policy.get("enabled", True))
    policy["allow_no_change_override"] = bool(policy.get("allow_no_change_override", True))
    for field in ("max_commands", "max_forced_commands"):
        policy[field] = int(policy.get(field, DEFAULT_POLICY[field]))
        if policy[field] < 0 or policy[field] > 100:
            raise CommandPolicyError(f"post_patch.{field} must be between 0 and 100")
    for field in ("default_timeout_seconds", "max_timeout_seconds"):
        policy[field] = float(policy.get(field, DEFAULT_POLICY[field]))
        if policy[field] < 0:
            raise CommandPolicyError(f"post_patch.{field} cannot be negative")
    if policy["max_timeout_seconds"] and policy["default_timeout_seconds"] > policy["max_timeout_seconds"]:
        raise CommandPolicyError("post_patch.default_timeout_seconds exceeds max_timeout_seconds")
    for field in ("allowed_basic_commands", "allowed_interpreters", "script_extensions"):
        values = policy.get(field, DEFAULT_POLICY[field])
        if not isinstance(values, list) or any(not isinstance(value, str) or not value.strip() for value in values):
            raise CommandPolicyError(f"post_patch.{field} must be a list of non-empty strings")
        policy[field] = [value.strip().lower() for value in values]
    return policy


def normalize_manifest_request(raw: Any, policy: dict[str, Any]) -> dict[str, Any]:
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise CommandPolicyError("Manifest post_patch field must be an object")
    unsupported = sorted(set(raw) - {"commands", "run_when_no_changes", "no_change_reason"})
    if unsupported:
        raise CommandPolicyError("Unsupported manifest post_patch fields: " + ", ".join(unsupported))
    commands = raw.get("commands", [])
    if not isinstance(commands, list):
        raise CommandPolicyError("post_patch.commands must be a list")
    if len(commands) > int(policy.get("max_commands", 8)):
        raise CommandPolicyError(
            f"post_patch.commands has {len(commands)} commands; project maximum is {policy.get('max_commands', 8)}"
        )
    normalized: list[dict[str, Any]] = []
    default_timeout = float(policy.get("default_timeout_seconds", 300))
    max_timeout = float(policy.get("max_timeout_seconds", 1800))
    for index, raw_command in enumerate(commands, 1):
        if not isinstance(raw_command, dict):
            raise CommandPolicyError(f"post_patch.commands[{index}] must be an object")
        unsupported_command = sorted(set(raw_command) - {"name", "argv", "cwd", "timeout_seconds"})
        if unsupported_command:
            raise CommandPolicyError(
                f"Unsupported post_patch.commands[{index}] fields: " + ", ".join(unsupported_command)
            )
        argv = raw_command.get("argv")
        if not isinstance(argv, list) or not argv:
            raise CommandPolicyError(f"post_patch.commands[{index}].argv must be a non-empty argv list")
        normalized_argv = [_plain_arg(value, f"post_patch.commands[{index}].argv") for value in argv]
        name = str(raw_command.get("name", "")).strip() or f"Post-patch command {index}"
        if not _NAME_RE.fullmatch(name):
            raise CommandPolicyError(f"post_patch.commands[{index}].name is invalid")
        timeout = float(raw_command.get("timeout_seconds", default_timeout))
        if timeout < 0:
            raise CommandPolicyError(f"post_patch.commands[{index}].timeout_seconds cannot be negative")
        if max_timeout and timeout > max_timeout:
            raise CommandPolicyError(
                f"post_patch.commands[{index}].timeout_seconds exceeds project maximum {max_timeout:g}"
            )
        static_detail = validate_command_static(normalized_argv, policy)
        normalized.append({
            "name": name,
            "argv": normalized_argv,
            "cwd": _safe_rel(raw_command.get("cwd", "."), f"post_patch.commands[{index}].cwd"),
            "timeout_seconds": timeout,
            "static_kind": static_detail["kind"],
        })
    override = bool(raw.get("run_when_no_changes", False))
    reason = str(raw.get("no_change_reason", "")).strip()
    if override:
        if not bool(policy.get("allow_no_change_override", True)):
            raise CommandPolicyError("post_patch.run_when_no_changes is disabled by project policy")
        if len(normalized) > int(policy.get("max_forced_commands", 1)):
            raise CommandPolicyError(
                "post_patch.run_when_no_changes may request at most "
                f"{policy.get('max_forced_commands', 1)} command(s)"
            )
        if len(reason) < 20 or len(reason) > 500 or any(ch in reason for ch in "\x00\r\n"):
            raise CommandPolicyError(
                "post_patch.no_change_reason must be a meaningful 20-500 character single-line explanation"
            )
    elif reason:
        raise CommandPolicyError("post_patch.no_change_reason is only valid with run_when_no_changes=true")
    return {
        "commands": normalized,
        "run_when_no_changes": override,
        "no_change_reason": reason,
    }


def _ensure_inside(root: Path, path: Path, field: str) -> Path:
    root_resolved = root.resolve()
    candidate = path.resolve()
    try:
        candidate.relative_to(root_resolved)
    except ValueError as exc:
        raise CommandPolicyError(f"{field} resolves outside the project root") from exc
    return candidate


def _validate_pathish_args(argv: list[str], cwd: Path, project_root: Path) -> None:
    for index, arg in enumerate(argv[1:], 1):
        if arg.startswith("-"):
            if "=" in arg:
                option_value = arg.split("=", 1)[1]
                option_path = Path(option_value)
                if option_path.is_absolute() or ".." in option_path.parts:
                    raise CommandPolicyError(
                        f"command option argument {index} must not reference an absolute/outside path: {arg!r}"
                    )
            continue
        if arg in {"!", "(", ")", ";", "+"}:
            continue
        # find expressions often contain patterns rather than paths.
        if any(token in arg for token in ("*", "?", "[", "]", "{}")):
            continue
        path = Path(arg)
        if path.is_absolute() or ".." in path.parts:
            raise CommandPolicyError(f"command argument {index} must not escape the project: {arg!r}")
        # Existing relative path operands are resolved to ensure symlinks do not escape.
        candidate = cwd / path
        if candidate.exists():
            _ensure_inside(project_root, candidate, f"command argument {index}")


def _validate_basic(argv: list[str], cwd: Path, project_root: Path) -> dict[str, Any]:
    command = Path(argv[0]).name.lower()
    lower_args = [arg.lower() for arg in argv[1:]]
    if command == "find":
        blocked = next((arg for arg in lower_args if arg in _DANGEROUS_FIND_TOKENS), "")
        if blocked:
            raise CommandPolicyError(f"find action {blocked!r} is not read-only and is forbidden")
        if any(arg.startswith("--files0-from") for arg in lower_args):
            raise CommandPolicyError("find --files0-from is forbidden; use project-relative path operands")
    elif command == "tree":
        blocked = next((arg for arg in lower_args if arg in _TREE_WRITE_TOKENS or arg.startswith("-o")), "")
        if blocked:
            raise CommandPolicyError(f"tree output option {blocked!r} is forbidden")
    elif command == "pwd":
        allowed = {"-l", "-p", "--logical", "--physical", "--help", "--version"}
        unsupported = [arg for arg in lower_args if arg not in allowed]
        if unsupported:
            raise CommandPolicyError("pwd accepts only standard read-only options")
    _validate_pathish_args(argv, cwd, project_root)
    return {"kind": "basic_read_only", "executable": command, "script": ""}


def _find_interpreter_script(argv: list[str], interpreter: str) -> tuple[str, int]:
    lower = interpreter.lower()
    for index, arg in enumerate(argv[1:], 1):
        lowered = arg.lower()
        if lowered in _INTERPRETER_STDIN_FLAGS:
            raise CommandPolicyError(f"{interpreter} stdin/inline execution is forbidden")
        if lowered in _INTERPRETER_CODE_FLAGS:
            if lowered == "-file" and lower in {"pwsh", "powershell"}:
                if index + 1 >= len(argv):
                    raise CommandPolicyError(f"{interpreter} -File requires a project-local script")
                return argv[index + 1], index + 1
            raise CommandPolicyError(f"{interpreter} inline/module execution flag {arg!r} is forbidden")
        if not arg.startswith("-"):
            return arg, index
    raise CommandPolicyError(f"{interpreter} command must name a project-local script file")


def _validate_static_path_args(argv: list[str]) -> None:
    for index, arg in enumerate(argv[1:], 1):
        candidate = arg.split("=", 1)[1] if arg.startswith("-") and "=" in arg else arg
        if arg.startswith("-") and "=" not in arg:
            continue
        if candidate in {"!", "(", ")", ";", "+"} or any(token in candidate for token in ("*", "?", "[", "]", "{}")):
            continue
        path = Path(candidate)
        if path.is_absolute() or ".." in path.parts:
            raise CommandPolicyError(f"command argument {index} must use a project-relative path: {arg!r}")


def validate_command_static(argv: list[str], policy: dict[str, Any]) -> dict[str, Any]:
    executable = Path(argv[0]).name.lower()
    basic = set(policy.get("allowed_basic_commands", []))
    interpreters = set(policy.get("allowed_interpreters", []))
    if executable in basic and Path(argv[0]).name == argv[0]:
        lower_args = [arg.lower() for arg in argv[1:]]
        if executable == "find":
            blocked = next((arg for arg in lower_args if arg in _DANGEROUS_FIND_TOKENS), "")
            if blocked or any(arg.startswith("--files0-from") for arg in lower_args):
                raise CommandPolicyError(f"find action {blocked or '--files0-from'!r} is forbidden")
        if executable == "tree":
            blocked = next((arg for arg in lower_args if arg in _TREE_WRITE_TOKENS or arg.startswith("-o")), "")
            if blocked:
                raise CommandPolicyError(f"tree output option {blocked!r} is forbidden")
        if executable == "pwd":
            allowed = {"-l", "-p", "--logical", "--physical", "--help", "--version"}
            if any(arg not in allowed for arg in lower_args):
                raise CommandPolicyError("pwd accepts only standard read-only options")
        _validate_static_path_args(argv)
        return {"kind": "basic_read_only", "executable": executable}
    if executable in interpreters and Path(argv[0]).name == argv[0]:
        script_arg, script_index = _find_interpreter_script(argv, executable)
        script_rel = _safe_rel(script_arg, "post_patch interpreter script", allow_dot=False)
        suffix = Path(script_rel).suffix.lower()
        if suffix not in set(policy.get("script_extensions", [])):
            raise CommandPolicyError(f"project-local script extension {suffix!r} is not allowed")
        _validate_static_path_args([argv[0], *argv[script_index + 1:]])
        return {"kind": "project_script", "executable": executable, "script": script_rel}
    direct_rel = _safe_rel(argv[0], "post_patch direct script", allow_dot=False)
    direct_path = Path(direct_rel)
    if "/" not in direct_rel and direct_path.suffix.lower() not in set(policy.get("script_extensions", [])):
        raise CommandPolicyError(
            f"command {argv[0]!r} is not allowlisted; use a basic read-only command or a project-local script path"
        )
    _validate_static_path_args(argv)
    return {"kind": "project_script", "executable": argv[0], "script": direct_rel}


def validate_command(command: dict[str, Any], execution_root: Path, policy: dict[str, Any]) -> dict[str, Any]:
    argv = list(command["argv"])
    cwd_rel = command.get("cwd", ".")
    cwd = _ensure_inside(execution_root, execution_root / cwd_rel, "post_patch command cwd")
    if not cwd.is_dir():
        raise CommandPolicyError(f"post_patch command cwd does not exist: {cwd_rel}")
    executable = Path(argv[0]).name.lower()
    basic = set(policy.get("allowed_basic_commands", []))
    interpreters = set(policy.get("allowed_interpreters", []))
    if executable in basic and Path(argv[0]).name == argv[0]:
        detail = _validate_basic(argv, cwd, execution_root)
    elif executable in interpreters and Path(argv[0]).name == argv[0]:
        script_arg, script_index = _find_interpreter_script(argv, executable)
        script_rel = _safe_rel(script_arg, "post_patch interpreter script", allow_dot=False)
        script_path = _ensure_inside(execution_root, cwd / script_rel, "post_patch interpreter script")
        if not script_path.is_file():
            raise CommandPolicyError(f"project-local script does not exist: {script_arg}")
        allowed_ext = set(policy.get("script_extensions", []))
        if script_path.suffix.lower() not in allowed_ext:
            raise CommandPolicyError(
                f"project-local script extension {script_path.suffix!r} is not allowed by post_patch policy"
            )
        _validate_pathish_args([argv[0], *argv[script_index + 1:]], cwd, execution_root)
        detail = {
            "kind": "project_script",
            "executable": executable,
            "script": script_path.relative_to(execution_root.resolve()).as_posix(),
        }
    else:
        script_rel = _safe_rel(argv[0], "post_patch direct script", allow_dot=False)
        script_path = _ensure_inside(execution_root, cwd / script_rel, "post_patch direct script")
        if not script_path.is_file():
            raise CommandPolicyError(
                f"command {argv[0]!r} is neither an allowed basic command nor a project-local script"
            )
        if not os.access(script_path, os.X_OK):
            raise CommandPolicyError(f"direct project-local script is not executable: {argv[0]}")
        _validate_pathish_args(argv, cwd, execution_root)
        detail = {
            "kind": "project_script",
            "executable": argv[0],
            "script": script_path.relative_to(execution_root.resolve()).as_posix(),
        }
    detail.update({"cwd": cwd_rel, "argv": argv})
    return detail


def decide_run(*, has_payload: bool, changed_paths: list[str], request: dict[str, Any], policy: dict[str, Any]) -> dict[str, Any]:
    commands = list(request.get("commands", []))
    if not commands:
        return {"run": False, "status": "NOT_REQUESTED", "reason": "no_commands", "forced": False}
    if not bool(policy.get("enabled", True)):
        raise CommandPolicyError("post_patch commands are disabled by project policy")
    if not has_payload:
        return {"run": True, "status": "COMMAND_ONLY_PACKAGE", "reason": "no_patch_payload", "forced": False}
    if changed_paths:
        return {"run": True, "status": "CHANGED_PATHS", "reason": "patch_changed_files", "forced": False}
    if bool(request.get("run_when_no_changes", False)):
        return {
            "run": True,
            "status": "NO_CHANGE_OVERRIDE",
            "reason": request.get("no_change_reason", ""),
            "forced": True,
        }
    return {
        "run": False,
        "status": "SKIPPED_NO_PATCH_CHANGES",
        "reason": "normal patch payload produced no changed or new files",
        "forced": False,
    }


def run_commands(
    *, execution_root: Path, request: dict[str, Any], policy: dict[str, Any], execution_cfg: dict[str, Any],
    logger: Any, stream_child: Callable[..., tuple[int, bool, dict[str, Any]]], env: dict[str, str],
    redact_command: Callable[[list[str]], list[str]],
) -> dict[str, Any]:
    results: list[dict[str, Any]] = []
    for index, command in enumerate(request.get("commands", []), 1):
        validated = validate_command(command, execution_root, policy)
        logger.line()
        logger.line("============================================================")
        logger.line(f"Post-patch command {index}: {command['name']}")
        logger.line(f"Policy kind : {validated['kind']}")
        logger.line(f"Working dir : {command.get('cwd', '.')}")
        redacted_argv = redact_command(list(command["argv"]))
        logger.line("Command     : " + " ".join(redacted_argv))
        logger.line("============================================================")
        cwd = _ensure_inside(execution_root, execution_root / command.get("cwd", "."), "post_patch command cwd")
        total_commands = len(request.get("commands", []))
        execution_cfg["_live_task_label"] = f"POST COMMAND {index}/{total_commands}: {command['name']}"
        try:
            exit_code, timed_out, log_result = stream_child(
                list(command["argv"]), cwd, env, float(command.get("timeout_seconds", 0)), logger,
                capture_name=f"post_command_{index}_{command['name']}", execution_cfg=execution_cfg,
            )
        finally:
            execution_cfg.pop("_live_task_label", None)
        entry = {
            "index": index,
            "name": command["name"],
            "argv": redacted_argv,
            "cwd": command.get("cwd", "."),
            "timeout_seconds": command.get("timeout_seconds", 0),
            "policy_kind": validated["kind"],
            "script": validated.get("script", ""),
            "exit_code": exit_code,
            "timed_out": timed_out,
            "status": "PASS" if exit_code == 0 else "FAIL",
            "log": log_result,
        }
        results.append(entry)
        if exit_code != 0:
            return {
                "status": "FAIL", "requested": len(request.get("commands", [])),
                "executed": len(results), "passed": sum(1 for item in results if item["status"] == "PASS"),
                "failed": 1, "commands": results,
                "error": f"PTV-POST-COMMAND-EXEC-001: command {index} exited with code {exit_code}",
            }
    return {
        "status": "PASS", "requested": len(request.get("commands", [])), "executed": len(results),
        "passed": len(results), "failed": 0, "commands": results, "error": "",
    }
