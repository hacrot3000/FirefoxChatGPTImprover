#!/usr/bin/env python3
"""Interactive multi-select patch queue selector for Python Patch Tool v5.16."""
from __future__ import annotations

import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

TOOL_VERSION = "5.16.0"


@dataclass
class PatchSelectionResult:
    selected: list[Path]
    remaining: list[Path]
    deleted: list[str]
    cancelled: bool = False


def parse_selection_expression(text: str, item_count: int) -> set[int]:
    """Parse 1-based selections such as ``1,3-5`` into zero-based indices."""
    value = text.strip().lower()
    if value in {"a", "all"}:
        return set(range(item_count))
    if value in {"n", "none", ""}:
        return set()
    selected: set[int] = set()
    for token in re.split(r"[\s,;]+", value):
        if not token:
            continue
        match = re.fullmatch(r"(\d+)(?:-(\d+))?", token)
        if not match:
            raise ValueError(f"invalid selection token: {token!r}")
        start = int(match.group(1))
        end = int(match.group(2) or start)
        if start > end:
            start, end = end, start
        if start < 1 or end > item_count:
            raise ValueError(f"selection out of range: {token!r}; valid range is 1-{item_count}")
        selected.update(range(start - 1, end))
    return selected


def _display_name(path: Path, project_root: Path) -> str:
    try:
        return path.resolve().relative_to(project_root.resolve()).as_posix()
    except Exception:
        return path.name


def _selector_color(text: str, *codes: str) -> str:
    if not sys.stdout.isatty() or os.environ.get("NO_COLOR"):
        return text
    return f"\x1b[{';'.join(codes)}m{text}\x1b[0m" if codes else text


def _skipped_label(row: dict) -> str:
    category = str(row.get("category") or "skipped").strip().lower()
    labels = {
        "duplicate_success": "DUPLICATE - ALREADY PASS",
        "foreign_project": "FOREIGN PROJECT",
        "non_patch": "NOT A PATCH",
        "missing_project_key": "MISSING PROJECT KEY",
        "user_deleted": "USER DELETED",
    }
    return labels.get(category, category.replace("_", " ").upper())


def _render_skipped_before_selection(skipped_before: list[dict]) -> None:
    if not skipped_before:
        return
    sys.stdout.write("\n")
    sys.stdout.write(_selector_color(f"TỰ ĐỘNG BỎ QUA TRƯỚC KHI CHỌN ({len(skipped_before)})", "1", "93") + "\n")
    for row in skipped_before:
        label = _skipped_label(row)
        item = str(row.get("input") or "(unknown)")
        sys.stdout.write(_selector_color(f"  [SKIPPED:{label}]", "93") + f" {item}\n")
        reason = str(row.get("reason") or "").strip()
        if reason:
            sys.stdout.write(f"      Lý do: {reason}\n")
        moved = str(row.get("moved_to") or "").strip()
        if moved:
            sys.stdout.write(f"      Đã chuyển tới: {moved}\n")
    sys.stdout.write("  Các file trên không còn nằm trong danh sách có thể chọn ở lượt này.\n")


def _delete_path(path: Path, project_root: Path) -> None:
    queue_root = (project_root / "patchs").resolve()
    if path.parent.resolve() != queue_root:
        raise OSError(f"refusing to delete file outside patchs/ queue root: {path}")
    if path.is_symlink() or path.is_file():
        path.unlink()
        return
    raise OSError(f"refusing to delete non-file queue item: {path}")


def _remap_selection_after_delete(selected: set[int], deleted_index: int) -> set[int]:
    result: set[int] = set()
    for index in selected:
        if index == deleted_index:
            continue
        result.add(index - 1 if index > deleted_index else index)
    return result


def _read_key_posix() -> str:
    import termios
    import tty

    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    try:
        tty.setraw(fd)
        first = os.read(fd, 1)
        if first == b"\x1b":
            import select
            ready, _, _ = select.select([fd], [], [], 0.08)
            if not ready:
                return "ESC"
            second = os.read(fd, 1)
            if second == b"[":
                ready, _, _ = select.select([fd], [], [], 0.08)
                if not ready:
                    return "ESC"
                third = os.read(fd, 1)
                return {b"A": "UP", b"B": "DOWN", b"C": "RIGHT", b"D": "LEFT"}.get(third, "ESC")
            return "ESC"
        if first in {b"\r", b"\n"}:
            return "ENTER"
        if first == b" ":
            return "SPACE"
        if first == b"\x03":
            return "CTRL_C"
        return first.decode("utf-8", errors="ignore")
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)


