#!/usr/bin/env python3
"""Collect BleToNfc source snapshots for ChatGPT/code review.

Two subcommands are intentionally exposed through root shell wrappers:
  ./zip_modules.sh          -> collect_code.py modules
  ./zip_staged_changes.sh   -> collect_code.py changes

The implementation is Python so path handling, exact staged content, and future
extension rules are easier to maintain than duplicated shell regexes.
"""

from __future__ import annotations

import argparse
import fnmatch
import os
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
import zipfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable, Sequence

# Source-like extensions that are useful for ChatGPT/code review.
# Keep this list broad but text-only. Notably includes .inc after the ESP32-C3
# refactor, plus CMake/Kconfig/CSV/YAML/TOML config files.
DEFAULT_EXTS = {
    "c", "h", "cpp", "hpp", "cc", "hh", "cxx", "hxx", "s", "S",
    "inc", "inl",
    "py", "sh", "bash",
    "java", "kt", "kts", "gradle", "properties", "pro",
    "xml", "json", "jsonl", "yaml", "yml", "toml", "ini", "cfg", "conf",
    "cmake", "txt", "md", "rst", "csv",
    "nim", "php", "html", "css", "js", "ts",
    "pio", "ld", "map",
}

# Files without reliable extension, or whose extension alone is misleading.
SPECIAL_BASENAMES = {
    "CMakeLists.txt",
    "Makefile",
    "Kconfig",
    "Kconfig.projbuild",
    "sdkconfig",
    "sdkconfig.defaults",
    "sdkconfig.defaults.esp32c3",
    "partitions.csv",
    "dependencies.lock",
}

SPECIAL_SUFFIXES = (
    ".code-workspace",
    ".gradle",
)

# Generated/heavy paths that should not be sent to ChatGPT even if git sees them
# as untracked. Most build outputs are ignored already; this is a second guard.
EXCLUDED_PARTS = {
    ".git",
    ".idea",
    ".gradle",
    ".cxx",
    "build",
    "build_release",
    "build_lane_alpha_ota",
    "build_lane_beta_ota",
    "build_lane_alpha_ota_release",
    "build_lane_beta_ota_release",
    "build_full_image",
    "managed_components",
    "node_modules",
    "__pycache__",
    ".pytest_cache",
}

EXCLUDED_GLOBS = (
    "*.zip",
    "*.bin",
    "*.uf2",
    "*.elf",
    "*.o",
    "*.a",
    "*.so",
    "*.d",
    "*.pyc",
    "*.patch.bak",
    "modules_zip_*",
    "staged_changes_*",
    "all_diff.txt",
)

MODULE_DEFS = {
    "1": ("gate-rp2040", ["gate-rp2040/CMakeLists.txt", "gate-rp2040/src", "gate-rp2040/bootloader"], ["gate-rp2040/scripts", "gate-rp2040/script", "gate-rp2040/tools"]),
    "2": ("main-esp32c3", ["main-esp32c3/CMakeLists.txt", "main-esp32c3/main", "main-esp32c3/partitions.csv", "main-esp32c3/sdkconfig.defaults"], ["main-esp32c3/scripts", "main-esp32c3/script"]),
    "3": ("simulator-esp32", ["simulator-esp32/CMakeLists.txt", "simulator-esp32/main", "simulator-esp32/sdkconfig.defaults"], ["simulator-esp32/scripts", "simulator-esp32/script"]),
    "4": ("shared", ["shared"], ["shared/scripts", "shared/script"]),
    "5": ("tools", ["tools"], []),
    "6": ("android-ota-test-app", ["android-ota-test-app"], ["android-ota-test-app/scripts", "android-ota-test-app/script"]),
    "7": ("document", ["document"], []),
    "8": ("root helper files", ["README.md", "TODO.md", "ble_ota_menu.sh", "zip_modules.sh", "zip_staged_changes.sh", "build_and_flash_main.sh", "monitor.sh", "run_aider_promts.sh", "nfcPatch.code-workspace", ".vscode/tasks.json"], []),
    "9": ("mainpcb-nvs-tool", ["mainpcb-nvs-tool/CMakeLists.txt", "mainpcb-nvs-tool/main", "mainpcb-nvs-tool/partitions.csv", "mainpcb-nvs-tool/sdkconfig.defaults", "mainpcb-nvs-tool/README.md", "mainpcb-nvs-tool/FW/README.md"], ["mainpcb-nvs-tool/scripts", "mainpcb-nvs-tool/tools"]),
}

