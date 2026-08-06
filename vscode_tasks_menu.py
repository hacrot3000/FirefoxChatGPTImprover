#!/usr/bin/env python3
"""
Hiển thị menu terminal để chọn và chạy các lệnh trong .vscode/tasks.json.

Cách dùng:
    ./vscode_tasks_menu.py
    ./vscode_tasks_menu.py /duong/dan/toi/.vscode/tasks.json

Phím điều khiển:
    ↑ / ↓ / ← / →  Di chuyển
    Enter           Chạy task
    r               Reload tasks.json
    Home / End      Đầu / cuối danh sách
    q / Esc         Thoát
"""

from __future__ import annotations

import argparse
import curses
import json
import locale
import os
import re
import shlex
import shutil
import subprocess
import sys
import termios
import textwrap
import zipfile
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Any, Iterable, Sequence


EXIT_LABEL = "Thoát"
INTERNAL_ACTION_FIELD = "menuAction"


@dataclass
class MenuSessionState:
    """Dữ liệu chỉ tồn tại trong một lần chạy menu."""

    commit_messages: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class SelectionItem:
    label: str
    value: str


class TasksMenuError(RuntimeError):
    """Lỗi có thể hiển thị trực tiếp cho người dùng."""


def strip_jsonc(text: str) -> str:
    """Loại bỏ comment //, /* ... */ và dấu phẩy cuối của JSONC."""
    without_comments: list[str] = []
    i = 0
    in_string = False
    escaped = False

    while i < len(text):
        char = text[i]

        if in_string:
            without_comments.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            i += 1
            continue

        if char == '"':
            in_string = True
            without_comments.append(char)
            i += 1
            continue

        if char == "/" and i + 1 < len(text):
            next_char = text[i + 1]

            if next_char == "/":
                i += 2
                while i < len(text) and text[i] not in "\r\n":
                    i += 1
                continue

            if next_char == "*":
                i += 2
                while i + 1 < len(text) and text[i : i + 2] != "*/":
                    # Giữ xuống dòng để số dòng báo lỗi vẫn gần đúng.
                    if text[i] in "\r\n":
                        without_comments.append(text[i])
                    i += 1
                if i + 1 >= len(text):
                    raise TasksMenuError("Comment /* ... */ trong tasks.json chưa được đóng.")
                i += 2
                continue

        without_comments.append(char)
        i += 1

    # Loại bỏ dấu phẩy đứng trước } hoặc ] khi không nằm trong chuỗi.
    source = "".join(without_comments)
    result: list[str] = []
    i = 0
    in_string = False
    escaped = False

    while i < len(source):
        char = source[i]

        if in_string:
            result.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            i += 1
            continue

        if char == '"':
            in_string = True
            result.append(char)
            i += 1
            continue

        if char == ",":
            j = i + 1
            while j < len(source) and source[j].isspace():
                j += 1
            if j < len(source) and source[j] in "]}":
                i += 1
                continue

        result.append(char)
        i += 1

    return "".join(result)


def builtin_task_definitions() -> list[dict[str, Any]]:
    """Các task nền tảng được tự bổ sung khi còn thiếu."""
    base = {
        "type": "shell",
        "problemMatcher": [],
        "options": {"cwd": "${workspaceFolder}"},
        "presentation": {
            "echo": True,
            "reveal": "always",
            "focus": True,
            "panel": "shared",
        },
    }

    definitions: list[tuple[str, str, str, str]] = [
        (
            "Git: Add interactive",
            "python3 \"${workspaceFolder}/vscode_tasks_menu.py\" --action git-add --workspace \"${workspaceFolder}\"",
            "git_add",
            "Hỏi stage file đã track và cho chọn nhiều file chưa track; sau khi chọn xong mặc định hỏi commit, rồi sau commit thành công mặc định hỏi push.",
        ),
        (
            "Git: Commit interactive",
            "python3 \"${workspaceFolder}/vscode_tasks_menu.py\" --action git-commit --workspace \"${workspaceFolder}\"",
            "git_commit",
            "Nhập commit message và commit phần đã stage; sau commit thành công mặc định hỏi push. Message cũ được giữ tạm trong phiên menu và mất khi thoát.",
        ),
        (
            "Git: Push",
            "python3 \"${workspaceFolder}/vscode_tasks_menu.py\" --action git-push --workspace \"${workspaceFolder}\"",
            "git_push",
            "Push branch hiện tại lên upstream; nếu branch chưa có upstream thì cho chọn remote và thiết lập upstream bằng git push -u.",
        ),
        (
            "Git: Switch branch",
            "python3 \"${workspaceFolder}/vscode_tasks_menu.py\" --action git-switch --workspace \"${workspaceFolder}\"",
            "git_switch",
            "Cho chọn local branch hoặc remote branch bằng menu nhiều cột, sau đó switch hoặc tạo local tracking branch tương ứng.",
        ),
        (
            "Git: Zip staged changes",
            "python3 \"${workspaceFolder}/vscode_tasks_menu.py\" --action zip-staged --workspace \"${workspaceFolder}\"",
            "zip_staged",
            "Tạo ZIP trực tiếp bằng vscode_tasks_menu.py từ đúng nội dung đang stage trong Git, kèm staged.diff và manifest; không cần thư mục tools hoặc script phụ trợ.",
        ),
    ]

    tasks: list[dict[str, Any]] = []
    for label, command, action, detail in definitions:
        task = dict(base)
        task["options"] = dict(base["options"])
        task["presentation"] = dict(base["presentation"])
        task.update(
            {
                "label": label,
                "detail": detail,
                "command": command,
                INTERNAL_ACTION_FIELD: action,
            }
        )
        tasks.append(task)
    return tasks


def normalized_command(task: dict[str, Any]) -> str:
    value = task.get("command", "")
    return " ".join(str(value).lower().split())