def _read_key_windows() -> str:
    import msvcrt

    first = msvcrt.getwch()
    if first in {"\x00", "\xe0"}:
        second = msvcrt.getwch()
        return {"H": "UP", "P": "DOWN", "K": "LEFT", "M": "RIGHT"}.get(second, "")
    if first in {"\r", "\n"}:
        return "ENTER"
    if first == " ":
        return "SPACE"
    if first == "\x1b":
        return "ESC"
    if first == "\x03":
        return "CTRL_C"
    return first


def _read_key() -> str:
    return _read_key_windows() if os.name == "nt" else _read_key_posix()


def _render_selector(
    names: list[str], cursor: int, selected: set[int], *, skipped_before: Optional[list[dict]] = None,
    message: str = "", confirm_delete: bool = False,
) -> None:
    sys.stdout.write("\x1b[2J\x1b[H")
    sys.stdout.write("CHỌN PATCH SẼ CHẠY\n\n")
    if not names:
        sys.stdout.write("  (không còn patch trong danh sách)\n")
    for index, name in enumerate(names):
        pointer = "›" if index == cursor else " "
        mark = "x" if index in selected else " "
        sys.stdout.write(f"{pointer} [{mark}] {index + 1:>3}. {name}\n")
    _render_skipped_before_selection(list(skipped_before or []))
    sys.stdout.write("\nSpace: chọn/bỏ | ↑/↓: di chuyển | a: tất cả | n: bỏ tất cả\n")
    sys.stdout.write("d: xóa patch tại con trỏ | Enter: xác nhận | q/Esc: hủy\n")
    sys.stdout.write(f"Đã chọn: {len(selected)}/{len(names)}")
    if confirm_delete:
        sys.stdout.write(" | XÓA VĨNH VIỄN patch này? nhấn y để xác nhận, phím khác để hủy")
    elif message:
        sys.stdout.write(f" | {message}")
    sys.stdout.write("\n")
    sys.stdout.flush()


def _tty_select(items: list[Path], project_root: Path, initial: set[int], skipped_before: Optional[list[dict]] = None) -> PatchSelectionResult:
    working = list(items)
    names = [_display_name(path, project_root) for path in working]
    selected = set(initial)
    deleted: list[str] = []
    cursor = 0
    message = ""
    confirm_delete = False
    try:
        sys.stdout.write("\x1b[?25l")
        sys.stdout.flush()
        while True:
            if not working:
                _render_selector(names, 0, set(), skipped_before=skipped_before, message="Tất cả patch đã bị xóa.")
                return PatchSelectionResult(selected=[], remaining=[], deleted=deleted, cancelled=False)
            cursor = max(0, min(cursor, len(working) - 1))
            _render_selector(names, cursor, selected, skipped_before=skipped_before, message=message, confirm_delete=confirm_delete)
            message = ""
            key = _read_key()
            lower = key.lower() if len(key) == 1 else key
            if confirm_delete:
                if lower == "y":
                    target = working[cursor]
                    display = names[cursor]
                    try:
                        _delete_path(target, project_root)
                    except Exception as exc:
                        message = f"Không thể xóa {display}: {exc}"
                    else:
                        deleted.append(display)
                        selected = _remap_selection_after_delete(selected, cursor)
                        working.pop(cursor)
                        names.pop(cursor)
                        if working:
                            cursor = min(cursor, len(working) - 1)
                        message = f"Đã xóa: {display}"
                else:
                    message = "Đã hủy xóa."
                confirm_delete = False
                continue
            if key == "UP":
                cursor = (cursor - 1) % len(working)
            elif key == "DOWN":
                cursor = (cursor + 1) % len(working)
            elif key == "SPACE":
                if cursor in selected:
                    selected.remove(cursor)
                else:
                    selected.add(cursor)
            elif lower == "a":
                selected = set(range(len(working)))
            elif lower == "n":
                selected.clear()
            elif lower == "d":
                confirm_delete = True
            elif key == "ENTER":
                if not selected:
                    message = "Chưa chọn patch nào. Dùng Space hoặc a để chọn."
                    continue
                return PatchSelectionResult(
                    selected=[working[index] for index in sorted(selected)],
                    remaining=list(working),
                    deleted=deleted,
                    cancelled=False,
                )
            elif lower == "q" or key in {"ESC", "CTRL_C"}:
                return PatchSelectionResult(selected=[], remaining=list(working), deleted=deleted, cancelled=True)
    finally:
        sys.stdout.write("\x1b[?25h")
        sys.stdout.flush()


