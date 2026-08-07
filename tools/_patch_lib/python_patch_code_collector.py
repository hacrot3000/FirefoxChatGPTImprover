#!/usr/bin/env python3
"""Portable, bounded code research and collection toolkit for Python Patch Tool v5.16.

The collector packages only requested project-relative code and search context into
one ZIP for AI analysis. It supports file/range, symbol, directory, text/regex
search, and large IDA/Ghidra-style decompile extraction requests.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import fnmatch
import contextlib
import io
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tempfile
from typing import Any, Iterable, Iterator, Sequence
import zipfile

from python_patch_diagnostics import extract_symbol_context, redact_secrets
from python_patch_decompile_extractor import run_request as run_decompile_request

TOOL_VERSION = "5.16.0"
DEFAULT_REQUEST_NAMES = ("CODE_COLLECTION_REQUEST.json", "code_collection_request.json")
DEFAULT_OUTPUT_ROOT = Path("artifacts/patch_tool_code_collections")
DEFAULT_EXCLUDES = (
    ".git/**", "patchs/**", "tools/_patch_lib/**", "artifacts/patch_tool_code_collections/**", "node_modules/**", "vendor/**", ".venv/**", "venv/**",
    "build/**", "dist/**", "target/**", ".gradle/**", ".idea/**", ".vscode/**",
    "**/__pycache__/**", "**/*.pyc", "**/*.o", "**/*.a", "**/*.so", "**/*.dll",
    "**/*.exe", "**/*.bin", "**/*.uf2", "**/*.elf", "**/*.map", "**/*.sqlite*",
)
SOURCE_SUFFIXES = {
    ".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx", ".ino",
    ".py", ".pyi", ".js", ".jsx", ".ts", ".tsx", ".java", ".kt", ".kts",
    ".go", ".rs", ".swift", ".m", ".mm", ".cs", ".sh", ".bash", ".zsh",
    ".cmake", ".mk", ".gradle", ".xml", ".json", ".yaml", ".yml", ".toml",
    ".md", ".html", ".css", ".scss", ".sql", ".proto", ".txt", ".patch",
}
SOURCE_BASENAMES = {"CMakeLists.txt", "Dockerfile", "Makefile", "meson.build", "Kconfig"}
SENSITIVE_NAMES = {
    ".env", ".npmrc", ".pypirc", ".netrc", "id_rsa", "id_ed25519",
    "credentials", "credentials.json", "service-account.json",
}


class CollectionError(RuntimeError):
    pass


@dataclass
class Limits:
    max_files: int = 1000
    max_total_bytes: int = 64 * 1024 * 1024
    max_file_bytes: int = 8 * 1024 * 1024
    max_search_matches: int = 500
    max_report_chars: int = 2_000_000


class Budget:
    def __init__(self, limits: Limits) -> None:
        self.limits = limits
        self.files = 0
        self.bytes = 0
        self.skipped: list[dict[str, Any]] = []

    def accept(self, rel: str, size: int, *, allow_large: bool = False) -> bool:
        if self.files >= self.limits.max_files:
            self.skipped.append({"path": rel, "reason": "max_files"})
            return False
        if size > self.limits.max_file_bytes and not allow_large:
            self.skipped.append({"path": rel, "reason": "max_file_bytes", "bytes": size})
            return False
        if self.bytes + size > self.limits.max_total_bytes:
            self.skipped.append({"path": rel, "reason": "max_total_bytes", "bytes": size})
            return False
        self.files += 1
        self.bytes += size
        return True


def safe_slug(value: str, fallback: str = "code_collection") -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", value.strip()).strip("._-")
    return cleaned or fallback


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def is_sensitive(rel: str) -> bool:
    p = PurePosixPath(rel)
    parts = {part.lower() for part in p.parts}
    name = p.name.lower()
    if name in SENSITIVE_NAMES:
        return True
    if parts & {".git", ".ssh", "secrets", "credentials", "private", "certs"}:
        return True
    if any(token in name for token in ("private_key", "secret_key", "access_token", "passwords")):
        return True
    return False


def matches_any(rel: str, patterns: Iterable[str]) -> bool:
    rel = rel.replace(os.sep, "/")
    return any(fnmatch.fnmatch(rel, pattern) or Path(rel).match(pattern) for pattern in patterns)


def resolve_project_path(root: Path, value: str, *, must_exist: bool = True) -> tuple[Path, str]:
    raw = str(value).strip()
    if not raw:
        raise CollectionError("Empty project path")
    candidate = Path(raw)
    if candidate.is_absolute():
        raise CollectionError(f"Absolute path is not portable and is not allowed: {raw}")
    if ".." in PurePosixPath(raw.replace("\\", "/")).parts:
        raise CollectionError(f"Parent traversal is not allowed: {raw}")
    resolved = (root / candidate).resolve(strict=False)
    try:
        rel = resolved.relative_to(root.resolve()).as_posix()
    except ValueError as exc:
        raise CollectionError(f"Path escapes project root: {raw}") from exc
    if must_exist and not resolved.exists():
        raise CollectionError(f"Project path not found: {rel}")
    return resolved, rel


def looks_text_source(path: Path) -> bool:
    return path.suffix.lower() in SOURCE_SUFFIXES or path.name in SOURCE_BASENAMES


def read_text_bounded(path: Path, max_bytes: int) -> tuple[str, bool]:
    data = path.read_bytes()
    truncated = len(data) > max_bytes > 0
    if truncated:
        half = max(1, max_bytes // 2)
        data = data[:half] + b"\n... [middle omitted by code collector] ...\n" + data[-half:]
    if b"\x00" in data[:8192]:
        raise CollectionError(f"Binary file is not accepted as code context: {path.name}")
    return data.decode("utf-8", errors="replace"), truncated


def numbered_range(text: str, start: int, end: int) -> str:
    lines = text.splitlines()
    start = max(1, start)
    end = min(len(lines), end if end > 0 else len(lines))
    if start > end:
        raise CollectionError(f"Invalid line range {start}..{end}")
    width = len(str(max(1, end)))
    return "\n".join(f"L{n:>{width}}: {lines[n-1]}" for n in range(start, end + 1)) + "\n"


def store_text(output_dir: Path, arc_rel: str, text: str, budget: Budget, *, source_rel: str, allow_large: bool = False) -> dict[str, Any] | None:
    redacted, redaction = redact_secrets(text)
    data = redacted.encode("utf-8")
    if not budget.accept(arc_rel, len(data), allow_large=allow_large):
        return None
    destination = output_dir / arc_rel
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)
    return {
        "source": source_rel,
        "output": arc_rel,
        "bytes": len(data),
        "sha256": sha256_bytes(data),
        "redactions": redaction,
    }


def iter_directory_files(root: Path, base: Path, *, include: Sequence[str], exclude: Sequence[str]) -> Iterator[tuple[Path, str]]:
    for path in sorted(base.rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        rel = path.relative_to(root).as_posix()
        local = path.relative_to(base).as_posix()
        if is_sensitive(rel) or matches_any(rel, exclude) or matches_any(local, exclude):
            continue
        if include and not (matches_any(rel, include) or matches_any(local, include)):
            continue
        if not include and not looks_text_source(path):
            continue
        yield path, rel


def collect_file_action(root: Path, out: Path, action: dict[str, Any], budget: Budget, index: list[dict[str, Any]]) -> None:
    path, rel = resolve_project_path(root, str(action.get("path", "")))
    if not path.is_file():
        raise CollectionError(f"File action target is not a file: {rel}")
    if is_sensitive(rel):
        budget.skipped.append({"path": rel, "reason": "sensitive_path"})
        return
    max_read = int(action.get("max_read_bytes", max(budget.limits.max_file_bytes, 1)))
    text, truncated = read_text_bounded(path, max_read)
    start = int(action.get("start_line", 0) or 0)
    end = int(action.get("end_line", 0) or 0)
    if start or end:
        text = numbered_range(text, start or 1, end or 0)
        arc = f"snippets/{safe_slug(rel)}__L{start or 1}-L{end or 'end'}.txt"
    else:
        arc = f"files/{rel}"
    entry = store_text(out, arc, text, budget, source_rel=rel, allow_large=bool(action.get("allow_large", False)))
    if entry:
        entry.update({"type": "file", "truncated": truncated, "line_range": [start, end] if start or end else []})
        index.append(entry)


def collect_symbol_action(root: Path, out: Path, action: dict[str, Any], budget: Budget, index: list[dict[str, Any]]) -> None:
    path, rel = resolve_project_path(root, str(action.get("path", "")))
    symbol = str(action.get("symbol", "")).strip()
    line_hint = int(action.get("line_hint", 0) or 0)
    context = extract_symbol_context(path, line_hint=line_hint, symbol_hint=symbol, max_lines=int(action.get("max_lines", 800)))
    if not context:
        raise CollectionError(f"Unable to locate symbol context: {rel}::{symbol or '<line hint>'}")
    body = (
        f"FILE: {rel}\nSYMBOL: {context.get('symbol','')}\nKIND: {context.get('kind','')}\n"
        f"LINES: {context.get('start_line',0)}-{context.get('end_line',0)}\n"
        f"TRUNCATED: {str(bool(context.get('truncated'))).lower()}\n\n{context.get('source','')}\n"
    )
    arc = f"symbols/{safe_slug(rel)}__{safe_slug(symbol or str(context.get('symbol','symbol')))}.txt"
    entry = store_text(out, arc, body, budget, source_rel=rel)
    if entry:
        entry.update({"type": "symbol", "symbol": context.get("symbol", symbol), "start_line": context.get("start_line"), "end_line": context.get("end_line")})
        index.append(entry)


def collect_directory_action(root: Path, out: Path, action: dict[str, Any], budget: Budget, index: list[dict[str, Any]], default_excludes: Sequence[str]) -> None:
    base, rel_base = resolve_project_path(root, str(action.get("path", "")))
    if not base.is_dir():
        raise CollectionError(f"Directory action target is not a directory: {rel_base}")
    include = [str(x) for x in action.get("include", [])]
    exclude = list(default_excludes) + [str(x) for x in action.get("exclude", [])]
    for path, rel in iter_directory_files(root, base, include=include, exclude=exclude):
        try:
            text, truncated = read_text_bounded(path, int(action.get("max_read_bytes", budget.limits.max_file_bytes)))
        except CollectionError as exc:
            budget.skipped.append({"path": rel, "reason": str(exc)})
            continue
        entry = store_text(out, f"files/{rel}", text, budget, source_rel=rel, allow_large=bool(action.get("allow_large", False)))
        if entry:
            entry.update({"type": "directory_file", "directory": rel_base, "truncated": truncated})
            index.append(entry)


def iter_search_files(root: Path, paths: Sequence[str], include: Sequence[str], exclude: Sequence[str]) -> Iterator[tuple[Path, str]]:
    seen: set[str] = set()
    for value in paths or ["."]:
        base, rel = resolve_project_path(root, value)
        if base.is_file():
            candidates = [(base, rel)]
        else:
            candidates = iter_directory_files(root, base, include=include, exclude=exclude)
        for path, item_rel in candidates:
            if item_rel in seen or is_sensitive(item_rel) or not looks_text_source(path):
                continue
            seen.add(item_rel)
            yield path, item_rel


def collect_search_action(root: Path, out: Path, action: dict[str, Any], budget: Budget, index: list[dict[str, Any]], default_excludes: Sequence[str]) -> None:
    query = str(action.get("query", ""))
    if not query:
        raise CollectionError("Search action requires non-empty query")
    regex_mode = bool(action.get("regex", False))
    case_sensitive = bool(action.get("case_sensitive", False))
    flags = 0 if case_sensitive else re.IGNORECASE
    pattern = re.compile(query, flags) if regex_mode else None
    needle = query if case_sensitive else query.casefold()
    context_lines = max(0, int(action.get("context_lines", 4)))
    max_matches = min(budget.limits.max_search_matches, int(action.get("max_matches", budget.limits.max_search_matches)))
    include = [str(x) for x in action.get("include", [])]
    exclude = list(default_excludes) + [str(x) for x in action.get("exclude", [])]
    paths = [str(x) for x in action.get("paths", ["."])]
    matches: list[dict[str, Any]] = []
    for path, rel in iter_search_files(root, paths, include, exclude):
        try:
            if path.stat().st_size > int(action.get("max_search_file_bytes", 64 * 1024 * 1024)):
                budget.skipped.append({"path": rel, "reason": "max_search_file_bytes"})
                continue
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError as exc:
            budget.skipped.append({"path": rel, "reason": f"read_error:{exc}"})
            continue
        for idx, line in enumerate(lines):
            matched = bool(pattern.search(line)) if pattern else needle in (line if case_sensitive else line.casefold())
            if not matched:
                continue
            start = max(0, idx - context_lines)
            end = min(len(lines), idx + context_lines + 1)
            width = len(str(end))
            excerpt = "\n".join((">" if n == idx else " ") + f" L{n+1:>{width}}: {lines[n]}" for n in range(start, end))
            matches.append({"file": rel, "line": idx + 1, "excerpt": excerpt})
            if len(matches) >= max_matches:
                break
        if len(matches) >= max_matches:
            break
    report = [f"# Search results", "", f"Query: `{query}`", f"Regex: `{regex_mode}`", f"Matches: `{len(matches)}`", ""]
    for number, item in enumerate(matches, 1):
        report.extend([f"## {number}. `{item['file']}:{item['line']}`", "", "```text", item["excerpt"], "```", ""])
    arc = f"search/{safe_slug(str(action.get('id') or query))}.md"
    entry = store_text(out, arc, "\n".join(report), budget, source_rel="<search>")
    if entry:
        entry.update({"type": "search", "query": query, "match_count": len(matches), "matches": [{"file": x["file"], "line": x["line"]} for x in matches]})
        index.append(entry)



def format_size(size: int) -> str:
    units = ("B", "KiB", "MiB", "GiB")
    value = float(size)
    for unit in units:
        if value < 1024.0 or unit == units[-1]:
            return f"{value:.1f}{unit}" if unit != "B" else f"{int(value)}B"
        value /= 1024.0
    return f"{size}B"


def visible_child(root: Path, path: Path, excludes: Sequence[str]) -> tuple[bool, str]:
    try:
        rel = path.relative_to(root).as_posix()
    except ValueError:
        return False, ""
    if path.is_symlink() or is_sensitive(rel) or matches_any(rel, excludes):
        return False, rel
    return True, rel


def collect_ls_action(root: Path, out: Path, action: dict[str, Any], budget: Budget, index: list[dict[str, Any]], default_excludes: Sequence[str]) -> None:
    target, rel_target = resolve_project_path(root, str(action.get("path", ".")))
    excludes = list(default_excludes) + [str(x) for x in action.get("exclude", [])]
    max_entries = max(1, min(int(action.get("max_entries", 1000)), 5000))
    show_hidden = bool(action.get("show_hidden", False))
    paths = [target] if target.is_file() else sorted(target.iterdir(), key=lambda item: (not item.is_dir(), item.name.casefold()))
    rows = [f"# Directory listing: `{rel_target or '.'}`", "", "| Type | Size | Path |", "|---|---:|---|"]
    count = 0
    truncated = False
    for child in paths:
        ok, rel = visible_child(root, child, excludes)
        if not ok or (not show_hidden and child.name.startswith(".")):
            continue
        if count >= max_entries:
            truncated = True
            break
        kind = "dir" if child.is_dir() else "file"
        size = "-" if child.is_dir() else format_size(child.stat().st_size)
        rows.append(f"| {kind} | {size} | `{rel}` |")
        count += 1
    rows.extend(["", f"Entries: {count}", f"Truncated: {str(truncated).lower()}"])
    arc = f"inventory/ls__{safe_slug(rel_target or 'root')}.md"
    entry = store_text(out, arc, "\n".join(rows) + "\n", budget, source_rel=rel_target or ".")
    if entry:
        entry.update({"type": "ls", "path": rel_target or ".", "entry_count": count, "truncated": truncated})
        index.append(entry)


def collect_tree_action(root: Path, out: Path, action: dict[str, Any], budget: Budget, index: list[dict[str, Any]], default_excludes: Sequence[str]) -> None:
    base, rel_base = resolve_project_path(root, str(action.get("path", ".")))
    if not base.is_dir():
        raise CollectionError(f"Tree action target is not a directory: {rel_base}")
    max_depth = max(0, min(int(action.get("max_depth", 4)), 20))
    max_entries = max(1, min(int(action.get("max_entries", 5000)), 20000))
    show_hidden = bool(action.get("show_hidden", False))
    excludes = list(default_excludes) + [str(x) for x in action.get("exclude", [])]
    lines = [f"{rel_base or '.'}/"]
    count = 0
    truncated = False

    def walk(directory: Path, prefix: str, depth: int) -> None:
        nonlocal count, truncated
        if truncated or depth > max_depth:
            return
        children = []
        try:
            raw_children = list(directory.iterdir())
        except OSError:
            return
        for child in raw_children:
            ok, rel = visible_child(root, child, excludes)
            if not ok or (not show_hidden and child.name.startswith(".")):
                continue
            children.append((child, rel))
        children.sort(key=lambda pair: (not pair[0].is_dir(), pair[0].name.casefold()))
        for pos, (child, rel) in enumerate(children):
            if count >= max_entries:
                truncated = True
                lines.append(prefix + "└── ... [tree entry limit reached]")
                return
            last = pos == len(children) - 1
            branch = "└── " if last else "├── "
            suffix = "/" if child.is_dir() else ""
            lines.append(prefix + branch + child.name + suffix)
            count += 1
            if child.is_dir() and depth < max_depth:
                walk(child, prefix + ("    " if last else "│   "), depth + 1)

    walk(base, "", 0)
    lines.extend(["", f"Entries: {count}", f"Max depth: {max_depth}", f"Truncated: {str(truncated).lower()}"])
    arc = f"inventory/tree__{safe_slug(rel_base or 'root')}.txt"
    entry = store_text(out, arc, "\n".join(lines) + "\n", budget, source_rel=rel_base or ".")
    if entry:
        entry.update({"type": "tree", "path": rel_base or ".", "entry_count": count, "max_depth": max_depth, "truncated": truncated})
        index.append(entry)


def collect_head_tail_action(root: Path, out: Path, action: dict[str, Any], budget: Budget, index: list[dict[str, Any]], *, tail: bool) -> None:
    path, rel = resolve_project_path(root, str(action.get("path", "")))
    if not path.is_file():
        raise CollectionError(f"Head/tail target is not a file: {rel}")
    if is_sensitive(rel):
        budget.skipped.append({"path": rel, "reason": "sensitive_path"})
        return
    count = max(1, min(int(action.get("lines", 120)), 5000))
    text, truncated = read_text_bounded(path, int(action.get("max_read_bytes", budget.limits.max_file_bytes)))
    rows = text.splitlines()
    start = max(1, len(rows) - count + 1) if tail else 1
    end = len(rows) if tail else min(len(rows), count)
    body = numbered_range(text, start, end)
    label = "tail" if tail else "head"
    arc = f"snippets/{safe_slug(rel)}__{label}_{count}.txt"
    entry = store_text(out, arc, body, budget, source_rel=rel)
    if entry:
        entry.update({"type": label, "lines_requested": count, "start_line": start, "end_line": end, "source_truncated": truncated})
        index.append(entry)


def collect_find_action(root: Path, out: Path, action: dict[str, Any], budget: Budget, index: list[dict[str, Any]], default_excludes: Sequence[str]) -> None:
    paths = [str(x) for x in action.get("paths", [action.get("path", ".")])]
    patterns = [str(x) for x in action.get("patterns", action.get("include", ["*"]))]
    excludes = list(default_excludes) + [str(x) for x in action.get("exclude", [])]
    kind = str(action.get("kind", "any")).lower()
    max_results = max(1, min(int(action.get("max_results", 5000)), 20000))
    collect_matches = bool(action.get("collect", False))
    results: list[tuple[Path, str]] = []
    seen: set[str] = set()
    for raw in paths:
        base, rel_base = resolve_project_path(root, raw)
        candidates = [base] if base.is_file() else base.rglob("*")
        for candidate in candidates:
            ok, rel = visible_child(root, candidate, excludes)
            if not ok or rel in seen:
                continue
            if kind == "file" and not candidate.is_file():
                continue
            if kind == "dir" and not candidate.is_dir():
                continue
            local = candidate.name if base.is_file() else candidate.relative_to(base).as_posix()
            if patterns and not (matches_any(rel, patterns) or matches_any(local, patterns) or any(fnmatch.fnmatch(candidate.name, pat) for pat in patterns)):
                continue
            seen.add(rel)
            results.append((candidate, rel))
            if len(results) >= max_results:
                break
        if len(results) >= max_results:
            break
    lines = ["# Find results", "", f"Patterns: `{patterns}`", f"Results: {len(results)}", ""]
    for candidate, rel in results:
        lines.append(f"- {'dir' if candidate.is_dir() else 'file'}: `{rel}`")
    arc = f"inventory/find__{safe_slug('_'.join(patterns) or 'all')}.md"
    entry = store_text(out, arc, "\n".join(lines) + "\n", budget, source_rel="<find>")
    if entry:
        entry.update({"type": "find", "patterns": patterns, "result_count": len(results), "collected": collect_matches})
        index.append(entry)
    if collect_matches:
        for candidate, rel in results:
            if not candidate.is_file() or not looks_text_source(candidate):
                continue
            try:
                text, truncated = read_text_bounded(candidate, budget.limits.max_file_bytes)
            except CollectionError as exc:
                budget.skipped.append({"path": rel, "reason": str(exc)})
                continue
            item = store_text(out, f"files/{rel}", text, budget, source_rel=rel)
            if item:
                item.update({"type": "find_file", "truncated": truncated})
                index.append(item)


def collect_pack_action(root: Path, out: Path, action: dict[str, Any], budget: Budget, index: list[dict[str, Any]], default_excludes: Sequence[str]) -> None:
    paths = [str(x) for x in action.get("paths", [])]
    if not paths and action.get("path"):
        paths = [str(action["path"])]
    if not paths:
        raise CollectionError("Pack action requires path or paths")
    include = [str(x) for x in action.get("include", [])]
    excludes = list(default_excludes) + [str(x) for x in action.get("exclude", [])]
    seen: set[str] = set()
    for raw in paths:
        target, rel = resolve_project_path(root, raw)
        candidates = [(target, rel)] if target.is_file() else iter_directory_files(root, target, include=include, exclude=excludes)
        for path, item_rel in candidates:
            if item_rel in seen or not path.is_file() or is_sensitive(item_rel):
                continue
            seen.add(item_rel)
            try:
                text, truncated = read_text_bounded(path, int(action.get("max_read_bytes", budget.limits.max_file_bytes)))
            except CollectionError as exc:
                budget.skipped.append({"path": item_rel, "reason": str(exc)})
                continue
            entry = store_text(out, f"files/{item_rel}", text, budget, source_rel=item_rel, allow_large=bool(action.get("allow_large", False)))
            if entry:
                entry.update({"type": "pack_file", "truncated": truncated, "requested_paths": paths})
                index.append(entry)


def run_git(root: Path, args: Sequence[str], *, max_chars: int) -> str:
    cp = subprocess.run(["git", *args], cwd=root, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False)
    text = f"$ git {' '.join(args)}\n[exit={cp.returncode}]\n{cp.stdout}"
    if len(text) > max_chars:
        half = max_chars // 2
        text = text[:half] + "\n... [git output middle omitted] ...\n" + text[-half:]
    return text


def collect_git_action(root: Path, out: Path, action: dict[str, Any], budget: Budget, index: list[dict[str, Any]]) -> None:
    if not (root / ".git").exists():
        raise CollectionError("Git context requested but project root is not a Git repository")
    sections = [str(x) for x in action.get("sections", ["status", "branch", "log", "diff_stat", "diff"])]
    allowed = {"status", "branch", "log", "diff_stat", "diff", "staged_diff", "submodules", "remotes"}
    unknown = [x for x in sections if x not in allowed]
    if unknown:
        raise CollectionError(f"Unsupported git context sections: {unknown}")
    max_chars = max(1000, min(int(action.get("max_chars", 500000)), budget.limits.max_report_chars))
    commands = {
        "status": ["status", "--short", "--branch"],
        "branch": ["rev-parse", "--abbrev-ref", "HEAD"],
        "log": ["log", "--oneline", "--decorate", f"-{max(1, min(int(action.get('log_count', 20)), 200))}"],
        "diff_stat": ["diff", "--stat"],
        "diff": ["diff", "--no-ext-diff", "--unified=3"],
        "staged_diff": ["diff", "--cached", "--no-ext-diff", "--unified=3"],
        "submodules": ["submodule", "status", "--recursive"],
        "remotes": ["remote", "-v"],
    }
    body = []
    for section in sections:
        body.extend([f"## {section}", "", "```text", run_git(root, commands[section], max_chars=max_chars), "```", ""])
    arc = "git/git_context.md"
    entry = store_text(out, arc, "# Git context\n\n" + "\n".join(body), budget, source_rel="<git>")
    if entry:
        entry.update({"type": "git", "sections": sections})
        index.append(entry)


def extension_statistics(root: Path, base: Path, excludes: Sequence[str], max_entries: int = 100000) -> tuple[dict[str, int], int]:
    stats: dict[str, int] = {}
    total = 0
    for path in base.rglob("*"):
        if total >= max_entries:
            break
        if not path.is_file() or path.is_symlink():
            continue
        rel = path.relative_to(root).as_posix()
        if is_sensitive(rel) or matches_any(rel, excludes):
            continue
        key = path.suffix.lower() or path.name
        stats[key] = stats.get(key, 0) + 1
        total += 1
    return dict(sorted(stats.items(), key=lambda pair: (-pair[1], pair[0]))), total


def collect_overview_action(root: Path, out: Path, action: dict[str, Any], budget: Budget, index: list[dict[str, Any]], default_excludes: Sequence[str]) -> None:
    base_path = str(action.get("path", "."))
    collect_ls_action(root, out, {"path": base_path, "max_entries": action.get("ls_max_entries", 500)}, budget, index, default_excludes)
    collect_tree_action(root, out, {"path": base_path, "max_depth": action.get("tree_depth", 4), "max_entries": action.get("tree_max_entries", 5000)}, budget, index, default_excludes)
    base, rel = resolve_project_path(root, base_path)
    excludes = list(default_excludes) + [str(x) for x in action.get("exclude", [])]
    stats, total = extension_statistics(root, base, excludes)
    rows = ["# Project overview", "", f"Base: `{rel or '.'}`", f"Files scanned: {total}", "", "## File types", ""]
    rows.extend(f"- `{kind}`: {count}" for kind, count in list(stats.items())[:100])
    key_candidates = [
        "README.md", "README", "CMakeLists.txt", "Makefile", "Dockerfile", "pyproject.toml", "requirements.txt",
        "package.json", "Cargo.toml", "go.mod", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts",
        "platformio.ini", "sdkconfig", "idf_component.yml", "west.yml", "meson.build",
    ]
    found = []
    for name in key_candidates:
        candidate = base / name
        if candidate.is_file():
            found.append(candidate.relative_to(root).as_posix())
    rows.extend(["", "## Key project files", ""] + [f"- `{x}`" for x in found])
    entry = store_text(out, "inventory/project_overview.md", "\n".join(rows) + "\n", budget, source_rel=rel or ".")
    if entry:
        entry.update({"type": "overview", "files_scanned": total, "key_files": found})
        index.append(entry)
    if bool(action.get("collect_key_files", True)):
        for rel_file in found:
            collect_file_action(root, out, {"path": rel_file}, budget, index)
    if bool(action.get("include_git", True)) and (root / ".git").exists():
        collect_git_action(root, out, {"sections": action.get("git_sections", ["status", "branch", "log", "diff_stat"])}, budget, index)


def collect_references_action(root: Path, out: Path, action: dict[str, Any], budget: Budget, index: list[dict[str, Any]], default_excludes: Sequence[str]) -> None:
    symbol = str(action.get("symbol") or action.get("query") or "").strip()
    if not symbol:
        raise CollectionError("References action requires symbol")
    regex = rf"(?<![A-Za-z0-9_$]){re.escape(symbol)}(?![A-Za-z0-9_$])"
    search_action = dict(action)
    search_action.update({"type": "search", "query": regex, "regex": True, "id": action.get("id") or f"references_{symbol}"})
    collect_search_action(root, out, search_action, budget, index, default_excludes)


def collect_research_action(root: Path, out: Path, action: dict[str, Any], budget: Budget, index: list[dict[str, Any]], default_excludes: Sequence[str]) -> None:
    query = str(action.get("query", "")).strip()
    if not query:
        raise CollectionError("Research action requires query")
    if bool(action.get("include_overview", True)):
        collect_overview_action(root, out, {"path": action.get("path", "."), "tree_depth": action.get("tree_depth", 3), "collect_key_files": True, "include_git": True}, budget, index, default_excludes)
    collect_search_action(root, out, {
        "type": "search", "query": query, "regex": bool(action.get("regex", False)),
        "case_sensitive": bool(action.get("case_sensitive", False)), "paths": action.get("paths", [action.get("path", ".")]),
        "context_lines": action.get("context_lines", 8), "max_matches": action.get("max_matches", 200),
        "include": action.get("include", []), "exclude": action.get("exclude", []), "id": action.get("id") or f"research_{query}",
    }, budget, index, default_excludes)



def collect_callgraph_action(root: Path, out: Path, action: dict[str, Any], budget: Budget, index: list[dict[str, Any]], default_excludes: Sequence[str]) -> None:
    path, rel = resolve_project_path(root, str(action.get("path", "")))
    symbol = str(action.get("symbol", "")).strip()
    if not symbol:
        raise CollectionError("Callgraph action requires symbol")
    context = extract_symbol_context(path, line_hint=int(action.get("line_hint", 0) or 0), symbol_hint=symbol, max_lines=int(action.get("max_lines", 1200)))
    if not context:
        raise CollectionError(f"Unable to locate callgraph root: {rel}::{symbol}")
    source = str(context.get("source", ""))
    keywords = {"if", "for", "while", "switch", "return", "sizeof", "catch", "new", "delete", "typeof", "assert", "defined"}
    calls = []
    for match in re.finditer(r"(?<![A-Za-z0-9_$])([A-Za-z_$~][A-Za-z0-9_$:>.~-]*)\s*\(", source):
        name = match.group(1).split("::")[-1].split(".")[-1].split("->")[-1]
        if name in keywords or name == symbol or name in calls:
            continue
        calls.append(name)
    max_callees = max(1, min(int(action.get("max_callees", 100)), 500))
    calls = calls[:max_callees]
    rows = [f"# Call graph context: `{symbol}`", "", f"File: `{rel}`", f"Lines: {context.get('start_line')}-{context.get('end_line')}", "", "## Callee candidates", ""]
    rows.extend(f"- `{name}`" for name in calls)
    rows.extend(["", "## Root symbol source", "", "```text", source, "```", ""])
    arc = f"graphs/callgraph__{safe_slug(rel)}__{safe_slug(symbol)}.md"
    entry = store_text(out, arc, "\n".join(rows), budget, source_rel=rel)
    if entry:
        entry.update({"type": "callgraph", "symbol": symbol, "callee_candidates": calls, "heuristic": True})
        index.append(entry)
    if bool(action.get("include_callers", True)):
        collect_references_action(root, out, {
            "symbol": symbol, "paths": action.get("paths", [str(action.get("search_path", "."))]),
            "context_lines": action.get("context_lines", 5), "max_matches": action.get("max_callers", 200),
            "id": f"callers_{symbol}",
        }, budget, index, default_excludes)
    if bool(action.get("collect_callee_references", False)):
        for name in calls[: min(len(calls), int(action.get("collect_callee_limit", 20)))]:
            collect_references_action(root, out, {
                "symbol": name, "paths": action.get("paths", [str(action.get("search_path", "."))]),
                "context_lines": 3, "max_matches": 50, "id": f"callee_{name}",
            }, budget, index, default_excludes)


def dependency_lines(path: Path, text: str) -> list[str]:
    suffix = path.suffix.lower()
    patterns = [
        r"^\s*#\s*include\s*[<\"]([^>\"]+)[>\"]",
        r"^\s*(?:from\s+([A-Za-z0-9_\.]+)\s+import|import\s+([A-Za-z0-9_\.]+))",
        r"^\s*import\s+(?:[^'\"]+\s+from\s+)?['\"]([^'\"]+)['\"]",
        r"require\s*\(\s*['\"]([^'\"]+)['\"]\s*\)",
        r"^\s*use\s+([^;]+);",
        r"^\s*mod\s+([A-Za-z0-9_]+)\s*;",
        r"^\s*import\s+([A-Za-z0-9_\.]+);",
    ]
    if suffix == ".go":
        patterns.append(r"^\s*\"([^\"]+)\"")
    found: list[str] = []
    for line in text.splitlines():
        for pattern in patterns:
            match = re.search(pattern, line)
            if not match:
                continue
            value = next((group for group in match.groups() if group), "").strip()
            if value and value not in found:
                found.append(value)
            break
    return found


def collect_dependencies_action(root: Path, out: Path, action: dict[str, Any], budget: Budget, index: list[dict[str, Any]], default_excludes: Sequence[str]) -> None:
    target, rel_target = resolve_project_path(root, str(action.get("path", "")))
    excludes = list(default_excludes) + [str(x) for x in action.get("exclude", [])]
    include = [str(x) for x in action.get("include", [])]
    candidates = [(target, rel_target)] if target.is_file() else iter_directory_files(root, target, include=include, exclude=excludes)
    results: list[tuple[str, list[str]]] = []
    max_files = max(1, min(int(action.get("max_files", 500)), budget.limits.max_files))
    for path, rel in candidates:
        if len(results) >= max_files:
            break
        if not looks_text_source(path):
            continue
        try:
            text, _ = read_text_bounded(path, min(budget.limits.max_file_bytes, int(action.get("max_read_bytes", 2 * 1024 * 1024))))
        except CollectionError:
            continue
        deps = dependency_lines(path, text)
        if deps:
            results.append((rel, deps))
    rows = ["# Source dependency inventory", "", f"Target: `{rel_target}`", f"Files with dependencies: {len(results)}", ""]
    for rel, deps in results:
        rows.append(f"## `{rel}`")
        rows.extend(f"- `{dep}`" for dep in deps)
        rows.append("")
    arc = f"graphs/dependencies__{safe_slug(rel_target)}.md"
    entry = store_text(out, arc, "\n".join(rows), budget, source_rel=rel_target)
    if entry:
        entry.update({"type": "dependencies", "files": len(results), "dependency_count": sum(len(x[1]) for x in results)})
        index.append(entry)


def collect_decompile_action(root: Path, out: Path, action: dict[str, Any], budget: Budget, index: list[dict[str, Any]]) -> None:
    source = str(action.get("source", ""))
    resolve_project_path(root, source)
    query = {k: v for k, v in action.items() if k in {
        "id", "label", "address", "name", "match", "max_matches", "neighbors_before", "neighbors_after",
        "include_references", "reference_term", "reference_context_lines", "max_reference_hits", "case_sensitive",
    }}
    if not ("address" in query or "name" in query):
        raise CollectionError("Decompile action requires address or name")
    request = {
        "title": str(action.get("title") or f"Decompile {query.get('address') or query.get('name') or 'query'}"),
        "source": source,
        "index": str(action.get("index") or f"artifacts/.patch_tool_indexes/{safe_slug(source)}.sqlite3"),
        "output_dir": str((out / "decompile" / safe_slug(str(action.get("id") or "query"))).relative_to(root).as_posix()),
        "clean_output": True,
        "force_reindex": bool(action.get("force_reindex", False)),
        "queries": [query],
    }
    captured = io.StringIO()
    with contextlib.redirect_stdout(captured):
        result = run_decompile_request(request, project_root=root)
    nested_archive = root / str(result.get("archive", ""))
    nested_archive.unlink(missing_ok=True)
    extracted_dir = root / str(result.get("output_dir", ""))
    redactions = 0
    kept = 0
    for path in sorted(extracted_dir.rglob("*")) if extracted_dir.exists() else []:
        if not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        try:
            text, truncated = read_text_bounded(path, budget.limits.max_file_bytes)
        except CollectionError as exc:
            path.unlink(missing_ok=True)
            budget.skipped.append({"path": rel, "reason": str(exc)})
            continue
        redacted, redaction = redact_secrets(text)
        data = redacted.encode("utf-8")
        if not budget.accept(rel, len(data), allow_large=bool(action.get("allow_large", False))):
            path.unlink(missing_ok=True)
            continue
        path.write_bytes(data)
        redactions += int(redaction.get("total", 0))
        kept += 1
    index.append({"type": "decompile", "source": source, "output": result.get("output_dir"), "archive": "", "files": kept, "redactions": redactions})


def load_collection_policy(root: Path) -> dict[str, Any]:
    policy: dict[str, Any] = {
        "enabled": True, "output_root": DEFAULT_OUTPUT_ROOT.as_posix(),
        "max_files": 1000, "max_total_bytes": 64 * 1024 * 1024,
        "max_file_bytes": 8 * 1024 * 1024, "max_search_matches": 500,
        "relative_paths_only": True, "redact_secret_values": True,
        "exclude": [],
    }
    config_path = root / ".python_patch_tool.json"
    if config_path.is_file():
        try:
            value = json.loads(config_path.read_text(encoding="utf-8"))
            raw = value.get("code_collection", {}) if isinstance(value, dict) else {}
            if isinstance(raw, dict):
                for key in policy:
                    if key in raw:
                        policy[key] = raw[key]
        except Exception as exc:
            raise CollectionError(f"Invalid .python_patch_tool.json: {exc}") from exc
    if not bool(policy.get("enabled", True)):
        raise CollectionError("Code collection is disabled by project policy")
    return policy


def capped_limit(requested: Any, cap: int, minimum: int = 1) -> int:
    try:
        value = int(requested)
    except (TypeError, ValueError):
        value = cap
    return max(minimum, min(value, cap))


def normalize_request(value: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise CollectionError("Request root must be an object")
    actions = value.get("actions")
    if not isinstance(actions, list) or not actions:
        raise CollectionError("Request must contain a non-empty actions array")
    return value


def create_zip(output_dir: Path) -> Path:
    destination = output_dir.with_suffix(".zip")
    temp = destination.with_suffix(".zip.tmp")
    temp.unlink(missing_ok=True)
    with zipfile.ZipFile(temp, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for path in sorted(output_dir.rglob("*")):
            if path.is_file():
                zf.write(path, path.relative_to(output_dir).as_posix())
    os.replace(temp, destination)
    return destination


def run_request(request: dict[str, Any], *, project_root: Path) -> dict[str, Any]:
    request = normalize_request(request)
    root = project_root.expanduser().resolve()
    title = str(request.get("title") or request.get("id") or "Code collection")
    request_id = safe_slug(str(request.get("id") or title))
    policy = load_collection_policy(root)
    configured_output, configured_output_rel = resolve_project_path(root, str(policy.get("output_root") or DEFAULT_OUTPUT_ROOT), must_exist=False)
    output_raw = str(request.get("output_dir") or (Path(configured_output_rel) / request_id).as_posix())
    output_dir, output_rel = resolve_project_path(root, output_raw, must_exist=False)
    try:
        output_dir.relative_to(configured_output)
    except ValueError as exc:
        raise CollectionError(f"output_dir must stay under configured code_collection.output_root: {configured_output_rel}") from exc
    if output_dir == configured_output:
        raise CollectionError("output_dir must be a child of code_collection.output_root, not the root itself")
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    limits_raw = request.get("limits") if isinstance(request.get("limits"), dict) else {}
    limits = Limits(
        max_files=capped_limit(limits_raw.get("max_files", policy["max_files"]), int(policy["max_files"])),
        max_total_bytes=capped_limit(limits_raw.get("max_total_bytes", policy["max_total_bytes"]), int(policy["max_total_bytes"]), 1024),
        max_file_bytes=capped_limit(limits_raw.get("max_file_bytes", policy["max_file_bytes"]), int(policy["max_file_bytes"]), 1024),
        max_search_matches=capped_limit(limits_raw.get("max_search_matches", policy["max_search_matches"]), int(policy["max_search_matches"])),
        max_report_chars=capped_limit(limits_raw.get("max_report_chars", 2_000_000), 2_000_000, 1000),
    )
    budget = Budget(limits)
    excludes = list(DEFAULT_EXCLUDES) + [str(x) for x in policy.get("exclude", [])] + [str(x) for x in request.get("exclude", [])]
    entries: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    for number, raw_action in enumerate(request["actions"], 1):
        if not isinstance(raw_action, dict):
            errors.append({"action": number, "error": "action must be object"})
            continue
        action = dict(raw_action)
        kind = str(action.get("type", "")).strip().lower()
        try:
            if kind in {"file", "range"}:
                collect_file_action(root, output_dir, action, budget, entries)
            elif kind == "head":
                collect_head_tail_action(root, output_dir, action, budget, entries, tail=False)
            elif kind == "tail":
                collect_head_tail_action(root, output_dir, action, budget, entries, tail=True)
            elif kind == "symbol":
                collect_symbol_action(root, output_dir, action, budget, entries)
            elif kind == "directory":
                collect_directory_action(root, output_dir, action, budget, entries, excludes)
            elif kind in {"pack", "zip", "paths"}:
                collect_pack_action(root, output_dir, action, budget, entries, excludes)
            elif kind in {"ls", "list"}:
                collect_ls_action(root, output_dir, action, budget, entries, excludes)
            elif kind == "tree":
                collect_tree_action(root, output_dir, action, budget, entries, excludes)
            elif kind in {"find", "glob"}:
                collect_find_action(root, output_dir, action, budget, entries, excludes)
            elif kind == "search":
                collect_search_action(root, output_dir, action, budget, entries, excludes)
            elif kind in {"references", "refs"}:
                collect_references_action(root, output_dir, action, budget, entries, excludes)
            elif kind in {"callgraph", "call_graph", "callers", "callees"}:
                collect_callgraph_action(root, output_dir, action, budget, entries, excludes)
            elif kind in {"dependencies", "dependency", "imports", "includes"}:
                collect_dependencies_action(root, output_dir, action, budget, entries, excludes)
            elif kind in {"overview", "project_overview"}:
                collect_overview_action(root, output_dir, action, budget, entries, excludes)
            elif kind in {"research", "investigate"}:
                collect_research_action(root, output_dir, action, budget, entries, excludes)
            elif kind in {"git", "git_context"}:
                collect_git_action(root, output_dir, action, budget, entries)
            elif kind in {"decompile", "ida", "ghidra"}:
                collect_decompile_action(root, output_dir, action, budget, entries)
            else:
                raise CollectionError(f"Unknown action type: {kind!r}")
        except Exception as exc:
            errors.append({"action": number, "type": kind, "error": str(exc)})
            if bool(request.get("stop_on_error", False)):
                break
    manifest = {
        "schema_version": 1,
        "tool_version": TOOL_VERSION,
        "title": title,
        "id": request_id,
        "project_root_display": ".",
        "output_dir": output_rel,
        "entries": entries,
        "entry_count": len(entries),
        "files_stored": budget.files,
        "bytes_stored": budget.bytes,
        "skipped": budget.skipped,
        "errors": errors,
        "limits": limits.__dict__,
        "project_policy": {"output_root": configured_output_rel, "request_cannot_raise_limits": True},
        "security": {
            "relative_paths_only": True,
            "sensitive_paths_excluded": True,
            "secret_values_redacted": True,
        },
    }
    write_json(output_dir / "manifest.json", manifest)
    write_json(output_dir / "request.json", request)
    lines = [
        f"# {title}", "", f"Collector: Python Patch Tool v{TOOL_VERSION}",
        f"Entries: {len(entries)}", f"Stored files: {budget.files}", f"Stored bytes: {budget.bytes}",
        f"Skipped: {len(budget.skipped)}", f"Errors: {len(errors)}", "",
        "## Send to AI", "", "Upload this ZIP. AI should read `START_HERE.md`, `manifest.json`, then only the listed files/snippets/search results.", "",
        "## Collected entries", "",
    ]
    for i, entry in enumerate(entries, 1):
        lines.append(f"{i}. `{entry.get('type')}` — `{entry.get('source') or entry.get('output')}` → `{entry.get('output','')}`")
    if budget.skipped:
        lines.extend(["", "## Skipped", ""] + [f"- `{x.get('path','')}`: {x.get('reason','')}" for x in budget.skipped[:200]])
    if errors:
        lines.extend(["", "## Errors", ""] + [f"- Action {x.get('action')}: {x.get('error')}" for x in errors])
    report = "\n".join(lines)[: limits.max_report_chars] + "\n"
    (output_dir / "report.md").write_text(report, encoding="utf-8")
    (output_dir / "START_HERE.md").write_text(
        f"# START HERE\n\nCode collection `{request_id}` generated by Patch Tool v{TOOL_VERSION}.\n\n"
        "Read `manifest.json` and `report.md`. Use only the collected relative-path evidence. "
        "Do not request whole-project source unless the current evidence is insufficient.\n",
        encoding="utf-8",
    )
    archive = create_zip(output_dir)
    result = {
        "status": "PASS" if not errors else "PARTIAL",
        "archive": archive.relative_to(root).as_posix(),
        "output_dir": output_rel,
        "entry_count": len(entries),
        "skipped_count": len(budget.skipped),
        "error_count": len(errors),
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return result


def load_request(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise CollectionError("Request file root must be an object")
    return value


def one_action_request(args: argparse.Namespace) -> dict[str, Any]:
    action: dict[str, Any] = {"type": args.command}
    for name in ("path", "start_line", "end_line", "lines", "symbol", "line_hint", "query", "regex", "case_sensitive", "context_lines", "max_matches", "max_entries", "max_depth", "tree_depth", "max_results", "kind", "collect", "address", "name", "match", "neighbors_before", "neighbors_after", "references", "source", "index"):
        if hasattr(args, name):
            value = getattr(args, name)
            if value not in (None, False, [], ""):
                key = "include_references" if name == "references" else name
                action[key] = value
    if hasattr(args, "paths") and args.paths:
        action["paths"] = args.paths
    if hasattr(args, "patterns") and args.patterns:
        action["patterns"] = args.patterns
    if hasattr(args, "sections") and args.sections:
        action["sections"] = args.sections
    if hasattr(args, "include") and args.include:
        action["include"] = args.include
    if hasattr(args, "exclude") and args.exclude:
        action["exclude"] = args.exclude
    return {"id": args.output_id or f"{args.command}_{safe_slug(str(action.get('path') or action.get('query') or action.get('name') or action.get('address') or 'request'))}", "title": args.title or f"Code collection: {args.command}", "actions": [action]}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Collect bounded, redacted project code into one AI ZIP")
    parser.add_argument("--project-root", default=".")
    parser.add_argument("--output-id")
    parser.add_argument("--title")
    sub = parser.add_subparsers(dest="command")
    req = sub.add_parser("request", help="Run a JSON collection request")
    req.add_argument("request_json")
    file_p = sub.add_parser("file", help="Collect a whole file or line range")
    file_p.add_argument("path"); file_p.add_argument("--start-line", type=int); file_p.add_argument("--end-line", type=int)
    head = sub.add_parser("head", help="Collect the first N lines of a file")
    head.add_argument("path"); head.add_argument("--lines", type=int, default=120)
    tail = sub.add_parser("tail", help="Collect the last N lines of a file")
    tail.add_argument("path"); tail.add_argument("--lines", type=int, default=120)
    sym = sub.add_parser("symbol", help="Collect a function/class/struct symbol")
    sym.add_argument("path"); sym.add_argument("symbol"); sym.add_argument("--line-hint", type=int, default=0)
    directory = sub.add_parser("directory", help="Collect bounded source files from a directory")
    directory.add_argument("path"); directory.add_argument("--include", action="append", default=[]); directory.add_argument("--exclude", action="append", default=[])
    pack = sub.add_parser("pack", help="Collect selected files/directories into one AI ZIP")
    pack.add_argument("paths", nargs="+"); pack.add_argument("--include", action="append", default=[]); pack.add_argument("--exclude", action="append", default=[])
    ls_p = sub.add_parser("ls", help="Capture a safe directory listing")
    ls_p.add_argument("path", nargs="?", default="."); ls_p.add_argument("--max-entries", type=int, default=1000)
    tree = sub.add_parser("tree", help="Capture a bounded project tree")
    tree.add_argument("path", nargs="?", default="."); tree.add_argument("--max-depth", type=int, default=4); tree.add_argument("--max-entries", type=int, default=5000); tree.add_argument("--exclude", action="append", default=[])
    find = sub.add_parser("find", help="Find paths by glob and optionally collect matching files")
    find.add_argument("patterns", nargs="+"); find.add_argument("--path", dest="paths", action="append", default=[]); find.add_argument("--kind", choices=("any", "file", "dir"), default="any"); find.add_argument("--max-results", type=int, default=5000); find.add_argument("--collect", action="store_true"); find.add_argument("--exclude", action="append", default=[])
    search = sub.add_parser("search", help="Search code and collect matching contexts")
    search.add_argument("query"); search.add_argument("--path", dest="paths", action="append", default=[]); search.add_argument("--regex", action="store_true"); search.add_argument("--case-sensitive", action="store_true", default=False); search.add_argument("--context-lines", type=int, default=4); search.add_argument("--max-matches", type=int, default=100)
    refs = sub.add_parser("references", help="Find symbol references with bounded context")
    refs.add_argument("symbol"); refs.add_argument("--path", dest="paths", action="append", default=[]); refs.add_argument("--context-lines", type=int, default=5); refs.add_argument("--max-matches", type=int, default=200)
    graph = sub.add_parser("callgraph", help="Collect a symbol, caller references, and callee candidates")
    graph.add_argument("path"); graph.add_argument("symbol"); graph.add_argument("--search-path", dest="paths", action="append", default=[]); graph.add_argument("--max-callers", dest="max_matches", type=int, default=200)
    deps = sub.add_parser("dependencies", help="Collect include/import/use dependency inventory")
    deps.add_argument("path"); deps.add_argument("--include", action="append", default=[]); deps.add_argument("--exclude", action="append", default=[])
    overview = sub.add_parser("overview", help="Collect ls/tree/build files/Git summary for project research")
    overview.add_argument("path", nargs="?", default="."); overview.add_argument("--max-depth", dest="tree_depth", type=int, default=4)
    research = sub.add_parser("research", help="Collect overview plus bounded search evidence")
    research.add_argument("query"); research.add_argument("--path", dest="paths", action="append", default=[]); research.add_argument("--regex", action="store_true"); research.add_argument("--context-lines", type=int, default=8); research.add_argument("--max-matches", type=int, default=200)
    git_p = sub.add_parser("git", help="Collect fixed safe Git status/log/diff evidence")
    git_p.add_argument("--section", dest="sections", action="append", choices=("status", "branch", "log", "diff_stat", "diff", "staged_diff", "submodules", "remotes"), default=[])
    dec = sub.add_parser("decompile", help="Extract IDA/Ghidra-style function blocks")
    dec.add_argument("source"); group = dec.add_mutually_exclusive_group(required=True); group.add_argument("--address"); group.add_argument("--name"); dec.add_argument("--match", choices=("exact", "contains", "regex"), default="contains"); dec.add_argument("--index"); dec.add_argument("--neighbors-before", type=int, default=0); dec.add_argument("--neighbors-after", type=int, default=0); dec.add_argument("--references", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    root = Path(args.project_root).expanduser().resolve()
    try:
        if not args.command:
            request_path = next((root / name for name in DEFAULT_REQUEST_NAMES if (root / name).is_file()), None)
            if request_path is None:
                parser.print_help(sys.stderr)
                print("\nNo CODE_COLLECTION_REQUEST.json found in project root.", file=sys.stderr)
                return 2
            request = load_request(request_path)
        elif args.command == "request":
            request_path, _ = resolve_project_path(root, args.request_json)
            request = load_request(request_path)
        else:
            request = one_action_request(args)
        result = run_request(request, project_root=root)
        return 0 if result["status"] == "PASS" else 3
    except (CollectionError, OSError, ValueError, re.error, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