def task_provides_action(task: dict[str, Any], action: str) -> bool:
    """Nhận diện task tương đương để không tự thêm trùng lặp."""
    configured = str(task.get(INTERNAL_ACTION_FIELD, "")).strip().lower()
    if configured == action:
        return True

    command = normalized_command(task)
    patterns = {
        "git_add": (r"\bgit\s+add\b", "--action git-add"),
        "git_commit": (r"\bgit\s+commit\b", "--action git-commit"),
        "git_push": (r"\bgit\s+push\b", "--action git-push"),
        "git_switch": (r"\bgit\s+(?:switch|checkout)\b", "--action git-switch"),
    }
    if action == "zip_staged":
        return "--action zip-staged" in command

    regex_pattern, action_pattern = patterns[action]
    return action_pattern in command or re.search(regex_pattern, command) is not None


def ensure_builtin_tasks(tasks_file: Path) -> list[str]:
    """Thêm task còn thiếu và chuẩn hóa các workflow nội bộ do menu quản lý."""
    try:
        raw_text = tasks_file.read_text(encoding="utf-8-sig")
        data = json.loads(strip_jsonc(raw_text))
    except OSError as exc:
        raise TasksMenuError(f"Không thể đọc {tasks_file}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise TasksMenuError(
            f"tasks.json không hợp lệ tại dòng {exc.lineno}, cột {exc.colno}: {exc.msg}"
        ) from exc

    if not isinstance(data, dict):
        raise TasksMenuError("tasks.json phải chứa một object JSON ở cấp cao nhất.")
    raw_tasks = data.get("tasks")
    if raw_tasks is None:
        raw_tasks = []
        data["tasks"] = raw_tasks
    if not isinstance(raw_tasks, list):
        raise TasksMenuError('tasks.json không có mảng "tasks" hợp lệ.')

    existing = [task for task in raw_tasks if isinstance(task, dict)]
    changed_labels: list[str] = []
    for definition in builtin_task_definitions():
        action = str(definition[INTERNAL_ACTION_FIELD])
        matched = next(
            (task for task in existing if task_provides_action(task, action)),
            None,
        )
        if matched is None:
            raw_tasks.append(definition)
            existing.append(definition)
            changed_labels.append(str(definition["label"]))
            continue

        # Các task nội bộ do menu từng tạo phải được cập nhật command/detail mới.
        # Không chuẩn hóa task Git tùy chỉnh chỉ tình cờ chứa lệnh git tương đương.
        configured_action = str(matched.get(INTERNAL_ACTION_FIELD, "")).strip().lower()
        command = normalized_command(matched)
        generated_action_command = f"--action {action.replace('_', '-')}"
        is_menu_managed = (
            configured_action == action
            or generated_action_command in command
            or action == "zip_staged"
        )
        if is_menu_managed:
            fields = (
                "label",
                "detail",
                "command",
                INTERNAL_ACTION_FIELD,
                "type",
                "problemMatcher",
                "options",
                "presentation",
            )
            changed = False
            for field_name in fields:
                canonical = definition[field_name]
                if matched.get(field_name) != canonical:
                    matched[field_name] = canonical
                    changed = True
            if changed:
                changed_labels.append(str(definition["label"]))

    if changed_labels:
        tasks_file.parent.mkdir(parents=True, exist_ok=True)
        tasks_file.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    return changed_labels


def find_tasks_file(argument: str | None) -> Path:
    """Tìm tasks.json theo tham số, thư mục hiện tại hoặc vị trí script."""
    if argument:
        candidate = Path(argument).expanduser()
        if candidate.is_dir():
            if candidate.name == ".vscode":
                candidate = candidate / "tasks.json"
            else:
                candidate = candidate / ".vscode" / "tasks.json"
        candidate = candidate.resolve()
        if not candidate.is_file():
            raise TasksMenuError(f"Không tìm thấy file: {candidate}")
        return candidate

    starts = [Path.cwd().resolve(), Path(__file__).resolve().parent]
    checked: set[Path] = set()

    for start in starts:
        for directory in (start, *start.parents):
            candidate = directory / ".vscode" / "tasks.json"
            if candidate in checked:
                continue
            checked.add(candidate)
            if candidate.is_file():
                return candidate

    raise TasksMenuError(
        "Không tìm thấy .vscode/tasks.json trong thư mục hiện tại hoặc các thư mục cha.\n"
        "Có thể truyền đường dẫn trực tiếp:\n"
        f"  {Path(sys.argv[0]).name} /duong/dan/.vscode/tasks.json"
    )


def load_tasks(tasks_file: Path) -> list[dict[str, Any]]:
    try:
        raw_text = tasks_file.read_text(encoding="utf-8-sig")
    except OSError as exc:
        raise TasksMenuError(f"Không thể đọc {tasks_file}: {exc}") from exc

    try:
        data = json.loads(strip_jsonc(raw_text))
    except json.JSONDecodeError as exc:
        raise TasksMenuError(
            f"tasks.json không hợp lệ tại dòng {exc.lineno}, cột {exc.colno}: {exc.msg}"
        ) from exc

    raw_tasks = data.get("tasks")
    if not isinstance(raw_tasks, list):
        raise TasksMenuError('tasks.json không có mảng "tasks".')

    tasks: list[dict[str, Any]] = []
    for index, task in enumerate(raw_tasks, start=1):
        if not isinstance(task, dict):
            continue

        command = task.get("command")
        if not isinstance(command, str) or not command.strip():
            continue

        normalized = dict(task)
        label = normalized.get("label")
        if not isinstance(label, str) or not label.strip():
            normalized["label"] = f"Task {index}"
        tasks.append(normalized)

    if not tasks:
        raise TasksMenuError("Không tìm thấy task nào có trường command hợp lệ.")

    return tasks


def workspace_root_for(tasks_file: Path) -> Path:
    if tasks_file.parent.name == ".vscode":
        return tasks_file.parent.parent.resolve()
    return tasks_file.parent.resolve()


_VARIABLE_PATTERN = re.compile(r"\$\{([^{}]+)}")