def _print_line_inventory(working: list[Path], project_root: Path, current: set[int], skipped_before: Optional[list[dict]] = None) -> None:
    print("Available patch files/packages:\n")
    for index, path in enumerate(working, 1):
        mark = "x" if index - 1 in current else " "
        print(f"{index:>3}. [{mark}] {_display_name(path, project_root)}")
    _render_skipped_before_selection(list(skipped_before or []))
    print("\nNhập số/range, ví dụ 1,3-5; 'a' chọn tất cả; 'n' bỏ tất cả; 'q' hủy.")
    print("Xóa ngay trong danh sách: d 2   hoặc   d 1,3-5")


def _line_select(items: list[Path], project_root: Path, initial: set[int], skipped_before: Optional[list[dict]] = None) -> PatchSelectionResult:
    working = list(items)
    current = set(initial)
    deleted: list[str] = []
    while True:
        if not working:
            print("No patch remains in the queue after deletion.")
            return PatchSelectionResult(selected=[], remaining=[], deleted=deleted, cancelled=False)
        _print_line_inventory(working, project_root, current, skipped_before=skipped_before)
        try:
            value = input("Choose patch(es): ").strip()
        except EOFError:
            print("ERROR: patch selection requires input. Use --all or configure automation.zero_argument.selection='all' for non-interactive runs.", file=sys.stderr)
            return PatchSelectionResult(selected=[], remaining=list(working), deleted=deleted, cancelled=True)
        lower = value.lower()
        if lower in {"q", "quit"}:
            return PatchSelectionResult(selected=[], remaining=list(working), deleted=deleted, cancelled=True)
        if lower.startswith("d ") or lower.startswith("delete "):
            expr = value.split(None, 1)[1].strip()
            try:
                targets = parse_selection_expression(expr, len(working))
            except ValueError as exc:
                print(f"Invalid delete selection: {exc}")
                continue
            if not targets:
                print("No patch selected for deletion.")
                continue
            names = [_display_name(working[index], project_root) for index in sorted(targets)]
            print("Delete permanently:")
            for name in names:
                print(f"  - {name}")
            answer = input("Confirm permanent deletion? [y/N]: ").strip().lower()
            if answer not in {"y", "yes"}:
                print("Deletion cancelled.")
                continue
            for index in sorted(targets, reverse=True):
                path = working[index]
                display = _display_name(path, project_root)
                try:
                    _delete_path(path, project_root)
                except Exception as exc:
                    print(f"Could not delete {display}: {exc}")
                    continue
                deleted.append(display)
                working.pop(index)
            current.clear()
            continue
        try:
            current = parse_selection_expression(value, len(working))
        except ValueError as exc:
            print(f"Invalid selection: {exc}")
            continue
        if not current:
            print("No patch selected. Enter one or more numbers, or 'a' for all.")
            continue
        return PatchSelectionResult(
            selected=[working[index] for index in sorted(current)],
            remaining=list(working),
            deleted=deleted,
            cancelled=False,
        )


def select_patch_items(
    items: list[Path],
    project_root: Path,
    *,
    initial_selection: str = "none",
    force_line_mode: bool = False,
    skipped_before: Optional[list[dict]] = None,
) -> PatchSelectionResult:
    if not items:
        return PatchSelectionResult(selected=[], remaining=[], deleted=[], cancelled=False)
    initial = set(range(len(items))) if initial_selection == "all" else set()
    use_tty = not force_line_mode and sys.stdin.isatty() and sys.stdout.isatty()
    return _tty_select(items, project_root, initial, skipped_before=skipped_before) if use_tty else _line_select(items, project_root, initial, skipped_before=skipped_before)
