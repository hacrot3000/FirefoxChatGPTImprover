#!/usr/bin/env python3
"""
Hiển thị menu terminal để chọn và chạy các lệnh trong .vscode/tasks.json.

Cách dùng:
    ./vscode_tasks_menu.py
    ./vscode_tasks_menu.py /duong/dan/toi/.vscode/tasks.json

Phím điều khiển:
    ↑ / ↓       Di chuyển
    Enter       Chạy task
    Home / End  Đầu / cuối danh sách
    q / Esc     Thoát
"""

from __future__ import annotations

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
from pathlib import Path
from typing import Any


EXIT_LABEL = "Thoát"


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


def run_task(task: dict[str, Any], workspace_root: Path) -> int:
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
    print("=" * 78)
    print()

    if not cwd.is_dir():
        print(f"Lỗi: thư mục chạy không tồn tại: {cwd}", file=sys.stderr)
        wait_for_enter()
        return 1

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

    wait_for_enter()
    return return_code


def draw_menu(
    screen: curses.window,
    tasks: list[dict[str, Any]],
    selected: int,
    first_visible: int,
    tasks_file: Path,
    workspace_root: Path,
) -> int:
    screen.erase()
    height, width = screen.getmaxyx()

    if height < 8 or width < 30:
        message = "Cửa sổ terminal quá nhỏ. Hãy phóng to terminal."
        try:
            screen.addnstr(0, 0, message, max(1, width - 1))
        except curses.error:
            pass
        screen.refresh()
        return first_visible

    title = " VS CODE TASKS "
    subtitle = f"File: {tasks_file}"
    help_text = "↑/↓: chọn   Enter: chạy   Home/End: đầu/cuối   q/Esc: thoát"

    try:
        screen.addnstr(0, 0, title, width - 1, curses.A_BOLD)
        screen.addnstr(1, 0, subtitle, width - 1)
        screen.hline(2, 0, curses.ACS_HLINE, max(1, width - 1))
    except curses.error:
        pass

    item_count = len(tasks) + 1
    list_top = 3
    preview_height = 4
    list_height = max(1, height - list_top - preview_height)

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

        if item_index < len(tasks):
            label = str(tasks[item_index]["label"])
            prefix = "  "
        else:
            label = EXIT_LABEL
            prefix = "  "

        marker = "› " if item_index == selected else prefix
        text = marker + label
        attr = curses.A_REVERSE | curses.A_BOLD if item_index == selected else curses.A_NORMAL

        try:
            screen.addnstr(list_top + row_offset, 0, text, width - 1, attr)
        except curses.error:
            pass

    divider_row = height - preview_height
    try:
        screen.hline(divider_row, 0, curses.ACS_HLINE, max(1, width - 1))
    except curses.error:
        pass

    if selected < len(tasks):
        selected_task = tasks[selected]
        preview = command_preview(selected_task, workspace_root)
        cwd = task_cwd(selected_task, workspace_root)
        preview_lines = [
            f"Lệnh: {preview}",
            f"Tại:  {cwd}",
        ]
    else:
        preview_lines = ["Thoát khỏi chương trình.", ""]

    for offset, text in enumerate(preview_lines, start=1):
        try:
            screen.addnstr(divider_row + offset, 0, text, width - 1)
        except curses.error:
            pass

    try:
        screen.addnstr(height - 1, 0, help_text, width - 1, curses.A_DIM)
    except curses.error:
        pass

    screen.refresh()
    return first_visible


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
    item_count = len(tasks) + 1

    while True:
        first_visible = draw_menu(
            screen,
            tasks,
            selected,
            first_visible,
            tasks_file,
            workspace_root,
        )
        key = screen.getch()

        if key in (curses.KEY_UP, ord("k")):
            selected = (selected - 1) % item_count
        elif key in (curses.KEY_DOWN, ord("j")):
            selected = (selected + 1) % item_count
        elif key == curses.KEY_HOME:
            selected = 0
        elif key == curses.KEY_END:
            selected = item_count - 1
        elif key == curses.KEY_PPAGE:
            selected = max(0, selected - max(1, screen.getmaxyx()[0] - 7))
        elif key == curses.KEY_NPAGE:
            selected = min(item_count - 1, selected + max(1, screen.getmaxyx()[0] - 7))
        elif key in (ord("q"), ord("Q"), 27):
            return
        elif key in (curses.KEY_ENTER, 10, 13):
            if selected == len(tasks):
                return

            # Tạm đóng curses để task dùng terminal bình thường.
            curses.def_prog_mode()
            curses.endwin()
            try:
                run_task(tasks[selected], workspace_root)
            finally:
                curses.reset_prog_mode()
                curses.curs_set(0)
                screen.keypad(True)
                curses.flushinp()
                screen.clear()
                screen.refresh()


def main() -> int:
    try:
        locale.setlocale(locale.LC_ALL, "")
    except locale.Error:
        pass

    if not sys.stdin.isatty() or not sys.stdout.isatty():
        print("Lỗi: chương trình cần chạy trong terminal tương tác.", file=sys.stderr)
        return 1

    argument = sys.argv[1] if len(sys.argv) >= 2 else None

    try:
        tasks_file = find_tasks_file(argument)
        tasks = load_tasks(tasks_file)
        workspace_root = workspace_root_for(tasks_file)
        curses.wrapper(menu_loop, tasks, tasks_file, workspace_root)
        return 0
    except TasksMenuError as exc:
        print(f"Lỗi: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nĐã thoát.")
        return 130
    except curses.error as exc:
        print(f"Lỗi giao diện terminal: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