DEFAULT_MODULE_CHOICES = "1 2 3 4 5 6 7 8 9"


def run_git(args: Sequence[str], *, text: bool = True, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], check=check, text=text, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def git_root() -> Path:
    try:
        out = run_git(["rev-parse", "--show-toplevel"]).stdout.strip()
    except subprocess.CalledProcessError:
        print("ERROR: Không nằm trong git repository", file=sys.stderr)
        sys.exit(1)
    root = Path(out).resolve()
    os.chdir(root)
    return root


def git_dir() -> Path:
    return Path(run_git(["rev-parse", "--git-dir"]).stdout.strip()).resolve()


def timestamp() -> str:
    return datetime.now().strftime("%d_%m_%Y_%H_%M")


def load_prefs(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        v = v.strip().strip('"').strip("'")
        if k:
            out[k] = v
    return out


def save_prefs(path: Path, prefs: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [f'{k}="{v}"' for k, v in prefs.items()]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_exts(values: Sequence[str] | None) -> set[str]:
    if not values:
        return set(DEFAULT_EXTS)
    out: set[str] = set()
    for raw in values:
        for part in str(raw).split(","):
            ext = part.strip().lower().lstrip(".")
            ext = re.sub(r"[^a-z0-9_+.-]", "", ext)
            if ext:
                out.add(ext)
    return out


def has_allowed_ext(path: str, exts: set[str]) -> bool:
    name = Path(path).name
    lower = name.lower()
    if name in SPECIAL_BASENAMES:
        return True
    if any(lower.endswith(s) for s in SPECIAL_SUFFIXES):
        return True
    if "." not in name:
        return False
    ext = name.rsplit(".", 1)[1].lower()
    return ext in exts


def is_excluded(path: str) -> bool:
    p = Path(path)
    parts = set(p.parts)
    if parts & EXCLUDED_PARTS:
        return True
    # Only exclude build_* directories, not files whose name starts with build_
    if any(part.startswith("build_") for part in p.parts[:-1]):
        return True
    if "patchs" in p.parts and "backup" in p.parts:
        return True
    name = p.name
    for pat in EXCLUDED_GLOBS:
        if fnmatch.fnmatch(name, pat) or fnmatch.fnmatch(path, pat):
            return True
    return False


def unique_sorted(paths: Iterable[str]) -> list[str]:
    return sorted({p for p in paths if p})


def git_ls_files(paths: Sequence[str] | None = None) -> list[str]:
    cmd = ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]
    if paths:
        cmd.extend(["--", *paths])
    cp = run_git(cmd, text=False)
    raw = cp.stdout
    return [p.decode("utf-8", errors="replace") for p in raw.split(b"\0") if p]


def filter_source_files(paths: Iterable[str], exts: set[str]) -> list[str]:
    return unique_sorted(p for p in paths if not is_excluded(p) and has_allowed_ext(p, exts))


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def copy_current_file(root: Path, rel: str, dst_root: Path, *, convert_txt: bool = False) -> Path:
    src = root / rel
    dst_rel = Path(rel + (".txt" if convert_txt else ""))
    dst = dst_root / dst_rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    return dst


def materialize_git_index_file(rel: str, dst_root: Path, *, convert_txt: bool = False) -> Path:
    dst_rel = Path(rel + (".txt" if convert_txt else ""))
    dst = dst_root / dst_rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        data = subprocess.run(["git", "show", f":{rel}"], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout
    except subprocess.CalledProcessError:
        # Untracked files have no index blob; fall back to worktree.
        data = Path(rel).read_bytes()
    dst.write_bytes(data)
    return dst


def make_zip_from_dir(out: Path, base_dir: Path, rel_files: Sequence[str]) -> None:
    out = out.resolve()
    if out.exists():
        out.unlink()
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for rel in rel_files:
            path = base_dir / rel
            if path.exists() and path.is_file():
                zf.write(path, rel)


def print_file_list(files: Sequence[str], title: str = "Danh sách file") -> None:
    print(f"{title}:")
    for f in files:
        print(f" - {f}")


def maybe_cleanup(path: Path, *, keep: bool, delete: bool, noun: str) -> None:
    abs_path = path.resolve()
    if keep:
        print(f"Giữ lại {noun}: {abs_path}")
        return
    if delete:
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
        else:
            path.unlink(missing_ok=True)
        print(f"Đã xoá {noun}: {abs_path}")
        return
    if not sys.stdin.isatty():
        print(f"Non-interactive: giữ lại {noun}: {abs_path}")
        return
    print("\n------------------------------------------------")
    print("⚠️  XÁC NHẬN THAO TÁC TIẾP THEO:")
    print(f"👉 Ấn [ENTER] để XOÁ {noun} vừa tạo ra.")
    print(f"👉 Ấn [Ctrl+C] để THOÁT và giữ lại {noun}.")
    print("------------------------------------------------")
    try:
        input()
    except KeyboardInterrupt:
        print(f"\nGiữ lại {noun}: {abs_path}")
        return
    if path.is_dir():
        shutil.rmtree(path, ignore_errors=True)
    else:
        path.unlink(missing_ok=True)
    print(f"✅ Đã xoá: {abs_path}")


def resolve_module_paths(choices: str, include_scripts: bool) -> list[str]:
    cleaned = "".join(choices.split())
    paths: list[str] = []
    for ch in cleaned:
        mod = MODULE_DEFS.get(ch)
        if not mod:
            print(f"WARN: lựa chọn module không hợp lệ: {ch}")
            continue
        _name, base_paths, script_paths = mod
        paths.extend(base_paths)
        if include_scripts:
            paths.extend(script_paths)
    if include_scripts and "5" not in cleaned:
        paths.append("tools")
    out: list[str] = []
    for p in paths:
        if Path(p).exists():
            out.append(p)
    return unique_sorted(out)


def modules_interactive_defaults(root: Path) -> tuple[str, bool]:
    prefs_path = git_dir() / ".zip_modules.conf"
    prefs = load_prefs(prefs_path)
    default_choices = prefs.get("LAST_MODULE_CHOICES", DEFAULT_MODULE_CHOICES)
    default_scripts = prefs.get("LAST_ZIP_SCRIPTS", "y")

    print("================ CHỌN CÁC MODULE CẦN NÉN ================")
    for key in sorted(MODULE_DEFS.keys(), key=int):
        print(f"{key}. {MODULE_DEFS[key][0]}")
    print("=========================================================")
    choices = input(f"Nhập số module (ví dụ 123 hoặc 1 2 3, mặc định: {default_choices}): ").strip() or default_choices
    zip_scripts = input(f"Có nén scripts/tools không? (y/n, mặc định {default_scripts}): ").strip() or default_scripts
    include_scripts = zip_scripts.lower().startswith("y")

    prefs["LAST_MODULE_CHOICES"] = choices
    prefs["LAST_ZIP_SCRIPTS"] = "y" if include_scripts else "n"
    save_prefs(prefs_path, prefs)
    return choices, include_scripts


def cmd_modules(args: argparse.Namespace) -> int:
    root = git_root()
    exts = parse_exts(args.ext or args.legacy_exts)

    if args.all:
        scan_paths: list[str] | None = None
        desc = "toàn bộ repo"
    elif args.modules:
        scan_paths = resolve_module_paths(args.modules, not args.no_scripts)
        desc = "module " + args.modules
    elif args.legacy_exts:
        scan_paths = None
        desc = "đuôi mở rộng: " + ",".join(sorted(exts))
    elif sys.stdin.isatty():
        choices, include_scripts = modules_interactive_defaults(root)
        scan_paths = resolve_module_paths(choices, include_scripts)
        desc = "module " + choices
    else:
        scan_paths = resolve_module_paths(DEFAULT_MODULE_CHOICES, True)
        desc = "module mặc định"

    if scan_paths is not None and not scan_paths:
        print("ERROR: không có path hợp lệ để quét", file=sys.stderr)
        return 1

    print(f"Đang tìm file source ({desc})...")
    raw_files = git_ls_files(scan_paths)
    files = filter_source_files(raw_files, exts)
    if not files:
        print("Không tìm thấy file phù hợp.")
        return 0

    print_file_list(files, "Danh sách file sẽ nén")
    if args.list_only:
        print(f"\nTổng cộng: {len(files)} file")
        return 0

    out = Path(args.out or f"modules_zip_{timestamp()}.zip")
    if out.exists():
        out.unlink()
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            zf.write(root / f, f)
        manifest = "\n".join(files) + "\n"
        zf.writestr("_file_list.txt", manifest)
        zf.writestr("_collect_info.txt", f"mode=modules\ndesc={desc}\ncount={len(files)}\n")
    abs_path = out.resolve()
    print(f"\n📦 Đã nén {len(files)} file vào:")
    print(f"🔗 {abs_path}")
    maybe_cleanup(out, keep=args.keep, delete=args.delete, noun="file zip")
    return 0


def git_name_z(args: Sequence[str]) -> list[str]:
    cp = run_git(list(args), text=False, check=False)
    if cp.returncode not in (0, 1):
        raise subprocess.CalledProcessError(cp.returncode, ["git", *args], cp.stdout, cp.stderr)
    return [p.decode("utf-8", errors="replace") for p in cp.stdout.split(b"\0") if p]


def staged_files() -> list[str]:
    return git_name_z(["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"])


def unstaged_files() -> list[str]:
    return git_name_z(["diff", "--name-only", "-z", "--diff-filter=ACMR"])


def untracked_files() -> list[str]:
    return git_name_z(["ls-files", "-o", "--exclude-standard", "-z"])


def git_diff_text(source: str) -> str:
    if source == "staged":
        return run_git(["diff", "--staged"], check=False).stdout
    if source == "unstaged":
        return run_git(["diff"], check=False).stdout
    if source == "all":
        parts = [
            "===== STAGED DIFF =====\n",
            run_git(["diff", "--staged"], check=False).stdout,
            "\n===== UNSTAGED DIFF =====\n",
            run_git(["diff"], check=False).stdout,
        ]
        uts = untracked_files()
        if uts:
            parts.append("\n===== UNTRACKED FILES =====\n")
            parts.extend(f"{p}\n" for p in uts)
        return "".join(parts)
    raise ValueError(source)


def add_candidates_prompt() -> None:
    candidates = unique_sorted([*unstaged_files(), *untracked_files()])
    if not candidates or not sys.stdin.isatty():
        return
    print("Các file có thể add (untracked/modified):")
    print("0. Bỏ qua (không add)")
    print("A. Add TẤT CẢ (git add -A)")
    for idx, f in enumerate(candidates, 1):
        print(f"{idx}. {f}")
    choice = input("Nhập số (cách nhau bởi khoảng trắng) hoặc A (mặc định 0): ").strip()
    if not choice or choice == "0":
        return
    if choice.upper() == "A":
        subprocess.run(["git", "add", "-A"], check=True)
        print("Đã add tất cả file.")
        return
    for token in choice.split():
        if token.isdigit():
            i = int(token)
            if 1 <= i <= len(candidates):
                subprocess.run(["git", "add", candidates[i - 1]], check=True)
                print(f"Đã add: {candidates[i - 1]}")


def choose_changes_source(args: argparse.Namespace) -> str:
    explicit = [bool(args.staged), bool(args.unstaged), bool(args.all_changes)]
    if sum(explicit) > 1:
        raise SystemExit("ERROR: chỉ chọn một trong --staged/--unstaged/--all")
    if args.staged:
        return "staged"
    if args.unstaged:
        return "unstaged"
    if args.all_changes:
        return "all"

    has_staged = bool(staged_files())
    has_unstaged = bool(unstaged_files() or untracked_files())
    if has_staged and has_unstaged and sys.stdin.isatty():
        prefs_path = git_dir() / ".zip_staged_changes.conf"
        prefs = load_prefs(prefs_path)
        default = prefs.get("LAST_SRC_CHOICE", "1")
        print("Chọn nguồn file để xử lý:")
        print("1. Staged files (đã add, đúng nội dung index)")
        print("2. Unstaged/untracked files (chưa add)")
        print("3. All git status files")
        choice = input(f"Nhập lựa chọn (1/2/3, mặc định {default}): ").strip() or default
        prefs["LAST_SRC_CHOICE"] = choice
        save_prefs(prefs_path, prefs)
        return {"1": "staged", "2": "unstaged", "3": "all"}.get(choice, "staged")
    if has_unstaged and not has_staged:
        print("[Auto] Chỉ có unstaged/untracked files.")
        return "unstaged"
    print("[Auto] Chọn staged files.")
    return "staged"


def choose_changes_package(args: argparse.Namespace) -> tuple[str, bool, bool]:
    if args.zip_mode and args.copy_mode:
        raise SystemExit("ERROR: chỉ chọn một trong --zip/--copy")
    if args.zip_mode:
        return "zip", False, False
    if args.copy_mode:
        return "copy", args.convert_txt, args.merge
    if not sys.stdin.isatty():
        return "zip", False, False

    prefs_path = git_dir() / ".zip_staged_changes.conf"
    prefs = load_prefs(prefs_path)
    default_choice = prefs.get("LAST_CHOICE", "1")
    print("Chọn phương thức đóng gói:")
    print("1. Gửi dạng nén ZIP")
    print("2. Gửi dạng thư mục tạm /tmp + diff")
    choice = input(f"Nhập lựa chọn (1/2, mặc định {default_choice}): ").strip() or default_choice
    prefs["LAST_CHOICE"] = choice

    convert = False
    merge = False
    if choice == "2":
        default_convert = prefs.get("LAST_CONVERT_TXT", "n")
        c = input(f"Có convert source sang .txt không? (y/n, mặc định {default_convert}): ").strip() or default_convert
        convert = c.lower().startswith("y")
        prefs["LAST_CONVERT_TXT"] = "y" if convert else "n"
        if convert:
            default_merge = prefs.get("LAST_MERGE_ALL", "y")
            m = input(f"Có gom toàn bộ thành 1 file không? (y/n, mặc định {default_merge}): ").strip() or default_merge
            merge = m.lower().startswith("y")
            prefs["LAST_MERGE_ALL"] = "y" if merge else "n"
    save_prefs(prefs_path, prefs)
    return ("copy" if choice == "2" else "zip"), convert, merge


def collect_change_files(source: str, exts: set[str]) -> list[str]:
    if source == "staged":
        raw = staged_files()
    elif source == "unstaged":
        raw = [*unstaged_files(), *untracked_files()]
    elif source == "all":
        raw = [*staged_files(), *unstaged_files(), *untracked_files()]
    else:
        raise ValueError(source)
    return filter_source_files(raw, exts)


def materialize_changes(root: Path, source: str, files: Sequence[str], dst_root: Path, *, convert_txt: bool = False) -> list[str]:
    rels: list[str] = []
    staged_set = set(staged_files())
    for rel in files:
        if source == "staged" or (source == "all" and rel in staged_set and not (root / rel).exists()):
            dst = materialize_git_index_file(rel, dst_root, convert_txt=convert_txt)
        else:
            dst = copy_current_file(root, rel, dst_root, convert_txt=convert_txt)
        rels.append(str(dst.relative_to(dst_root)))
    return rels


def write_merged_sources(root: Path, source: str, files: Sequence[str], out_file: Path) -> None:
    out_file.parent.mkdir(parents=True, exist_ok=True)
    staged_set = set(staged_files())
    with out_file.open("wb") as fh:
        for rel in files:
            header = ("=" * 80 + f"\nFILE: {rel}\nSOURCE: {source}\n" + "=" * 80 + "\n").encode()
            fh.write(header)
            if source == "staged" or (source == "all" and rel in staged_set and not (root / rel).exists()):
                try:
                    data = subprocess.run(["git", "show", f":{rel}"], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout
                except subprocess.CalledProcessError:
                    data = (root / rel).read_bytes()
            else:
                data = (root / rel).read_bytes()
            fh.write(data)
            fh.write(("\n" + "=" * 80 + f"\nEND OF FILE: {rel}\n\n").encode())


def cmd_changes(args: argparse.Namespace) -> int:
    root = git_root()
    print("================= GIT STATUS ==================")
    print(run_git(["status", "-s"], check=False).stdout, end="")
    print("===============================================")

    if not args.no_add_prompt:
        add_candidates_prompt()

    source = choose_changes_source(args)
    exts = parse_exts(args.ext)
    files = collect_change_files(source, exts)
    if not files:
        print(f"Không có file source/config hợp lệ ở nguồn {source}.")
        return 0
    print_file_list(files, f"Danh sách file {source}")
    if args.list_only:
        print(f"\nTổng cộng: {len(files)} file")
        return 0

    mode, convert, merge = choose_changes_package(args)
    ts = timestamp()
    diff_text = git_diff_text(source)
    status_text = run_git(["status", "--short"], check=False).stdout
    file_list_text = "\n".join(files) + "\n"

    if mode == "zip":
        tmp = Path(tempfile.mkdtemp(prefix=f"changes_{source}_{ts}_"))
        try:
            materialize_changes(root, source, files, tmp)
            write_text(tmp / "all_diff.txt", diff_text)
            write_text(tmp / "git_status.txt", status_text)
            write_text(tmp / "file_list.txt", file_list_text)
            zip_rels = [*files, "all_diff.txt", "git_status.txt", "file_list.txt"]
            out = Path(args.out or f"{source}_changes_{ts}.zip")
            make_zip_from_dir(out, tmp, zip_rels)
            abs_path = out.resolve()
            print(f"\n📦 Đã nén {len(files)} file + diff/status vào:")
            print(f"🔗 {abs_path}")
            maybe_cleanup(out, keep=args.keep, delete=args.delete, noun="file zip")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        return 0

    tmp = Path(tempfile.mkdtemp(prefix=f"{source}_changes_{ts}_"))
    if merge:
        merged = tmp / f"all_sources_{ts}.txt"
        write_merged_sources(root, source, files, merged)
    else:
        materialize_changes(root, source, files, tmp / "sources", convert_txt=convert)
    write_text(tmp / f"all_diff_{ts}.txt", diff_text)
    write_text(tmp / f"git_status_{ts}.txt", status_text)
    write_text(tmp / f"file_list_{ts}.txt", file_list_text)
    print(f"\n📂 Đã chuẩn bị thư mục:")
    print(f"🔗 {tmp.resolve()}")
    maybe_cleanup(tmp, keep=args.keep, delete=args.delete, noun="thư mục tạm")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Collect BleToNfc code snapshots")
    sub = p.add_subparsers(dest="cmd", required=True)

    pm = sub.add_parser("modules", help="zip files by module or extension")
    pm.add_argument("legacy_exts", nargs="*", help="legacy extension mode, e.g. c h inc py")
    pm.add_argument("--ext", action="append", help="comma-separated extension list; default is source/config list")
    pm.add_argument("--modules", help="module choices, e.g. '1234' or '1 2 4'")
    pm.add_argument("--all", action="store_true", help="scan whole repo using source/config filters")
    pm.add_argument("--no-scripts", action="store_true", help="do not include scripts/tools when selecting modules")
    pm.add_argument("--out", help="output zip path")
    pm.add_argument("--keep", action="store_true", help="keep generated output without prompt")
    pm.add_argument("--delete", action="store_true", help="delete generated output without prompt")
    pm.add_argument("--list-only", action="store_true", help="only print matched files")
    pm.set_defaults(func=cmd_modules)

    pc = sub.add_parser("changes", help="zip/copy files from git status")
    g = pc.add_mutually_exclusive_group()
    g.add_argument("--staged", action="store_true", help="use staged/index files")
    g.add_argument("--unstaged", action="store_true", help="use unstaged + untracked files")
    g.add_argument("--all", dest="all_changes", action="store_true", help="use staged + unstaged + untracked files")
    m = pc.add_mutually_exclusive_group()
    m.add_argument("--zip", dest="zip_mode", action="store_true", help="output zip")
    m.add_argument("--copy", dest="copy_mode", action="store_true", help="output temp dir")
    pc.add_argument("--ext", action="append", help="comma-separated extension list; default is source/config list")
    pc.add_argument("--convert-txt", action="store_true", help="copy source files with .txt suffix in --copy mode")
    pc.add_argument("--merge", action="store_true", help="merge all source into one text file in --copy mode")
    pc.add_argument("--no-add-prompt", action="store_true", help="skip interactive git add prompt")
    pc.add_argument("--out", help="output zip path for --zip mode")
    pc.add_argument("--keep", action="store_true", help="keep generated output without prompt")
    pc.add_argument("--delete", action="store_true", help="delete generated output without prompt")
    pc.add_argument("--list-only", action="store_true", help="only print matched files")
    pc.set_defaults(func=cmd_changes)
    return p


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if getattr(args, "keep", False) and getattr(args, "delete", False):
        parser.error("--keep và --delete không thể dùng cùng lúc")
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