def expand_variables(value: str, workspace_root: Path) -> str:
    """Thay các biến VS Code phổ biến có thể xác định ngoài VS Code."""

    def replace(match: re.Match[str]) -> str:
        token = match.group(1)

        if token == "workspaceFolder":
            return str(workspace_root)
        if token == "workspaceFolderBasename":
            return workspace_root.name
        if token == "pathSeparator":
            return os.sep
        if token == "userHome":
            return str(Path.home())
        if token.startswith("env:"):
            return os.environ.get(token[4:], "")

        # Giữ nguyên biến không thể xác định như ${file}, ${input:name}, ...
        return match.group(0)

    return _VARIABLE_PATTERN.sub(replace, value)


def task_args(task: dict[str, Any], workspace_root: Path) -> list[str]:
    raw_args = task.get("args", [])
    if raw_args is None:
        return []
    if not isinstance(raw_args, list):
        raise TasksMenuError(f'Task "{task["label"]}" có args không phải là mảng.')

    args: list[str] = []
    for value in raw_args:
        if isinstance(value, (str, int, float)):
            args.append(expand_variables(str(value), workspace_root))
        else:
            raise TasksMenuError(
                f'Task "{task["label"]}" chứa đối số không được hỗ trợ: {value!r}'
            )
    return args


def task_cwd(task: dict[str, Any], workspace_root: Path) -> Path:
    options = task.get("options", {})
    if not isinstance(options, dict):
        options = {}

    raw_cwd = options.get("cwd")
    if raw_cwd is None:
        return workspace_root
    if not isinstance(raw_cwd, str):
        raise TasksMenuError(f'Task "{task["label"]}" có options.cwd không hợp lệ.')

    expanded = Path(expand_variables(raw_cwd, workspace_root)).expanduser()
    if not expanded.is_absolute():
        expanded = workspace_root / expanded
    return expanded.resolve()


def task_environment(task: dict[str, Any], workspace_root: Path) -> dict[str, str]:
    env = os.environ.copy()
    options = task.get("options", {})
    if not isinstance(options, dict):
        return env

    task_env = options.get("env", {})
    if task_env is None:
        return env
    if not isinstance(task_env, dict):
        raise TasksMenuError(f'Task "{task["label"]}" có options.env không hợp lệ.')

    for key, value in task_env.items():
        if value is None:
            env.pop(str(key), None)
        else:
            env[str(key)] = expand_variables(str(value), workspace_root)

    return env


def shell_executable(task: dict[str, Any], workspace_root: Path) -> str:
    options = task.get("options", {})
    if isinstance(options, dict):
        shell = options.get("shell", {})
        if isinstance(shell, dict):
            executable = shell.get("executable")
            if isinstance(executable, str) and executable.strip():
                return expand_variables(executable, workspace_root)

    return os.environ.get("SHELL") or shutil.which("bash") or "/bin/sh"


def command_preview(task: dict[str, Any], workspace_root: Path) -> str:
    command = expand_variables(str(task["command"]), workspace_root)
    args = task_args(task, workspace_root)
    if args:
        command = f"{command} {shlex.join(args)}"
    return command


def task_description(task: dict[str, Any]) -> str:
    """Lấy mô tả task từ detail/description và chuẩn hóa khoảng trắng."""
    for field in ("detail", "description"):
        value = task.get(field)
        if isinstance(value, str) and value.strip():
            return " ".join(value.split())
    return "Task chưa có mô tả trong .vscode/tasks.json."


def wrap_prefixed_value(prefix: str, value: str, width: int) -> list[str]:
    """Bọc một giá trị có prefix mà không tạo dòng trống hoặc cắt nội dung."""
    continuation = " " * len(prefix)
    content_width = max(10, width - len(prefix))
    wrapped = textwrap.wrap(
        " ".join(value.split()),
        width=content_width,
        replace_whitespace=True,
        drop_whitespace=True,
        break_long_words=True,
        break_on_hyphens=False,
    ) or [""]
    return [
        (prefix if index == 0 else continuation) + line
        for index, line in enumerate(wrapped)
    ]


def build_preview_lines(
    task: dict[str, Any] | None,
    workspace_root: Path,
    width: int,
) -> list[str]:
    """Tạo footer vừa khít: lệnh, thư mục và mô tả nằm liên tiếp."""
    if task is None:
        return ["Thoát khỏi chương trình."]

    return [
        *wrap_prefixed_value("Lệnh: ", command_preview(task, workspace_root), width),
        *wrap_prefixed_value("Tại:  ", str(task_cwd(task, workspace_root)), width),
        *wrap_prefixed_value("Mô tả: ", task_description(task), width),
    ]


def choose_menu_columns(
    item_count: int,
    list_height: int,
    available_width: int,
    longest_label_width: int,
) -> int:
    """Chọn số cột chỉ khi mọi nhãn đều vừa và toàn bộ item hiển thị được."""
    if item_count <= 1 or list_height <= 0:
        return 1

    minimum_cell_width = longest_label_width + 3  # marker "› " và khoảng cách cột
    max_columns_by_width = max(1, available_width // minimum_cell_width)
    if max_columns_by_width < 2:
        return 1

    preferred_columns = max(1, (item_count + 7) // 8)
    minimum_columns_to_fit = max(1, (item_count + list_height - 1) // list_height)
    requested = max(preferred_columns, minimum_columns_to_fit)

    if requested <= max_columns_by_width:
        rows = (item_count + requested - 1) // requested
        if rows <= list_height:
            return requested

    for columns in range(max_columns_by_width, 1, -1):
        rows = (item_count + columns - 1) // columns
        if rows <= list_height:
            return columns

    return 1


def terminal_size_message(
    current_width: int,
    current_height: int,
    required_width: int,
    required_height: int,
) -> str:
    return (
        "Terminal quá nhỏ để hiển thị đầy đủ. "
        f"Hiện tại {current_width}x{current_height}; "
        f"cần ít nhất {required_width}x{required_height}."
    )


def reload_tasks_preserving_selection(
    tasks_file: Path,
    current_tasks: list[dict[str, Any]],
    selected: int,
) -> tuple[list[dict[str, Any]], int]:
    """Reload tasks.json và giữ task đang chọn theo label nếu còn tồn tại."""
    selected_label: str | None = None
    if 0 <= selected < len(current_tasks):
        selected_label = str(current_tasks[selected].get("label", ""))

    ensure_builtin_tasks(tasks_file)
    new_tasks = load_tasks(tasks_file)
    if selected_label:
        for index, task in enumerate(new_tasks):
            if str(task.get("label", "")) == selected_label:
                return new_tasks, index

    return new_tasks, min(selected, len(new_tasks))


def clear_pending_input() -> None:
    """Xóa phím đã nhấn thừa trước khi yêu cầu Enter."""
    try:
        termios.tcflush(sys.stdin.fileno(), termios.TCIFLUSH)
    except (OSError, termios.error):
        pass


def wait_for_enter() -> None:
    clear_pending_input()
    try:
        input("\nNhấn Enter để quay lại menu...")
    except EOFError:
        pass


def run_process(
    argv: Sequence[str],
    workspace_root: Path,
    *,
    capture_output: bool = False,
    text: bool = True,
) -> subprocess.CompletedProcess[Any]:
    try:
        return subprocess.run(
            list(argv),
            cwd=workspace_root,
            check=False,
            capture_output=capture_output,
            text=text,
        )
    except FileNotFoundError as exc:
        raise TasksMenuError(f"Không tìm thấy lệnh: {argv[0]}") from exc
    except OSError as exc:
        raise TasksMenuError(f"Không thể chạy {argv[0]}: {exc}") from exc


def ensure_git_repository(workspace_root: Path) -> Path:
    completed = run_process(
        ["git", "rev-parse", "--show-toplevel"],
        workspace_root,
        capture_output=True,
    )
    if completed.returncode != 0:
        message = (completed.stderr or completed.stdout or "Không phải Git repository.").strip()
        raise TasksMenuError(message)
    return Path(completed.stdout.strip()).resolve()


def git_lines(workspace_root: Path, args: Sequence[str]) -> list[str]:
    completed = run_process(["git", *args], workspace_root, capture_output=True)
    if completed.returncode != 0:
        raise TasksMenuError((completed.stderr or completed.stdout).strip())
    return [line for line in completed.stdout.splitlines() if line]


def git_z_paths(workspace_root: Path, args: Sequence[str]) -> list[str]:
    completed = run_process(
        ["git", *args], workspace_root, capture_output=True, text=False
    )
    if completed.returncode != 0:
        stderr = completed.stderr.decode("utf-8", "replace") if completed.stderr else ""
        raise TasksMenuError(stderr.strip() or "Lệnh Git thất bại.")
    return [
        value.decode("utf-8", "surrogateescape")
        for value in completed.stdout.split(b"\0")
        if value
    ]


def prompt_yes_no(question: str, *, default: bool = False) -> bool:
    suffix = "[Y/n]" if default else "[y/N]"
    try:
        answer = input(f"{question} {suffix} ").strip().lower()
    except EOFError:
        return default
    if not answer:
        return default
    return answer in {"y", "yes", "c", "co", "có"}


def selection_layout(
    item_count: int,
    height: int,
    width: int,
    longest_label: int,
) -> tuple[int, int, int]:
    list_top = 2
    footer_height = 2
    list_height = max(1, height - list_top - footer_height)
    columns = choose_menu_columns(
        item_count,
        list_height,
        max(1, width - 1),
        longest_label + 4,
    )
    rows = max(1, (item_count + columns - 1) // columns)
    return columns, rows, list_height


def select_items_screen(
    screen: curses.window,
    title: str,
    items: Sequence[SelectionItem],
    multi: bool,
) -> list[str] | None:
    curses.curs_set(0)
    screen.keypad(True)
    selected_index = 0
    checked: set[int] = set()
    first_visible = 0

    while True:
        screen.erase()
        height, width = screen.getmaxyx()
        help_text = (
            "Space: chọn/bỏ | a: tất cả | n: bỏ tất cả | Enter: xác nhận | q/Esc: hủy"
            if multi
            else "↑/↓/←/→: chọn | Enter: xác nhận | q/Esc: hủy"
        )
        labels = []
        for index, item in enumerate(items):
            if multi:
                labels.append(f"[{'x' if index in checked else ' '}] {item.label}")
            else:
                labels.append(item.label)
        longest = max((len(label) for label in labels), default=1)
        required_width = max(48, min(longest + 3, 160), len(help_text) + 1)
        if width < min(required_width, longest + 3) or height < 7:
            message = terminal_size_message(
                width,
                height,
                max(48, longest + 3),
                7,
            )
            screen.addnstr(0, 0, title, max(1, width - 1), curses.A_BOLD)
            for row, line in enumerate(textwrap.wrap(message, max(10, width - 1)), 1):
                if row >= height:
                    break
                screen.addnstr(row, 0, line, max(1, width - 1))
            screen.refresh()
            key = screen.getch()
            if key in (ord("q"), ord("Q"), 27):
                return None
            continue

        columns, _, list_height = selection_layout(
            len(items), height, width, longest
        )
        screen.addnstr(0, 0, title, width - 1, curses.A_BOLD)
        screen.hline(1, 0, getattr(curses, "ACS_HLINE", ord("-")), width - 1)

        if columns > 1:
            first_visible = 0
            column_width = (width - 1) // columns
            for index, label in enumerate(labels):
                row = index // columns
                column = index % columns
                if row >= list_height:
                    break
                marker = "› " if index == selected_index else "  "
                attr = curses.A_REVERSE | curses.A_BOLD if index == selected_index else 0
                screen.addnstr(
                    2 + row,
                    column * column_width,
                    marker + label,
                    max(1, column_width - 1),
                    attr,
                )
        else:
            if selected_index < first_visible:
                first_visible = selected_index
            elif selected_index >= first_visible + list_height:
                first_visible = selected_index - list_height + 1
            first_visible = min(
                max(0, first_visible), max(0, len(items) - list_height)
            )
            for row in range(list_height):
                index = first_visible + row
                if index >= len(items):
                    break
                marker = "› " if index == selected_index else "  "
                attr = curses.A_REVERSE | curses.A_BOLD if index == selected_index else 0
                screen.addnstr(2 + row, 0, marker + labels[index], width - 1, attr)

        screen.addnstr(height - 1, 0, help_text, width - 1, curses.A_DIM)
        screen.refresh()
        key = screen.getch()
        item_count = len(items)
        if not item_count:
            return []
        if key in (ord("q"), ord("Q"), 27):
            return None
        if key in (curses.KEY_ENTER, 10, 13):
            if multi:
                return [items[index].value for index in sorted(checked)]
            return [items[selected_index].value]
        if multi and key == ord(" "):
            if selected_index in checked:
                checked.remove(selected_index)
            else:
                checked.add(selected_index)
        elif multi and key in (ord("a"), ord("A")):
            checked = set(range(item_count))
        elif multi and key in (ord("n"), ord("N")):
            checked.clear()
        elif key in (curses.KEY_UP, ord("k")):
            candidate = selected_index - columns
            if candidate >= 0:
                selected_index = candidate
            elif columns == 1:
                selected_index = item_count - 1
        elif key in (curses.KEY_DOWN, ord("j")):
            candidate = selected_index + columns
            if candidate < item_count:
                selected_index = candidate
            elif columns == 1:
                selected_index = 0
        elif key == curses.KEY_LEFT and columns > 1:
            if selected_index % columns > 0:
                selected_index -= 1
        elif key == curses.KEY_RIGHT and columns > 1:
            candidate = selected_index + 1
            if selected_index % columns < columns - 1 and candidate < item_count:
                selected_index = candidate
        elif key == curses.KEY_HOME:
            selected_index = 0
        elif key == curses.KEY_END:
            selected_index = item_count - 1


def select_items(
    title: str,
    items: Sequence[SelectionItem],
    *,
    multi: bool = False,
) -> list[str] | None:
    if not items:
        return []
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        raise TasksMenuError("Tác vụ này cần terminal tương tác.")
    return curses.wrapper(select_items_screen, title, items, multi)


def action_git_add(workspace_root: Path, state: MenuSessionState) -> int:
    repo = ensure_git_repository(workspace_root)
    tracked = git_lines(repo, ["status", "--short", "--untracked-files=no"])
    if tracked:
        print("Các thay đổi của file đã track:")
        for line in tracked:
            print(f"  {line}")
        if prompt_yes_no("Add toàn bộ thay đổi của file đã track?", default=True):
            completed = run_process(["git", "add", "-u", "--", "."], repo)
            if completed.returncode != 0:
                return completed.returncode
            print("[OK] Đã add thay đổi của file đã track.")
    else:
        print("[INFO] Không có thay đổi ở file đã track.")

    untracked = git_z_paths(repo, ["ls-files", "--others", "--exclude-standard", "-z"])
    if untracked:
        selected = select_items(
            " CHỌN FILE CHƯA TRACK ĐỂ GIT ADD ",
            [SelectionItem(path, path) for path in untracked],
            multi=True,
        )
        if selected is None:
            print("[SKIP] Đã hủy chọn file chưa track.")
        elif selected:
            completed = run_process(["git", "add", "--", *selected], repo)
            if completed.returncode != 0:
                return completed.returncode
            print(f"[OK] Đã add {len(selected)} file chưa track.")
        else:
            print("[SKIP] Không chọn file chưa track nào.")
    else:
        print("[INFO] Không có file chưa track.")

    run_process(["git", "status", "--short"], repo)
    staged_check = run_process(["git", "diff", "--cached", "--quiet"], repo)
    if staged_check.returncode == 0:
        print("[INFO] Không có thay đổi nào đang được stage; bỏ qua commit/push.")
        return 0
    if staged_check.returncode not in (0, 1):
        return staged_check.returncode

    if not prompt_yes_no("Tiếp tục commit các thay đổi đã stage?", default=True):
        print("[SKIP] Giữ lại staged changes, chưa commit.")
        return 0
    return action_git_commit(repo, state)


def resolve_commit_message(state: MenuSessionState) -> str | None:
    if state.commit_messages:
        print("Commit message đã dùng trong phiên:")
        for index, message in enumerate(state.commit_messages, 1):
            print(f"  {index}. {message}")
        prompt = "Commit message (nhập số để dùng lại, nội dung mới, hoặc trống để hủy): "
    else:
        prompt = "Commit message (trống để hủy): "
    try:
        value = input(prompt).strip()
    except EOFError:
        return None
    if not value:
        return None
    if value.isdigit() and state.commit_messages:
        index = int(value) - 1
        if 0 <= index < len(state.commit_messages):
            return state.commit_messages[index]
    return value


def action_git_commit(workspace_root: Path, state: MenuSessionState) -> int:
    repo = ensure_git_repository(workspace_root)
    check = run_process(["git", "diff", "--cached", "--quiet"], repo)
    if check.returncode == 0:
        print("[SKIP] Không có thay đổi nào đang được stage để commit.")
        return 0
    if check.returncode not in (0, 1):
        return check.returncode

    message = resolve_commit_message(state)
    if message is None:
        print("[SKIP] Đã hủy commit.")
        return 0
    completed = run_process(["git", "commit", "-m", message], repo)
    if completed.returncode != 0:
        return completed.returncode

    if message in state.commit_messages:
        state.commit_messages.remove(message)
    state.commit_messages.insert(0, message)
    del state.commit_messages[20:]

    if not prompt_yes_no("Commit thành công. Push branch hiện tại?", default=True):
        print("[SKIP] Commit đã tạo; chưa push.")
        return 0
    return action_git_push(repo, state)


def action_git_push(workspace_root: Path, _: MenuSessionState) -> int:
    repo = ensure_git_repository(workspace_root)
    branch_lines = git_lines(repo, ["branch", "--show-current"])
    if not branch_lines:
        raise TasksMenuError("Đang ở detached HEAD; không thể tự push branch hiện tại.")
    branch = branch_lines[0]
    upstream = run_process(
        ["git", "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
        repo,
        capture_output=True,
    )
    if upstream.returncode == 0:
        return run_process(["git", "push"], repo).returncode

    remotes = git_lines(repo, ["remote"])
    if not remotes:
        raise TasksMenuError("Repository chưa cấu hình remote.")
    remote = remotes[0]
    if len(remotes) > 1:
        selected = select_items(
            " CHỌN REMOTE ĐỂ PUSH ",
            [SelectionItem(value, value) for value in remotes],
        )
        if not selected:
            print("[SKIP] Đã hủy push.")
            return 0
        remote = selected[0]
    print(f"Branch chưa có upstream; sẽ chạy: git push -u {remote} {branch}")
    if not prompt_yes_no("Tiếp tục thiết lập upstream?", default=True):
        print("[SKIP] Đã hủy push.")
        return 0
    return run_process(["git", "push", "-u", remote, branch], repo).returncode


def action_git_switch(workspace_root: Path, _: MenuSessionState) -> int:
    repo = ensure_git_repository(workspace_root)
    source = select_items(
        " CHỌN NGUỒN BRANCH ",
        [
            SelectionItem("Local branch", "local"),
            SelectionItem("Remote branch", "remote"),
        ],
    )
    if not source:
        print("[SKIP] Đã hủy switch branch.")
        return 0

    if source[0] == "local":
        current_lines = git_lines(repo, ["branch", "--show-current"])
        current = current_lines[0] if current_lines else ""
        branches = git_lines(
            repo,
            ["for-each-ref", "--sort=refname", "--format=%(refname:short)", "refs/heads/"],
        )
        items = [
            SelectionItem(f"{'* ' if branch == current else '  '}{branch}", branch)
            for branch in branches
        ]
        selected = select_items(" CHỌN LOCAL BRANCH ", items)
        if not selected:
            print("[SKIP] Đã hủy switch branch.")
            return 0
        return run_process(["git", "switch", selected[0]], repo).returncode

    remote_refs = git_lines(
        repo,
        ["for-each-ref", "--sort=refname", "--format=%(refname:short)", "refs/remotes/"],
    )
    remote_refs = [ref for ref in remote_refs if not ref.endswith("/HEAD")]
    selected = select_items(
        " CHỌN REMOTE BRANCH ",
        [SelectionItem(ref, ref) for ref in remote_refs],
    )
    if not selected:
        print("[SKIP] Đã hủy switch branch.")
        return 0
    remote_ref = selected[0]
    local_name = remote_ref.split("/", 1)[1] if "/" in remote_ref else remote_ref
    local_branches = set(
        git_lines(
            repo,
            ["for-each-ref", "--format=%(refname:short)", "refs/heads/"],
        )
    )
    if local_name in local_branches:
        print(f"[INFO] Local branch {local_name} đã tồn tại; switch sang branch này.")
        return run_process(["git", "switch", local_name], repo).returncode
    return run_process(["git", "switch", "--track", remote_ref], repo).returncode


def safe_zip_member(path: str) -> str:
    normalized = PurePosixPath(path.replace("\\", "/"))
    if normalized.is_absolute() or ".." in normalized.parts:
        raise TasksMenuError(f"Đường dẫn Git không an toàn để đưa vào ZIP: {path}")
    return normalized.as_posix()


def action_zip_staged(workspace_root: Path, _: MenuSessionState) -> int:
    repo = ensure_git_repository(workspace_root)
    changed = git_z_paths(
        repo,
        ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMRTUXB"],
    )
    deleted = git_z_paths(
        repo,
        ["diff", "--cached", "--name-only", "-z", "--diff-filter=D"],
    )
    if not changed and not deleted:
        print("[SKIP] Không có staged changes để tạo ZIP.")
        return 0

    output_root = repo / ("patchs/staged_changes" if (repo / "patchs").is_dir() else "staged_changes")
    output_root.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output = output_root / f"{repo.name}_staged_changes_{timestamp}.zip"
    staged_diff = run_process(
        ["git", "diff", "--cached", "--binary", "--full-index"],
        repo,
        capture_output=True,
        text=False,
    )
    if staged_diff.returncode != 0:
        raise TasksMenuError("Không thể đọc staged diff.")

    manifest: dict[str, Any] = {
        "repository": str(repo),
        "created_at": datetime.now().astimezone().isoformat(),
        "staged_files": changed,
        "deleted_files": deleted,
    }
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in changed:
            member = safe_zip_member(path)
            blob = run_process(
                ["git", "show", f":{path}"],
                repo,
                capture_output=True,
                text=False,
            )
            if blob.returncode != 0:
                raise TasksMenuError(f"Không đọc được nội dung staged của: {path}")
            archive.writestr(member, blob.stdout)
        archive.writestr("_git_staged_changes/staged.diff", staged_diff.stdout)
        archive.writestr(
            "_git_staged_changes/manifest.json",
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        )
        if deleted:
            archive.writestr(
                "_git_staged_changes/deleted_files.txt",
                "\n".join(deleted) + "\n",
            )
    print(f"[OK] Đã tạo ZIP staged changes: {output}")
    print(f"     Files: {len(changed)}, deleted: {len(deleted)}")
    return 0


ACTION_HANDLERS = {
    "git_add": action_git_add,
    "git_commit": action_git_commit,
    "git_push": action_git_push,
    "git_switch": action_git_switch,
    "zip_staged": action_zip_staged,
}


def execute_internal_action(
    action: str,
    workspace_root: Path,
    state: MenuSessionState,
) -> int:
    handler = ACTION_HANDLERS.get(action)
    if handler is None:
        raise TasksMenuError(f"Hành động nội bộ không được hỗ trợ: {action}")
    return handler(workspace_root, state)


def run_task(
    task: dict[str, Any],
    workspace_root: Path,
    *,
    wait_after: bool = True,
    session_state: MenuSessionState | None = None,
) -> int:
    label = str(task["label"])
    command = expand_variables(str(task["command"]), workspace_root)
    args = task_args(task, workspace_root)
    cwd = task_cwd(task, workspace_root)
    env = task_environment(task, workspace_root)
    task_type = str(task.get("type", "shell")).lower()

    presentation = task.get("presentation", {})
    should_clear = isinstance(presentation, dict) and presentation.get("clear") is True

    if should_clear:
        print("\033[2J\033[H", end="", flush=True)

    print("=" * 78)
    print(f"Task       : {label}")
    print(f"Thư mục    : {cwd}")
    print(f"Lệnh       : {command_preview(task, workspace_root)}")
    print(f"Mô tả      : {task_description(task)}")
    print("=" * 78)
    print()

    if not cwd.is_dir():
        print(f"Lỗi: thư mục chạy không tồn tại: {cwd}", file=sys.stderr)
        if wait_after:
            wait_for_enter()
        return 1

    internal_action = str(task.get(INTERNAL_ACTION_FIELD, "")).strip()
    if internal_action:
        try:
            return_code = execute_internal_action(
                internal_action,
                cwd,
                session_state or MenuSessionState(),
            )
            print(f"\nTask kết thúc với mã trả về: {return_code}")
        except TasksMenuError as exc:
            return_code = 2
            print(f"\nLỗi: {exc}", file=sys.stderr)
        except KeyboardInterrupt:
            return_code = 130
            print("\nĐã dừng task bằng Ctrl+C.")
        if wait_after:
            wait_for_enter()
        return return_code

    try:
        if task_type == "process":
            argv = [command, *args]
            completed = subprocess.run(argv, cwd=cwd, env=env, check=False)
        else:
            full_command = command
            if args:
                full_command = f"{full_command} {shlex.join(args)}"

            completed = subprocess.run(
                full_command,
                shell=True,
                executable=shell_executable(task, workspace_root),
                cwd=cwd,
                env=env,
                check=False,
            )

        return_code = completed.returncode
        print(f"\nTask kết thúc với mã trả về: {return_code}")
    except KeyboardInterrupt:
        return_code = 130
        print("\nĐã dừng task bằng Ctrl+C.")
    except FileNotFoundError as exc:
        return_code = 127
        print(f"\nKhông thể chạy task: {exc}", file=sys.stderr)
    except OSError as exc:
        return_code = 1
        print(f"\nLỗi khi chạy task: {exc}", file=sys.stderr)

    if wait_after:
        wait_for_enter()
    return return_code


def draw_menu(
    screen: curses.window,
    tasks: list[dict[str, Any]],
    selected: int,
    first_visible: int,
    tasks_file: Path,
    workspace_root: Path,
) -> tuple[int, int, int]:
    del tasks_file  # File vẫn được reload nhưng không chiếm dòng trong tiêu đề.
    screen.erase()
    height, width = screen.getmaxyx()

    title = " VS CODE TASKS "
    full_help = "↑/↓/←/→: chọn   Enter: chạy   r: reload   Home/End: đầu/cuối   q/Esc: thoát"
    compact_help = "↑↓←→: chọn | Enter: chạy | r: reload | Home/End | q/Esc: thoát"
    help_text = full_help if width > len(full_help) else compact_help

    labels = [str(task["label"]) for task in tasks] + [EXIT_LABEL]
    longest_label_width = max((len(label) for label in labels), default=len(EXIT_LABEL))
    required_width = max(50, longest_label_width + 3, len(compact_help) + 1)

    selected_task = tasks[selected] if selected < len(tasks) else None
    content_width = max(10, width - 1)
    preview_lines = build_preview_lines(selected_task, workspace_root, content_width)

    list_top = 1
    footer_height = 1 + len(preview_lines) + 1  # divider + preview + help
    minimum_list_rows = min(3, max(1, len(labels)))
    required_height = list_top + footer_height + minimum_list_rows

    if width < required_width or height < required_height:
        message = terminal_size_message(width, height, required_width, required_height)
        try:
            screen.addnstr(0, 0, title, max(1, width - 1), curses.A_BOLD)
            for row, line in enumerate(textwrap.wrap(message, width=max(10, width - 1)), start=1):
                if row >= height:
                    break
                screen.addnstr(row, 0, line, max(1, width - 1), curses.A_BOLD)
        except curses.error:
            pass
        screen.refresh()
        return first_visible, 1, 1

    try:
        screen.addnstr(0, 0, title, width - 1, curses.A_BOLD)
    except curses.error:
        pass

    divider_row = height - footer_height
    list_height = max(1, divider_row - list_top)
    item_count = len(labels)
    columns = choose_menu_columns(
        item_count,
        list_height,
        width - 1,
        longest_label_width,
    )

    if columns > 1:
        first_visible = 0
        column_width = (width - 1) // columns
        for item_index, label in enumerate(labels):
            row = item_index // columns
            column = item_index % columns
            if row >= list_height:
                break

            marker = "› " if item_index == selected else "  "
            text = (marker + label).ljust(max(1, column_width - 1))
            attr = (
                curses.A_REVERSE | curses.A_BOLD
                if item_index == selected
                else curses.A_NORMAL
            )
            try:
                screen.addnstr(
                    list_top + row,
                    column * column_width,
                    text,
                    max(1, column_width - 1),
                    attr,
                )
            except curses.error:
                pass
    else:
        if selected < first_visible:
            first_visible = selected
        elif selected >= first_visible + list_height:
            first_visible = selected - list_height + 1

        max_first = max(0, item_count - list_height)
        first_visible = min(max(0, first_visible), max_first)

        for row_offset in range(list_height):
            item_index = first_visible + row_offset
            if item_index >= item_count:
                break

            label = labels[item_index]
            marker = "› " if item_index == selected else "  "
            text = marker + label
            attr = (
                curses.A_REVERSE | curses.A_BOLD
                if item_index == selected
                else curses.A_NORMAL
            )
            try:
                screen.addnstr(list_top + row_offset, 0, text, width - 1, attr)
            except curses.error:
                pass

    try:
        screen.hline(
            divider_row,
            0,
            getattr(curses, "ACS_HLINE", ord("-")),
            max(1, width - 1),
        )
    except curses.error:
        pass

    preview_start = divider_row + 1
    for offset, text in enumerate(preview_lines):
        try:
            screen.addnstr(preview_start + offset, 0, text, width - 1)
        except curses.error:
            pass

    # Dòng phím tắt nằm ngay sau mô tả; không còn vùng footer rỗng cố định.
    help_row = preview_start + len(preview_lines)
    try:
        screen.addnstr(help_row, 0, help_text, width - 1, curses.A_DIM)
    except curses.error:
        pass

    screen.refresh()
    return first_visible, columns, list_height


def menu_loop(
    screen: curses.window,
    tasks: list[dict[str, Any]],
    tasks_file: Path,
    workspace_root: Path,
) -> None:
    curses.curs_set(0)
    screen.keypad(True)
    screen.timeout(-1)

    selected = 0
    first_visible = 0
    session_state = MenuSessionState()

    while True:
        item_count = len(tasks) + 1
        selected = min(max(0, selected), item_count - 1)
        first_visible, columns, list_height = draw_menu(
            screen,
            tasks,
            selected,
            first_visible,
            tasks_file,
            workspace_root,
        )
        key = screen.getch()

        if key in (curses.KEY_UP, ord("k")):
            if columns > 1:
                candidate = selected - columns
                if candidate >= 0:
                    selected = candidate
            else:
                selected = (selected - 1) % item_count
        elif key in (curses.KEY_DOWN, ord("j")):
            if columns > 1:
                candidate = selected + columns
                if candidate < item_count:
                    selected = candidate
            else:
                selected = (selected + 1) % item_count
        elif key == curses.KEY_LEFT:
            if columns > 1 and selected % columns > 0:
                selected -= 1
        elif key == curses.KEY_RIGHT:
            if columns > 1 and selected % columns < columns - 1:
                candidate = selected + 1
                if candidate < item_count:
                    selected = candidate
        elif key == curses.KEY_HOME:
            selected = 0
        elif key == curses.KEY_END:
            selected = item_count - 1
        elif key == curses.KEY_PPAGE:
            selected = max(0, selected - max(1, list_height * columns))
        elif key == curses.KEY_NPAGE:
            selected = min(item_count - 1, selected + max(1, list_height * columns))
        elif key in (ord("r"), ord("R")):
            try:
                tasks, selected = reload_tasks_preserving_selection(
                    tasks_file, tasks, selected
                )
                first_visible = 0
            except TasksMenuError as exc:
                curses.def_prog_mode()
                curses.endwin()
                try:
                    print(f"[WARN] Reload tasks.json thất bại: {exc}", file=sys.stderr)
                    wait_for_enter()
                finally:
                    curses.reset_prog_mode()
                    curses.curs_set(0)
                    screen.keypad(True)
                    curses.flushinp()
                    screen.clear()
                    screen.refresh()
        elif key in (ord("q"), ord("Q"), 27):
            return
        elif key in (curses.KEY_ENTER, 10, 13):
            if selected == len(tasks):
                return

            # Tạm đóng curses để task dùng terminal bình thường.
            curses.def_prog_mode()
            curses.endwin()
            try:
                run_task(
                    tasks[selected],
                    workspace_root,
                    wait_after=False,
                    session_state=session_state,
                )
                try:
                    tasks, selected = reload_tasks_preserving_selection(
                        tasks_file, tasks, selected
                    )
                    print(f"[OK] Đã tự động reload {len(tasks)} task sau khi chạy.")
                except TasksMenuError as exc:
                    print(f"[WARN] Reload tasks.json thất bại: {exc}", file=sys.stderr)
                wait_for_enter()
            finally:
                curses.reset_prog_mode()
                curses.curs_set(0)
                screen.keypad(True)
                curses.flushinp()
                screen.clear()
                screen.refresh()


def parse_arguments(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Menu tasks.json và các hành động Git tương tác."
    )
    parser.add_argument(
        "tasks_path",
        nargs="?",
        help="Đường dẫn tasks.json hoặc workspace chứa .vscode/tasks.json.",
    )
    parser.add_argument(
        "--action",
        choices=["git-add", "git-commit", "git-push", "git-switch", "zip-staged"],
        help="Chạy trực tiếp một hành động thay vì mở menu task.",
    )
    parser.add_argument(
        "--workspace",
        help="Workspace/Git repository dùng cho --action; mặc định là thư mục hiện tại.",
    )
    return parser.parse_args(list(argv))


def main() -> int:
    try:
        locale.setlocale(locale.LC_ALL, "")
    except locale.Error:
        pass

    arguments = parse_arguments(sys.argv[1:])
    action_map = {
        "git-add": "git_add",
        "git-commit": "git_commit",
        "git-push": "git_push",
        "git-switch": "git_switch",
        "zip-staged": "zip_staged",
    }

    try:
        if arguments.action:
            workspace = Path(arguments.workspace or Path.cwd()).expanduser().resolve()
            return execute_internal_action(
                action_map[arguments.action], workspace, MenuSessionState()
            )

        if not sys.stdin.isatty() or not sys.stdout.isatty():
            print("Lỗi: chương trình cần chạy trong terminal tương tác.", file=sys.stderr)
            return 1

        tasks_file = find_tasks_file(arguments.tasks_path)
        added = ensure_builtin_tasks(tasks_file)
        if added:
            print("[OK] Đã tự động bổ sung task còn thiếu: " + ", ".join(added))
        tasks = load_tasks(tasks_file)
        workspace_root = workspace_root_for(tasks_file)
        curses.wrapper(menu_loop, tasks, tasks_file, workspace_root)
        return 0
    except TasksMenuError as exc:
        print(f"Lỗi: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("\nĐã thoát.")
        return 130
    except curses.error as exc:
        print(f"Lỗi giao diện terminal: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
