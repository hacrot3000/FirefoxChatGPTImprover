#!/usr/bin/env python3
from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import zipfile
from dataclasses import dataclass, field
from typing import Any, Iterable

VERSION = "5.15.13"
DEFAULT_MAX_FILE_BYTES = 8 * 1024 * 1024
DEFAULT_MAX_TOTAL_BYTES = 256 * 1024 * 1024
DEFAULT_MAX_FILES = 5000
DEFAULT_MAX_REPORT_BYTES = 16 * 1024 * 1024
DEFAULT_MAX_SNIPPETS_PER_FILE = 24
DEFAULT_EXCLUDE_GLOBS = [
    ".git/**", "**/.git/**", "node_modules/**", "**/node_modules/**",
    "patchs/reports/**", "artifacts/patch_tool_code_collections/**",
    "**/__pycache__/**", "**/*.pyc",
]

class CollectError(RuntimeError):
    pass


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def safe_id(raw: str) -> str:
    value = re.sub(r"[^A-Za-z0-9._-]+", "-", str(raw).strip()).strip("-._")
    return value or f"collection-{time.strftime('%Y%m%d-%H%M%S')}"


def relpath_under(root: Path, path: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except Exception as exc:
        raise CollectError(f"Path is outside project root: {path}") from exc


def resolve_under(root: Path, raw: str) -> Path:
    p = Path(raw)
    if not p.is_absolute():
        p = root / p
    try:
        resolved = p.resolve()
        resolved.relative_to(root.resolve())
    except Exception as exc:
        raise CollectError(f"Path escapes project root: {raw}") from exc
    return resolved


def is_probably_binary(path: Path) -> bool:
    try:
        with path.open("rb") as fh:
            chunk = fh.read(8192)
    except OSError:
        return True
    return b"\x00" in chunk


def list_all_files(root: Path, roots: list[Path], *, hidden: bool = False) -> list[Path]:
    rg = shutil.which("rg")
    if rg:
        cmd = [rg, "--files", "--null"]
        if hidden:
            cmd.append("--hidden")
        cmd.extend(str(p) for p in roots)
        try:
            raw = subprocess.check_output(cmd, cwd=str(root), stderr=subprocess.DEVNULL)
            out: list[Path] = []
            for item in raw.split(b"\0"):
                if not item:
                    continue
                p = Path(os.fsdecode(item))
                if not p.is_absolute():
                    p = root / p
                if p.is_file():
                    out.append(p.resolve())
            return out
        except Exception:
            pass
    out = []
    for r in roots:
        if r.is_file():
            out.append(r.resolve())
            continue
        if not r.is_dir():
            continue
        for base, dirs, files in os.walk(r):
            if not hidden:
                dirs[:] = [d for d in dirs if not d.startswith(".")]
            for name in files:
                if not hidden and name.startswith("."):
                    continue
                out.append((Path(base) / name).resolve())
    return out


def normalize_globs(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [str(x) for x in value if str(x).strip()]
    raise CollectError(f"Expected glob string/list, got {type(value).__name__}")


def normalize_queries(action: dict[str, Any]) -> list[str]:
    queries: list[str] = []
    q = action.get("query")
    if isinstance(q, str) and q:
        queries.append(q)
    qs = action.get("queries")
    if isinstance(qs, list):
        queries.extend(str(x) for x in qs if str(x))
    return queries


def matches_globs(rel: str, name: str, include: list[str], exclude: list[str], names: list[str], extensions: list[str]) -> bool:
    rel = rel.replace("\\", "/")
    if include and not any(fnmatch.fnmatch(rel, g) or fnmatch.fnmatch(name, g) for g in include):
        return False
    if any(fnmatch.fnmatch(rel, g) or fnmatch.fnmatch(name, g) for g in exclude):
        return False
    if names and not any(fnmatch.fnmatch(name, g) for g in names):
        return False
    if extensions:
        normalized = {e.lower() if e.startswith(".") else "." + e.lower() for e in extensions}
        if Path(name).suffix.lower() not in normalized:
            return False
    return True


def text_matches(text: str, query: str, *, regex: bool, case_sensitive: bool) -> bool:
    if regex:
        flags = 0 if case_sensitive else re.IGNORECASE
        try:
            return re.search(query, text, flags) is not None
        except re.error as exc:
            raise CollectError(f"Invalid regex {query!r}: {exc}") from exc
    if case_sensitive:
        return query in text
    return query.casefold() in text.casefold()


def content_search_rg(
    project_root: Path,
    roots: list[Path],
    query: str,
    *,
    regex: bool,
    case_sensitive: bool,
    hidden: bool,
    include_globs: list[str],
    exclude_globs: list[str],
    max_file_bytes: int,
) -> set[Path] | None:
    rg = shutil.which("rg")
    if not rg:
        return None
    cmd = [rg, "-l", "--null", "--no-messages", "--max-filesize", str(max_file_bytes)]
    if not regex:
        cmd.append("-F")
    if not case_sensitive:
        cmd.append("-i")
    if hidden:
        cmd.append("--hidden")
    for g in include_globs:
        cmd.extend(["--glob", g])
    for g in exclude_globs:
        cmd.extend(["--glob", "!" + g])
    cmd.extend(["--", query])
    cmd.extend(str(p) for p in roots)
    try:
        proc = subprocess.run(cmd, cwd=str(project_root), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False)
    except Exception:
        return None
    if proc.returncode not in (0, 1):
        return None
    out: set[Path] = set()
    for item in proc.stdout.split(b"\0"):
        if not item:
            continue
        p = Path(os.fsdecode(item))
        if not p.is_absolute():
            p = project_root / p
        if p.is_file():
            out.add(p.resolve())
    return out


@dataclass
class ActionResult:
    action_id: str
    title: str
    action_type: str
    files: list[Path] = field(default_factory=list)
    skipped: list[dict[str, Any]] = field(default_factory=list)
    snippets: dict[str, list[str]] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


def filtered_candidates(project_root: Path, action: dict[str, Any], global_excludes: list[str], max_file_bytes: int) -> list[Path]:
    raw_paths = action.get("paths") or ["."]
    if isinstance(raw_paths, str):
        raw_paths = [raw_paths]
    roots = [resolve_under(project_root, str(x)) for x in raw_paths]
    hidden = bool(action.get("hidden", False))
    include = normalize_globs(action.get("include_globs"))
    exclude = [*global_excludes, *normalize_globs(action.get("exclude_globs"))]
    name_globs = normalize_globs(action.get("name_globs"))
    extensions = [str(x) for x in (action.get("extensions") or [])]
    out = []
    for p in list_all_files(project_root, roots, hidden=hidden):
        try:
            rel = relpath_under(project_root, p)
            st = p.stat()
        except OSError:
            continue
        if not matches_globs(rel, p.name, include, exclude, name_globs, extensions):
            continue
        if st.st_size > max_file_bytes:
            continue
        out.append(p)
    return sorted(set(out), key=lambda x: relpath_under(project_root, x).lower())


def run_content_action(project_root: Path, action: dict[str, Any], global_excludes: list[str], max_file_bytes: int) -> ActionResult:
    aid = safe_id(action.get("id") or "content")
    title = str(action.get("title") or aid)
    queries = normalize_queries(action)
    if not queries:
        raise CollectError(f"Action {aid}: content search requires query/queries")
    regex = bool(action.get("regex", False))
    case_sensitive = bool(action.get("case_sensitive", True))
    mode = str(action.get("match_mode", "any")).lower()
    if mode not in {"any", "all"}:
        raise CollectError(f"Action {aid}: match_mode must be any/all")
    raw_paths = action.get("paths") or ["."]
    if isinstance(raw_paths, str):
        raw_paths = [raw_paths]
    roots = [resolve_under(project_root, str(x)) for x in raw_paths]
    hidden = bool(action.get("hidden", False))
    include = normalize_globs(action.get("include_globs"))
    excludes = [*global_excludes, *normalize_globs(action.get("exclude_globs"))]
    names = normalize_globs(action.get("name_globs"))
    extensions = [str(x) for x in (action.get("extensions") or [])]

    sets: list[set[Path]] = []
    for query in queries:
        found = content_search_rg(project_root, roots, query, regex=regex, case_sensitive=case_sensitive,
                                  hidden=hidden, include_globs=include, exclude_globs=excludes,
                                  max_file_bytes=max_file_bytes)
        if found is None:
            candidates = filtered_candidates(project_root, action, global_excludes, max_file_bytes)
            found = set()
            for p in candidates:
                if is_probably_binary(p) and not bool(action.get("binary", False)):
                    continue
                try:
                    text = p.read_text(encoding="utf-8", errors="replace")
                except OSError:
                    continue
                if text_matches(text, query, regex=regex, case_sensitive=case_sensitive):
                    found.add(p)
        # post-filter for name/extensions because rg globs don't know our extension convenience semantics
        clean = set()
        for p in found:
            try:
                rel = relpath_under(project_root, p)
                if p.stat().st_size > max_file_bytes:
                    continue
            except OSError:
                continue
            if matches_globs(rel, p.name, include, excludes, names, extensions):
                clean.add(p)
        sets.append(clean)
    matched = set.union(*sets) if mode == "any" else set.intersection(*sets)

    exclude_queries = action.get("exclude_queries") or []
    if isinstance(exclude_queries, str):
        exclude_queries = [exclude_queries]
    if exclude_queries:
        remove: set[Path] = set()
        for p in matched:
            try:
                text = p.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            if any(text_matches(text, str(q), regex=regex, case_sensitive=case_sensitive) for q in exclude_queries):
                remove.add(p)
        matched -= remove

    return ActionResult(aid, title, "content", sorted(matched, key=lambda x: relpath_under(project_root, x).lower()))


def run_filename_action(project_root: Path, action: dict[str, Any], global_excludes: list[str], max_file_bytes: int) -> ActionResult:
    aid = safe_id(action.get("id") or "filename")
    title = str(action.get("title") or aid)
    action = dict(action)
    patterns = normalize_globs(action.get("patterns")) or normalize_globs(action.get("name_globs"))
    if patterns:
        action["name_globs"] = patterns
    files = filtered_candidates(project_root, action, global_excludes, max_file_bytes)
    return ActionResult(aid, title, "filename", files)


def run_explicit_action(project_root: Path, action: dict[str, Any]) -> ActionResult:
    aid = safe_id(action.get("id") or "explicit")
    title = str(action.get("title") or aid)
    raw = action.get("files") or action.get("paths") or []
    if isinstance(raw, str):
        raw = [raw]
    out = []
    for item in raw:
        p = resolve_under(project_root, str(item))
        if p.is_file():
            out.append(p)
    return ActionResult(aid, title, "explicit", sorted(set(out), key=lambda x: relpath_under(project_root, x).lower()))


def run_git_changed_action(project_root: Path, action: dict[str, Any], global_excludes: list[str], max_file_bytes: int) -> ActionResult:
    aid = safe_id(action.get("id") or "git-changed")
    title = str(action.get("title") or aid)
    wanted = {str(x).lower() for x in (action.get("status") or ["modified", "added", "untracked", "renamed"])}
    map_status = {"M": "modified", "A": "added", "?": "untracked", "R": "renamed", "D": "deleted", "C": "copied", "U": "unmerged"}
    try:
        raw = subprocess.check_output(["git", "status", "--porcelain=v1", "-z", "--untracked-files=all"], cwd=str(project_root))
    except Exception as exc:
        raise CollectError(f"Action {aid}: git status failed: {exc}") from exc
    tokens = raw.split(b"\0")
    out: list[Path] = []
    i = 0
    while i < len(tokens):
        rec = tokens[i]
        i += 1
        if not rec:
            continue
        text = os.fsdecode(rec)
        if len(text) < 4:
            continue
        xy = text[:2]
        path_text = text[3:]
        if "R" in xy or "C" in xy:
            if i < len(tokens) and tokens[i]:
                path_text = os.fsdecode(tokens[i])
                i += 1
        states = {map_status.get(ch) for ch in xy if ch.strip()}
        states.discard(None)
        if not states & wanted:
            continue
        p = resolve_under(project_root, path_text)
        if not p.is_file():
            continue
        try:
            rel = relpath_under(project_root, p)
            if p.stat().st_size > max_file_bytes:
                continue
        except OSError:
            continue
        if matches_globs(rel, p.name, normalize_globs(action.get("include_globs")),
                         [*global_excludes, *normalize_globs(action.get("exclude_globs"))],
                         normalize_globs(action.get("name_globs")),
                         [str(x) for x in (action.get("extensions") or [])]):
            out.append(p)
    return ActionResult(aid, title, "git_changed", sorted(set(out), key=lambda x: relpath_under(project_root, x).lower()))




# ---------------------------------------------------------------------------
# v5.15.13 symbol/dependency discovery. These are intentionally parser-light:
# exact text occurrences are evidence; caller/callee/dependency resolution is
# reported as heuristic provenance and never modifies the source tree.
# ---------------------------------------------------------------------------

SOURCE_EXTENSIONS = {
    ".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".hh", ".hxx",
    ".inc", ".inl", ".ipp", ".tcc", ".cu", ".cuh", ".m", ".mm",
    ".py", ".pyi", ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx",
    ".vue", ".svelte", ".java", ".kt", ".kts", ".cs", ".go", ".rs",
    ".swift", ".nim", ".nims", ".lua", ".rb", ".php", ".sh", ".bash",
    ".dart", ".scala", ".groovy", ".ex", ".exs", ".erl", ".hrl", ".pl", ".pm",
}
CALL_KEYWORDS = {
    "if", "for", "while", "switch", "catch", "return", "sizeof", "typeof",
    "new", "delete", "throw", "assert", "print", "echo", "match", "with",
    "super", "this", "self", "function", "def", "class", "struct", "enum",
}


def _read_lines(path: Path) -> list[str]:
    try:
        return path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []


def _function_name_from_line(line: str, suffix: str) -> str | None:
    patterns: list[str] = []
    if suffix in {".py", ".pyi"}:
        patterns = [r"^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\("]
    elif suffix in {".nim", ".nims"}:
        patterns = [r"^\s*(?:proc|func|method|iterator|template|macro)\s+([A-Za-z_]\w*)"]
    elif suffix == ".lua":
        patterns = [r"^\s*(?:local\s+)?function\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\("]
    elif suffix in {".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"}:
        patterns = [
            r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(",
            r"^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>",
            r"^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*\{",
        ]
    elif suffix == ".go":
        patterns = [r"^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\("]
    elif suffix == ".rs":
        patterns = [r"^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*\("]
    elif suffix == ".swift":
        patterns = [r"^\s*(?:public\s+|private\s+|internal\s+|fileprivate\s+|open\s+|static\s+|class\s+)*func\s+([A-Za-z_]\w*)\s*\("]
    elif suffix == ".rb":
        patterns = [r"^\s*def\s+(?:self\.)?([A-Za-z_]\w*[!?=]?)"]
    else:
        patterns = [
            r"^\s*(?:[A-Za-z_][\w:<>,~*&\[\]\s]*\s+)+([A-Za-z_]\w*)\s*\([^;{}]*\)\s*(?:const\s*)?(?:noexcept\s*)?(?:->[^{}]+)?\s*\{",
        ]
    for pat in patterns:
        m = re.search(pat, line)
        if m:
            name = m.group(1).split(".")[-1]
            if name not in CALL_KEYWORDS:
                return name
    return None


def _function_ranges(path: Path) -> list[dict[str, Any]]:
    lines = _read_lines(path)
    starts: list[tuple[int, str]] = []
    suffix = path.suffix.lower()
    for idx, line in enumerate(lines):
        name = _function_name_from_line(line, suffix)
        if name:
            starts.append((idx, name))
    out: list[dict[str, Any]] = []
    for pos, (start, name) in enumerate(starts):
        end = (starts[pos + 1][0] - 1) if pos + 1 < len(starts) else max(start, len(lines) - 1)
        # For brace languages, stop at balanced closing brace when possible.
        if suffix not in {".py", ".pyi", ".nim", ".nims", ".lua", ".rb"}:
            depth = 0
            seen = False
            for i in range(start, min(len(lines), start + 1200)):
                text = re.sub(r"//.*$", "", lines[i])
                opens = text.count("{")
                closes = text.count("}")
                if opens:
                    seen = True
                depth += opens - closes
                if seen and depth <= 0:
                    end = min(end, i)
                    break
        out.append({"name": name, "start": start, "end": end})
    return out


def _location(project_root: Path, path: Path, line_idx: int, *, kind: str, symbol: str | None = None, owner: str | None = None) -> dict[str, Any]:
    data: dict[str, Any] = {
        "path": relpath_under(project_root, path),
        "line": line_idx + 1,
        "kind": kind,
        "resolution": "text" if kind == "reference" else "heuristic",
    }
    if symbol:
        data["symbol"] = symbol
    if owner:
        data["owner"] = owner
    return data


def _symbol_regex(symbol: str, *, case_sensitive: bool, whole_word: bool = True) -> re.Pattern[str]:
    expr = re.escape(symbol)
    if whole_word and re.match(r"^[A-Za-z_]\w*$", symbol):
        expr = rf"\b{expr}\b"
    return re.compile(expr, 0 if case_sensitive else re.IGNORECASE)


def _definition_lines(path: Path, symbol: str, functions: list[dict[str, Any]], *, case_sensitive: bool) -> list[int]:
    cmp = (lambda a, b: a == b) if case_sensitive else (lambda a, b: a.casefold() == b.casefold())
    defs = [int(fr["start"]) for fr in functions if cmp(str(fr["name"]), symbol)]
    lines = _read_lines(path)
    sym = re.escape(symbol)
    flags = 0 if case_sensitive else re.IGNORECASE
    decl = re.compile(
        rf"^\s*(?:(?:class|struct|enum|interface|trait|type|object|namespace|module|const|let|var|typedef)\s+{sym}\b|"
        rf"(?:export\s+)?(?:const|let|var)\s+{sym}\s*=|"
        rf"(?:local\s+)?{sym}\s*=)", flags)
    for idx, line in enumerate(lines):
        if decl.search(line):
            defs.append(idx)
    return sorted(set(defs))


def _containing_function(ranges: list[dict[str, Any]], line_idx: int) -> dict[str, Any] | None:
    for fr in ranges:
        if int(fr["start"]) <= line_idx <= int(fr["end"]):
            return fr
    return None


def _callee_names(path: Path, fr: dict[str, Any], *, limit: int) -> list[str]:
    lines = _read_lines(path)
    body = "\n".join(lines[int(fr["start"]): int(fr["end"]) + 1])
    names: list[str] = []
    seen: set[str] = set()
    for m in re.finditer(r"\b([A-Za-z_]\w*)\s*\(", body):
        name = m.group(1)
        if name in CALL_KEYWORDS or name == fr.get("name") or name in seen:
            continue
        seen.add(name)
        names.append(name)
        if len(names) >= limit:
            break
    return names


def _candidate_source_files(project_root: Path, action: dict[str, Any], global_excludes: list[str], max_file_bytes: int) -> list[Path]:
    candidates = filtered_candidates(project_root, action, global_excludes, max_file_bytes)
    requested = {str(x).lower() if str(x).startswith(".") else "." + str(x).lower() for x in (action.get("extensions") or [])}
    allowed = SOURCE_EXTENSIONS | requested
    return [p for p in candidates if p.suffix.lower() in allowed and not is_probably_binary(p)]


def _dependency_specs(path: Path) -> list[dict[str, Any]]:
    lines = _read_lines(path)
    suffix = path.suffix.lower()
    out: list[dict[str, Any]] = []
    for idx, line in enumerate(lines):
        specs: list[tuple[str, str]] = []
        if suffix in {".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".hh", ".hxx", ".m", ".mm"}:
            m = re.match(r"\s*#\s*include\s*[\"<]([^\">]+)[\">]", line)
            if m:
                specs.append(("include", m.group(1)))
        elif suffix in {".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"}:
            for m in re.finditer(r"(?:from\s+|import\s*\(|require\s*\()\s*[\"']([^\"']+)[\"']", line):
                specs.append(("import", m.group(1)))
            m = re.match(r"\s*import\s+[\"']([^\"']+)[\"']", line)
            if m:
                specs.append(("import", m.group(1)))
        elif suffix in {".py", ".pyi"}:
            m = re.match(r"\s*from\s+([\.A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+import\b", line)
            if m:
                specs.append(("import", m.group(1)))
            m = re.match(r"\s*import\s+(.+)$", line)
            if m:
                for part in m.group(1).split(","):
                    specs.append(("import", part.strip().split()[0]))
        elif suffix in {".nim", ".nims"}:
            m = re.match(r"\s*(?:import|include)\s+(.+)$", line)
            if m:
                raw = m.group(1).split("#", 1)[0]
                for part in raw.split(","):
                    spec = part.strip().strip('"')
                    if spec:
                        specs.append(("import", spec))
        elif suffix == ".lua":
            for m in re.finditer(r"\brequire\s*\(?\s*[\"']([^\"']+)[\"']", line):
                specs.append(("require", m.group(1)))
        elif suffix == ".rs":
            m = re.match(r"\s*mod\s+([A-Za-z_]\w*)\s*;", line)
            if m:
                specs.append(("module", m.group(1)))
        for kind, spec in specs:
            out.append({"kind": kind, "spec": spec, "line": idx + 1})
    return out


def _path_index(project_root: Path, files: list[Path]) -> tuple[dict[str, Path], dict[str, list[Path]]]:
    by_rel: dict[str, Path] = {}
    by_suffix: dict[str, list[Path]] = {}
    for p in files:
        rel = relpath_under(project_root, p)
        by_rel[rel] = p
        parts = rel.split("/")
        for n in range(1, min(len(parts), 6) + 1):
            key = "/".join(parts[-n:])
            by_suffix.setdefault(key, []).append(p)
    return by_rel, by_suffix


def _resolve_dependency(project_root: Path, source: Path, spec: str, by_rel: dict[str, Path], by_suffix: dict[str, list[Path]]) -> Path | None:
    spec = spec.strip().strip('"\'')
    suffix = source.suffix.lower()
    candidates: list[Path] = []
    def add(raw: Path) -> None:
        try:
            r = raw.resolve()
            r.relative_to(project_root.resolve())
        except Exception:
            return
        candidates.append(r)
    if suffix in {".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".hh", ".hxx", ".m", ".mm"}:
        add(source.parent / spec)
        for rel, p in by_rel.items():
            if rel.endswith("/" + spec) or rel == spec:
                candidates.append(p)
    elif suffix in {".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"}:
        if spec.startswith("."):
            base = source.parent / spec
            for ext in ("", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json"):
                add(Path(str(base) + ext))
            for ext in (".js", ".ts", ".tsx", ".jsx"):
                add(base / ("index" + ext))
        else:
            return None
    elif suffix in {".py", ".pyi"}:
        dots = len(spec) - len(spec.lstrip("."))
        mod = spec.lstrip(".").replace(".", "/")
        base = source.parent
        for _ in range(max(0, dots - 1)):
            base = base.parent
        if mod:
            add(base / (mod + ".py"))
            add(base / mod / "__init__.py")
            matches = by_suffix.get(mod + ".py", []) + by_suffix.get(mod + "/__init__.py", [])
            candidates.extend(matches)
    elif suffix in {".nim", ".nims"}:
        raw = spec.replace(".", "/") if "/" not in spec else spec
        add(source.parent / (raw if raw.endswith((".nim", ".nims")) else raw + ".nim"))
        candidates.extend(by_suffix.get(raw + ".nim", []))
    elif suffix == ".lua":
        raw = spec.replace(".", "/")
        add(source.parent / (raw + ".lua"))
        candidates.extend(by_suffix.get(raw + ".lua", []))
        candidates.extend(by_suffix.get(raw + "/init.lua", []))
    elif suffix == ".rs":
        add(source.parent / (spec + ".rs"))
        add(source.parent / spec / "mod.rs")
    for p in candidates:
        if p.is_file():
            return p.resolve()
    return None


def _dependency_closure(project_root: Path, seeds: list[Path], index_files: list[Path], *, depth: int, max_files: int) -> tuple[list[Path], list[dict[str, Any]], list[dict[str, Any]]]:
    by_rel, by_suffix = _path_index(project_root, index_files)
    selected: dict[str, Path] = {relpath_under(project_root, p): p for p in seeds}
    frontier = list(seeds)
    edges: list[dict[str, Any]] = []
    unresolved: list[dict[str, Any]] = []
    for level in range(max(0, depth)):
        next_frontier: list[Path] = []
        for source in frontier:
            for dep in _dependency_specs(source):
                target = _resolve_dependency(project_root, source, str(dep["spec"]), by_rel, by_suffix)
                edge = {
                    "from": relpath_under(project_root, source),
                    "line": dep["line"],
                    "kind": dep["kind"],
                    "spec": dep["spec"],
                    "depth": level + 1,
                    "resolution": "heuristic",
                }
                if target is None:
                    unresolved.append(edge)
                    continue
                rel = relpath_under(project_root, target)
                edge["to"] = rel
                edges.append(edge)
                if rel not in selected and len(selected) < max_files:
                    selected[rel] = target
                    next_frontier.append(target)
        frontier = next_frontier
        if not frontier or len(selected) >= max_files:
            break
    return [selected[k] for k in sorted(selected, key=str.lower)], edges, unresolved


def _add_context_snippet(project_root: Path, result: ActionResult, path: Path, lines_idx: list[int], context: int, *, cap: int = 32) -> None:
    if not lines_idx:
        return
    lines = _read_lines(path)
    rel = relpath_under(project_root, path)
    windows: list[tuple[int, int]] = []
    for idx in sorted(set(lines_idx))[:cap]:
        a = max(0, idx - context)
        b = min(len(lines), idx + context + 1)
        if windows and a <= windows[-1][1]:
            windows[-1] = (windows[-1][0], max(windows[-1][1], b))
        else:
            windows.append((a, b))
    chunks: list[str] = []
    for a, b in windows:
        chunks.append(f"--- {rel}:{a+1}-{b} ---")
        for idx in range(a, b):
            chunks.append(f"{idx+1:7d}: {lines[idx]}")
    result.snippets[rel] = chunks


def run_dependency_action(project_root: Path, action: dict[str, Any], global_excludes: list[str], max_file_bytes: int) -> ActionResult:
    aid = safe_id(action.get("id") or "dependencies")
    title = str(action.get("title") or aid)
    raw_files = action.get("files") or action.get("seed_files") or []
    if isinstance(raw_files, str):
        raw_files = [raw_files]
    seeds: list[Path] = []
    for item in raw_files:
        p = resolve_under(project_root, str(item))
        if p.is_file():
            seeds.append(p)
    if not seeds:
        seeds = _candidate_source_files(project_root, action, global_excludes, max_file_bytes)
    if not seeds:
        raise CollectError(f"Action {aid}: dependency closure has no seed files")
    max_seed_files = max(1, int(action.get("max_seed_files", 100)))
    if len(seeds) > max_seed_files and not bool(action.get("allow_many_seeds", False)):
        raise CollectError(
            f"Action {aid}: {len(seeds)} seed files exceed max_seed_files={max_seed_files}; "
            "use files/seed_files/name_globs to narrow the seeds or set allow_many_seeds=true explicitly"
        )
    index_action = dict(action)
    index_action.pop("files", None)
    index_action.pop("seed_files", None)
    index_files = _candidate_source_files(project_root, index_action, global_excludes, max_file_bytes)
    # Ensure seeds are resolvable even when filters are tight.
    index_files = sorted(set(index_files + seeds), key=lambda p: relpath_under(project_root, p).lower())
    depth = max(0, int(action.get("depth", 2)))
    max_dep_files = max(1, int(action.get("max_dependency_files", 500)))
    max_dep_edges = max(1, int(action.get("max_dependency_edges", 5000)))
    files, edges, unresolved = _dependency_closure(project_root, seeds, index_files, depth=depth, max_files=max_dep_files)
    result = ActionResult(aid, title, "dependency_closure", files)
    result.metadata = {
        "resolution": "heuristic",
        "seed_files": [relpath_under(project_root, p) for p in seeds],
        "depth": depth,
        "dependency_edges": edges[:max_dep_edges],
        "unresolved_dependencies": unresolved[:max_dep_edges],
        "dependency_edges_truncated": len(edges) > max_dep_edges or len(unresolved) > max_dep_edges,
    }
    return result


def run_symbol_graph_action(project_root: Path, action: dict[str, Any], global_excludes: list[str], max_file_bytes: int) -> ActionResult:
    aid = safe_id(action.get("id") or "symbols")
    title = str(action.get("title") or aid)
    raw_symbols = action.get("symbols") or action.get("symbol") or []
    if isinstance(raw_symbols, str):
        raw_symbols = [raw_symbols]
    symbols = [str(x).strip() for x in raw_symbols if str(x).strip()]
    if not symbols:
        raise CollectError(f"Action {aid}: symbol_graph requires symbol/symbols")
    case_sensitive = bool(action.get("case_sensitive", True))
    whole_word = bool(action.get("whole_word", True))
    include_refs = bool(action.get("include_references", True))
    include_callers = bool(action.get("include_callers", True))
    include_callees = bool(action.get("include_callees", True))
    include_deps = bool(action.get("include_dependencies", True))
    context = max(0, int(action.get("context_lines", action.get("context", 6))))
    callee_limit = max(0, int(action.get("max_callees", 40)))
    max_occurrences = max(1, int(action.get("max_occurrences", 1000)))
    max_callers = max(1, int(action.get("max_callers", 250)))
    max_dependency_edges = max(1, int(action.get("max_dependency_edges", 3000)))
    candidates = _candidate_source_files(project_root, action, global_excludes, max_file_bytes)
    if not candidates:
        raise CollectError(f"Action {aid}: no source candidates under selected paths")

    function_cache: dict[Path, list[dict[str, Any]]] = {}
    def funcs(path: Path) -> list[dict[str, Any]]:
        if path not in function_cache:
            function_cache[path] = _function_ranges(path)
        return function_cache[path]

    selected: dict[str, Path] = {}
    details: dict[str, Any] = {}
    snippet_lines: dict[Path, list[int]] = {}
    for symbol in symbols:
        rx = _symbol_regex(symbol, case_sensitive=case_sensitive, whole_word=whole_word)
        definition_locs: list[dict[str, Any]] = []
        reference_locs: list[dict[str, Any]] = []
        caller_locs: list[dict[str, Any]] = []
        definition_functions: list[tuple[Path, dict[str, Any]]] = []
        reference_files: set[Path] = set()

        # Use rg to narrow files when available, then inspect exact lines/functions.
        roots_raw = action.get("paths") or ["."]
        if isinstance(roots_raw, str):
            roots_raw = [roots_raw]
        roots = [resolve_under(project_root, str(x)) for x in roots_raw]
        narrowed = content_search_rg(project_root, roots, symbol, regex=False, case_sensitive=case_sensitive,
                                     hidden=bool(action.get("hidden", False)),
                                     include_globs=normalize_globs(action.get("include_globs")),
                                     exclude_globs=[*global_excludes, *normalize_globs(action.get("exclude_globs"))],
                                     max_file_bytes=max_file_bytes)
        scan_files = [p for p in candidates if narrowed is None or p in narrowed]
        for path in scan_files:
            lines = _read_lines(path)
            franges = funcs(path)
            dlines = _definition_lines(path, symbol, franges, case_sensitive=case_sensitive)
            dset = set(dlines)
            for idx in dlines:
                definition_locs.append(_location(project_root, path, idx, kind="definition", symbol=symbol))
                snippet_lines.setdefault(path, []).append(idx)
                fr = _containing_function(franges, idx)
                if fr and str(fr.get("name", "")).casefold() == symbol.casefold():
                    definition_functions.append((path, fr))
                selected[relpath_under(project_root, path)] = path
            for idx, line in enumerate(lines):
                if not rx.search(line):
                    continue
                reference_files.add(path)
                if idx not in dset and len(reference_locs) < max_occurrences:
                    reference_locs.append(_location(project_root, path, idx, kind="reference", symbol=symbol))
                snippet_lines.setdefault(path, []).append(idx)
                owner = _containing_function(franges, idx)
                if include_callers and owner and str(owner.get("name", "")).casefold() != symbol.casefold():
                    loc = _location(project_root, path, int(owner["start"]), kind="caller", symbol=symbol, owner=str(owner["name"]))
                    if loc not in caller_locs and len(caller_locs) < max_callers:
                        caller_locs.append(loc)
                    selected[relpath_under(project_root, path)] = path
            if include_refs and path in reference_files:
                selected[relpath_under(project_root, path)] = path

        callees: list[dict[str, Any]] = []
        if include_callees and callee_limit:
            callee_names: list[str] = []
            seen: set[str] = set()
            for path, fr in definition_functions:
                for name in _callee_names(path, fr, limit=callee_limit):
                    if name in seen:
                        continue
                    seen.add(name)
                    callee_names.append(name)
                    if len(callee_names) >= callee_limit:
                        break
            for callee in callee_names:
                crx = _symbol_regex(callee, case_sensitive=True, whole_word=True)
                found_defs: list[dict[str, Any]] = []
                # rg narrows candidate files containing callee; function parser determines defs.
                roots_raw = action.get("paths") or ["."]
                if isinstance(roots_raw, str): roots_raw = [roots_raw]
                roots = [resolve_under(project_root, str(x)) for x in roots_raw]
                narrowed = content_search_rg(project_root, roots, callee, regex=False, case_sensitive=True,
                                             hidden=bool(action.get("hidden", False)),
                                             include_globs=normalize_globs(action.get("include_globs")),
                                             exclude_globs=[*global_excludes, *normalize_globs(action.get("exclude_globs"))],
                                             max_file_bytes=max_file_bytes)
                scan = [p for p in candidates if narrowed is None or p in narrowed]
                for path in scan:
                    for idx in _definition_lines(path, callee, funcs(path), case_sensitive=True):
                        found_defs.append(_location(project_root, path, idx, kind="callee_definition", symbol=callee, owner=symbol))
                        selected[relpath_under(project_root, path)] = path
                        snippet_lines.setdefault(path, []).append(idx)
                callees.append({"name": callee, "definitions": found_defs, "resolution": "heuristic"})

        details[symbol] = {
            "definitions": definition_locs,
            "references": reference_locs,
            "callers": caller_locs,
            "callees": callees,
            "limits": {"max_occurrences": max_occurrences, "max_callers": max_callers, "max_callees": callee_limit},
            "truncated": {
                "references": len(reference_locs) >= max_occurrences,
                "callers": len(caller_locs) >= max_callers,
                "callees": len(callees) >= callee_limit if callee_limit else False,
            },
        }

    dep_edges: list[dict[str, Any]] = []
    dep_unresolved: list[dict[str, Any]] = []
    if include_deps and selected:
        depth = max(0, int(action.get("dependency_depth", 1)))
        max_dep_files = max(1, int(action.get("max_dependency_files", 300)))
        dep_files, dep_edges, dep_unresolved = _dependency_closure(
            project_root, list(selected.values()), candidates, depth=depth, max_files=max_dep_files)
        for p in dep_files:
            selected[relpath_under(project_root, p)] = p

    files = [selected[k] for k in sorted(selected, key=str.lower)]
    result = ActionResult(aid, title, "symbol_graph", files)
    result.metadata = {
        "resolution": {
            "occurrences": "text",
            "definitions": "heuristic",
            "callers": "heuristic",
            "callees": "heuristic",
            "dependencies": "heuristic",
        },
        "symbols": details,
        "dependency_edges": dep_edges[:max_dependency_edges],
        "unresolved_dependencies": dep_unresolved[:max_dependency_edges],
        "dependency_edges_truncated": len(dep_edges) > max_dependency_edges or len(dep_unresolved) > max_dependency_edges,
    }
    for path, indices in snippet_lines.items():
        _add_context_snippet(project_root, result, path, indices, context)
    return result


def _merge_snippets(target: ActionResult, source: ActionResult) -> None:
    for rel, chunks in source.snippets.items():
        bucket = target.snippets.setdefault(rel, [])
        for chunk in chunks:
            if chunk not in bucket:
                bucket.append(chunk)


def _simple_query_identifiers(queries: list[str], *, regex: bool) -> list[str]:
    """Extract conservative identifier seeds from search queries.

    This is intentionally parser-light. It is useful for patterns such as
    ``GetServerUrl|saveServerId`` but avoids short/common control keywords.
    """
    out: list[str] = []
    seen: set[str] = set()
    for query in queries:
        tokens = re.findall(r"[A-Za-z_$][A-Za-z0-9_$]*", query)
        if not regex and re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", query or ""):
            tokens = [query]
        for token in tokens:
            if len(token) < 3 or token in CALL_KEYWORDS or token in seen:
                continue
            seen.add(token)
            out.append(token)
    return out


def _query_owner_symbols(project_root: Path, files: list[Path], queries: list[str], *, regex: bool,
                         case_sensitive: bool, max_symbols: int) -> list[str]:
    flags = 0 if case_sensitive else re.IGNORECASE
    patterns: list[re.Pattern[str]] = []
    for q in queries:
        try:
            patterns.append(re.compile(q if regex else re.escape(q), flags))
        except re.error:
            continue
    out: list[str] = []
    seen: set[str] = set()
    for path in files:
        lines = _read_lines(path)
        ranges = _function_ranges(path)
        for idx, line in enumerate(lines):
            if patterns and not any(rx.search(line) for rx in patterns):
                continue
            owner = _containing_function(ranges, idx)
            if owner:
                name = str(owner.get("name") or "").strip()
                if name and name not in CALL_KEYWORDS and name not in seen:
                    seen.add(name)
                    out.append(name)
                    if len(out) >= max_symbols:
                        return out
    return out


def _investigation_relevance(
    project_root: Path,
    selected: dict[str, Path],
    rounds_meta: list[dict[str, Any]],
    seed_content_files: list[str],
    *,
    max_relevant_files: int,
    min_relevance_score: float,
    trim_low_relevance: bool,
) -> tuple[list[Path], list[dict[str, Any]], list[str]]:
    """Rank bounded-investigation files by evidence strength and graph distance.

    The score is for packaging priority only. It never upgrades heuristic graph
    edges into exact evidence. Exact seed-content files are always retained.
    """
    scores: dict[str, float] = {rel: 0.0 for rel in selected}
    reasons: dict[str, list[str]] = {rel: [] for rel in selected}
    seed_set = {str(x) for x in seed_content_files}

    def add(rel: Any, points: float, reason: str) -> None:
        if not isinstance(rel, str) or rel not in scores:
            return
        scores[rel] += max(0.0, float(points))
        bucket = reasons[rel]
        if reason not in bucket:
            bucket.append(reason)

    for rel in seed_set:
        add(rel, 120.0, 'exact_seed_content')

    for round_info in rounds_meta:
        try: round_idx = int(round_info.get('round', 0))
        except Exception: round_idx = 0
        penalty = min(36.0, 9.0 * round_idx)
        graph = round_info.get('graph_details') if isinstance(round_info, dict) else {}
        if not isinstance(graph, dict):
            continue
        symbols = graph.get('symbols') if isinstance(graph.get('symbols'), dict) else {}
        for _symbol, info in symbols.items():
            if not isinstance(info, dict): continue
            for loc in info.get('definitions', []) or []:
                if isinstance(loc, dict): add(loc.get('file'), 105.0-penalty, f'definition:r{round_idx}')
            for loc in info.get('references', []) or []:
                if isinstance(loc, dict): add(loc.get('file'), 78.0-penalty, f'reference:r{round_idx}')
            for loc in info.get('callers', []) or []:
                if isinstance(loc, dict): add(loc.get('file'), 72.0-penalty, f'caller:r{round_idx}')
            for callee in info.get('callees', []) or []:
                if not isinstance(callee, dict): continue
                for loc in callee.get('definitions', []) or []:
                    if isinstance(loc, dict): add(loc.get('file'), 64.0-penalty, f'callee_definition:r{round_idx}')
        for edge in graph.get('dependency_edges', []) or []:
            if not isinstance(edge, dict): continue
            add(edge.get('from'), 25.0-penalty/2, f'dependency_source:r{round_idx}')
            add(edge.get('to'), 34.0-penalty/2, f'dependency_target:r{round_idx}')

    ranking=[]
    for rel in selected:
        ranking.append({
            'file': rel,
            'score': round(scores.get(rel,0.0), 2),
            'reasons': reasons.get(rel, []),
            'mandatory_seed': rel in seed_set,
        })
    ranking.sort(key=lambda x: (-float(x['score']), str(x['file']).lower()))

    kept=[]; dropped=[]
    for item in ranking:
        rel=str(item['file'])
        mandatory=bool(item['mandatory_seed'])
        eligible = mandatory or float(item['score']) >= min_relevance_score
        if trim_low_relevance and not eligible:
            dropped.append(rel); continue
        if len(kept) >= max_relevant_files and not mandatory:
            dropped.append(rel); continue
        kept.append(rel)
    # Mandatory exact seed evidence must never be trimmed by the packaging cap.
    for rel in sorted(seed_set, key=str.lower):
        if rel in selected and rel not in kept:
            kept.append(rel)
    return [selected[r] for r in kept if r in selected], ranking, dropped


def run_investigation_action(project_root: Path, action: dict[str, Any], global_excludes: list[str], max_file_bytes: int) -> ActionResult:
    """Bounded automatic investigation expansion.

    Start from explicit symbols and/or content queries. Then expand through
    heuristic caller/callee edges and local dependencies for a bounded number
    of rounds. Exact content occurrences remain text evidence; graph expansion
    is always marked heuristic in the manifest/report.
    """
    aid = safe_id(action.get("id") or "investigation")
    title = str(action.get("title") or aid)
    raw_symbols = action.get("symbols") or action.get("symbol") or []
    if isinstance(raw_symbols, str):
        raw_symbols = [raw_symbols]
    explicit_symbols = [str(x).strip() for x in raw_symbols if str(x).strip()]
    queries = normalize_queries(action)
    if not explicit_symbols and not queries:
        raise CollectError(f"Action {aid}: investigate requires symbol/symbols and/or query/queries")

    max_rounds = max(1, int(action.get("max_rounds", action.get("rounds", 2))))
    max_symbols = max(1, int(action.get("max_symbols", 80)))
    max_new_symbols = max(1, int(action.get("max_new_symbols_per_round", 24)))
    max_investigation_files = max(1, int(action.get("max_investigation_files", 500)))
    context = max(0, int(action.get("context_lines", action.get("context", 6))))
    regex = bool(action.get("regex", False))
    case_sensitive = bool(action.get("case_sensitive", True))
    include_query_symbols = bool(action.get("seed_query_identifiers", True))
    include_callers = bool(action.get("include_callers", True))
    include_callees = bool(action.get("include_callees", True))
    include_dependencies = bool(action.get("include_dependencies", True))

    result = ActionResult(aid, title, "auto_investigation", [])
    selected: dict[str, Path] = {}
    evidence: list[dict[str, Any]] = []
    rounds_meta: list[dict[str, Any]] = []

    # Seed content search is retained as exact evidence and can infer the
    # containing function(s) around textual matches.
    inferred_from_content: list[str] = []
    seed_content_files: list[str] = []
    if queries:
        seed_action = dict(action)
        seed_action.update({"id": f"{aid}-seed-content", "title": f"{title} seed content", "type": "content"})
        content_result = run_content_action(project_root, seed_action, global_excludes, max_file_bytes)
        make_snippets(project_root, content_result, seed_action, max_report_bytes=DEFAULT_MAX_REPORT_BYTES)
        _merge_snippets(result, content_result)
        for p in content_result.files:
            rel = relpath_under(project_root, p)
            selected[rel] = p
            seed_content_files.append(rel)
        inferred_from_content = _query_owner_symbols(
            project_root, content_result.files, queries, regex=regex,
            case_sensitive=case_sensitive, max_symbols=max_symbols)
        evidence.append({
            "kind": "seed_content",
            "resolution": "text",
            "queries": queries,
            "matched_files": [relpath_under(project_root, p) for p in content_result.files],
            "containing_function_seeds": inferred_from_content,
        })

    seed_symbols: list[str] = []
    seen_symbols: set[str] = set()
    def add_seed(name: str) -> None:
        name = str(name).strip()
        if not name or name in seen_symbols or name in CALL_KEYWORDS:
            return
        if not re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", name):
            return
        seen_symbols.add(name)
        seed_symbols.append(name)

    for name in explicit_symbols:
        add_seed(name)
    if include_query_symbols:
        for name in _simple_query_identifiers(queries, regex=regex):
            add_seed(name)
    for name in inferred_from_content:
        add_seed(name)
    seed_symbols = seed_symbols[:max_symbols]

    frontier = list(seed_symbols)
    expanded: set[str] = set()
    stop_reason = "frontier_exhausted"
    for round_idx in range(max_rounds):
        frontier = [s for s in frontier if s not in expanded][:max_new_symbols]
        if not frontier:
            stop_reason = "frontier_exhausted"
            break
        if len(expanded) >= max_symbols:
            stop_reason = "max_symbols"
            break
        remaining = max_symbols - len(expanded)
        frontier = frontier[:remaining]
        graph_action = dict(action)
        graph_action.update({
            "id": f"{aid}-round-{round_idx}",
            "title": f"{title} round {round_idx}",
            "type": "symbol_graph",
            "symbols": frontier,
            "context_lines": context,
            "include_callers": include_callers,
            "include_callees": include_callees,
            "include_dependencies": include_dependencies,
        })
        graph_result = run_symbol_graph_action(project_root, graph_action, global_excludes, max_file_bytes)
        _merge_snippets(result, graph_result)
        before_files = set(selected)
        for p in graph_result.files:
            rel = relpath_under(project_root, p)
            if len(selected) < max_investigation_files or rel in selected:
                selected[rel] = p
        expanded.update(frontier)

        discovered: list[dict[str, str]] = []
        next_symbols: list[str] = []
        details = graph_result.metadata.get("symbols", {}) if isinstance(graph_result.metadata, dict) else {}
        for source_symbol in frontier:
            info = details.get(source_symbol, {}) if isinstance(details, dict) else {}
            if include_callers:
                for loc in info.get("callers", []) if isinstance(info, dict) else []:
                    owner = str(loc.get("owner") or "").strip()
                    if owner and owner not in expanded and owner not in next_symbols:
                        next_symbols.append(owner)
                        discovered.append({"symbol": owner, "via": "caller", "from": source_symbol, "resolution": "heuristic"})
            if include_callees:
                for item in info.get("callees", []) if isinstance(info, dict) else []:
                    name = str(item.get("name") or "").strip()
                    defs = item.get("definitions") or []
                    # Expand only project-local callees whose definition was found.
                    if name and defs and name not in expanded and name not in next_symbols:
                        next_symbols.append(name)
                        discovered.append({"symbol": name, "via": "callee", "from": source_symbol, "resolution": "heuristic"})

        # Deterministic bounded frontier. Callers/callees are kept in discovery order.
        filtered_next: list[str] = []
        for name in next_symbols:
            if len(expanded) + len(filtered_next) >= max_symbols:
                break
            if not re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", name) or name in CALL_KEYWORDS:
                continue
            if name not in filtered_next and name not in expanded:
                filtered_next.append(name)
            if len(filtered_next) >= max_new_symbols:
                break

        rounds_meta.append({
            "round": round_idx,
            "frontier": frontier,
            "files_added": sorted(set(selected) - before_files, key=str.lower),
            "discovered": discovered[:max_new_symbols],
            "next_frontier": filtered_next,
            "graph_details": graph_result.metadata,
        })
        if len(selected) >= max_investigation_files:
            stop_reason = "max_investigation_files"
            break
        if round_idx + 1 >= max_rounds:
            stop_reason = "max_rounds"
            break
        if not filtered_next:
            stop_reason = "no_new_symbols"
            break
        frontier = filtered_next

    max_relevant_files = max(1, int(action.get("max_relevant_files", min(max_investigation_files, 200))))
    min_relevance_score = max(0.0, float(action.get("min_relevance_score", 20.0)))
    trim_low_relevance = bool(action.get("trim_low_relevance", True))
    ranked_files, relevance_ranking, relevance_dropped = _investigation_relevance(
        project_root, selected, rounds_meta, seed_content_files,
        max_relevant_files=max_relevant_files,
        min_relevance_score=min_relevance_score,
        trim_low_relevance=trim_low_relevance,
    )
    result.files = ranked_files
    result.metadata = {
        "mode": "bounded_auto_investigation",
        "relevance": {
            "policy": "evidence_strength_plus_graph_distance",
            "trim_low_relevance": trim_low_relevance,
            "min_relevance_score": min_relevance_score,
            "max_relevant_files": max_relevant_files,
            "candidate_files": len(selected),
            "packed_relevant_files": len(result.files),
            "dropped_low_relevance": relevance_dropped,
            "ranking": relevance_ranking[:500],
        },
        "resolution": {
            "seed_content": "text",
            "symbol_occurrences": "text",
            "definitions": "heuristic",
            "callers": "heuristic",
            "callees": "heuristic",
            "dependencies": "heuristic",
        },
        "seed_symbols": seed_symbols,
        "explicit_symbols": explicit_symbols,
        "queries": queries,
        "rounds": rounds_meta,
        "expanded_symbols": sorted(expanded, key=str.lower),
        "stop_reason": stop_reason,
        "limits": {
            "max_rounds": max_rounds,
            "max_symbols": max_symbols,
            "max_new_symbols_per_round": max_new_symbols,
            "max_investigation_files": max_investigation_files,
        },
        "evidence": evidence,
    }
    if len(selected) >= max_investigation_files:
        result.notes.append(f"Investigation file set capped at max_investigation_files={max_investigation_files}")
    if relevance_dropped:
        result.notes.append(
            f"Relevance filter removed {len(relevance_dropped)} low-priority graph/dependency file(s); "
            "exact seed-content files are always retained"
        )
    return result

def make_snippets(project_root: Path, result: ActionResult, action: dict[str, Any], *, max_report_bytes: int) -> None:
    if result.action_type != "content":
        return
    context = max(0, int(action.get("context_lines", action.get("context", 8)) or 0))
    regex = bool(action.get("regex", False))
    case_sensitive = bool(action.get("case_sensitive", True))
    queries = normalize_queries(action)
    flags = 0 if case_sensitive else re.IGNORECASE
    patterns = []
    for q in queries:
        try:
            patterns.append(re.compile(q if regex else re.escape(q), flags))
        except re.error:
            continue
    total = 0
    per_file_cap = int(action.get("max_snippets_per_file", DEFAULT_MAX_SNIPPETS_PER_FILE))
    for p in result.files:
        rel = relpath_under(project_root, p)
        try:
            lines = p.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        hit_lines = [idx for idx, line in enumerate(lines) if any(rx.search(line) for rx in patterns)]
        if not hit_lines:
            continue
        windows: list[tuple[int, int]] = []
        for idx in hit_lines[:per_file_cap]:
            a = max(0, idx - context)
            b = min(len(lines), idx + context + 1)
            if windows and a <= windows[-1][1]:
                windows[-1] = (windows[-1][0], max(windows[-1][1], b))
            else:
                windows.append((a, b))
        chunks: list[str] = []
        for a, b in windows:
            chunks.append(f"--- {rel}:{a+1}-{b} ---")
            for idx in range(a, b):
                chunks.append(f"{idx+1:7d}: {lines[idx]}")
        payload = "\n".join(chunks)
        total += len(payload.encode("utf-8", errors="replace"))
        if total > max_report_bytes:
            result.notes.append(f"Snippet report truncated at {max_report_bytes} bytes")
            break
        result.snippets[rel] = chunks


def normalize_request(data: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise CollectError("Request must be a JSON object")
    out = dict(data)
    out["id"] = safe_id(out.get("id") or "code-collection")
    actions = out.get("actions")
    if not isinstance(actions, list) or not actions:
        raise CollectError("Request requires non-empty actions[]")
    out["actions"] = [dict(a) for a in actions if isinstance(a, dict)]
    if not out["actions"]:
        raise CollectError("Request has no valid actions")
    return out


def run_request(project_root: Path, request: dict[str, Any]) -> Path:
    request = normalize_request(request)
    cid = request["id"]
    title = str(request.get("title") or cid)
    limits = request.get("limits") if isinstance(request.get("limits"), dict) else {}
    max_file_bytes = int(limits.get("max_file_bytes", DEFAULT_MAX_FILE_BYTES))
    max_total_bytes = int(limits.get("max_total_bytes", DEFAULT_MAX_TOTAL_BYTES))
    max_files = int(limits.get("max_files", DEFAULT_MAX_FILES))
    max_report_bytes = int(limits.get("max_report_bytes", DEFAULT_MAX_REPORT_BYTES))
    global_excludes = [*DEFAULT_EXCLUDE_GLOBS, *normalize_globs(request.get("exclude_globs"))]

    output_base_raw = str(request.get("output_dir") or "artifacts/patch_tool_code_collections")
    output_base = resolve_under(project_root, output_base_raw)
    stage = output_base / cid
    zip_path = output_base / f"{cid}.zip"
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir(parents=True, exist_ok=True)
    files_dir = stage / "files"
    matches_dir = stage / "matches"
    files_dir.mkdir(parents=True, exist_ok=True)
    matches_dir.mkdir(parents=True, exist_ok=True)

    results: list[ActionResult] = []
    actions = request["actions"]
    for idx, action in enumerate(actions, 1):
        atype = str(action.get("type", "content")).lower().replace("-", "_")
        if "id" not in action:
            action["id"] = f"action-{idx}"
        if atype in {"content", "search", "search_files", "content_search"}:
            result = run_content_action(project_root, action, global_excludes, max_file_bytes)
        elif atype in {"filename", "find", "find_files", "path_glob"}:
            result = run_filename_action(project_root, action, global_excludes, max_file_bytes)
        elif atype in {"explicit", "paths", "files"}:
            result = run_explicit_action(project_root, action)
        elif atype in {"git_changed", "git_status", "changed"}:
            result = run_git_changed_action(project_root, action, global_excludes, max_file_bytes)
        elif atype in {"symbol_graph", "symbol", "symbols", "references", "call_graph"}:
            result = run_symbol_graph_action(project_root, action, global_excludes, max_file_bytes)
        elif atype in {"dependency_closure", "dependencies", "dependency", "deps"}:
            result = run_dependency_action(project_root, action, global_excludes, max_file_bytes)
        elif atype in {"investigate", "auto_investigate", "automatic_investigation", "investigation_expand", "investigation"}:
            result = run_investigation_action(project_root, action, global_excludes, max_file_bytes)
        else:
            raise CollectError(f"Unknown action type: {atype}")
        make_snippets(project_root, result, action, max_report_bytes=max_report_bytes)
        results.append(result)

    union: dict[str, Path] = {}
    per_action = {}
    for r, action in zip(results, actions):
        names = []
        collect_files = bool(action.get("collect_matching_files", True))
        for p in r.files:
            rel = relpath_under(project_root, p)
            if collect_files:
                union[rel] = p
            names.append(rel)
        per_action[r.action_id] = names
        if not collect_files:
            r.notes.append("collect_matching_files=false: matches are reported but full source files are not packed")

    selected: list[tuple[str, Path, int]] = []
    total = 0
    skipped_limits: list[dict[str, Any]] = []
    for rel in sorted(union, key=str.lower):
        p = union[rel]
        try:
            size = p.stat().st_size
        except OSError:
            continue
        if len(selected) >= max_files:
            skipped_limits.append({"file": rel, "reason": "max_files"})
            continue
        if size > max_file_bytes:
            skipped_limits.append({"file": rel, "reason": "max_file_bytes", "size": size})
            continue
        if total + size > max_total_bytes:
            skipped_limits.append({"file": rel, "reason": "max_total_bytes", "size": size})
            continue
        selected.append((rel, p, size))
        total += size

    selected_set = {rel for rel, _, _ in selected}
    for rel, p, _size in selected:
        dst = files_dir / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(p, dst)

    report_lines = [
        f"COLLECTION: {title}",
        f"ID: {cid}",
        f"PROJECT ROOT: {project_root}",
        "MODE: READONLY SOURCE COLLECTION — SANDBOX SKIPPED",
        f"ACTIONS: {len(results)}",
        f"UNION MATCHED FILES: {len(union)}",
        f"PACKED FILES: {len(selected)}",
        f"PACKED SOURCE BYTES: {total}",
        "",
    ]
    for r in results:
        report_lines.extend([
            "=" * 78,
            f"ACTION: {r.title}",
            f"ID: {r.action_id}",
            f"TYPE: {r.action_type}",
            f"MATCHED FILES: {len(r.files)}",
            "=" * 78,
        ])
        for p in r.files:
            rel = relpath_under(project_root, p)
            report_lines.append(("[PACKED] " if rel in selected_set else "[MATCHED-NOT-PACKED] ") + rel)
        if r.snippets:
            report_lines.append("")
            report_lines.append("CONTEXT MATCHES")
            for rel in sorted(r.snippets, key=str.lower):
                report_lines.append("")
                report_lines.extend(r.snippets[rel])
        if r.metadata:
            report_lines.append("")
            report_lines.append("ANALYSIS DETAILS (JSON)")
            report_lines.extend(json.dumps(r.metadata, indent=2, ensure_ascii=False).splitlines())
        if r.notes:
            report_lines.append("")
            report_lines.extend(f"NOTE: {n}" for n in r.notes)
        report_lines.append("")

        action_txt = matches_dir / f"{r.action_id}.txt"
        action_lines = [f"ACTION: {r.title}", f"TYPE: {r.action_type}", f"MATCHED: {len(r.files)}", ""]
        for p in r.files:
            rel = relpath_under(project_root, p)
            action_lines.append(rel)
        if r.snippets:
            action_lines.append("")
            action_lines.append("CONTEXT MATCHES")
            for rel in sorted(r.snippets, key=str.lower):
                action_lines.append("")
                action_lines.extend(r.snippets[rel])
        if r.metadata:
            action_lines.append("")
            action_lines.append("ANALYSIS DETAILS (JSON)")
            action_lines.extend(json.dumps(r.metadata, indent=2, ensure_ascii=False).splitlines())
        action_txt.write_text("\n".join(action_lines) + "\n", encoding="utf-8")

    (stage / "search_report.txt").write_text("\n".join(report_lines) + "\n", encoding="utf-8")
    manifest = {
        "schema": 1,
        "tool_version": VERSION,
        "mode": "readonly_source_collection",
        "sandbox": "skipped_readonly",
        "project_root": str(project_root),
        "id": cid,
        "title": title,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "limits": {
            "max_file_bytes": max_file_bytes,
            "max_total_bytes": max_total_bytes,
            "max_files": max_files,
            "max_report_bytes": max_report_bytes,
        },
        "actions": [
            {
                "id": r.action_id,
                "title": r.title,
                "type": r.action_type,
                "matched_files": len(r.files),
                "files": [relpath_under(project_root, p) for p in r.files],
                "notes": r.notes,
                "details": r.metadata,
            }
            for r in results
        ],
        "union_matched_files": len(union),
        "packed_files": len(selected),
        "packed_source_bytes": total,
        "skipped_by_limits": skipped_limits,
        "packed": [
            {"path": rel, "size": size, "sha256": sha256_file(p)} for rel, p, size in selected
        ],
    }
    (stage / "search_manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (stage / "request.normalized.json").write_text(json.dumps(request, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    output_base.mkdir(parents=True, exist_ok=True)
    tmp_zip = zip_path.with_suffix(".zip.tmp")
    if tmp_zip.exists():
        tmp_zip.unlink()
    with zipfile.ZipFile(tmp_zip, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for p in sorted(stage.rglob("*")):
            if p.is_file():
                arc = f"{cid}/{p.relative_to(stage).as_posix()}"
                zf.write(p, arc)
    os.replace(tmp_zip, zip_path)
    if not bool(request.get("keep_directory", True)):
        shutil.rmtree(stage)

    print("=" * 78)
    print("READONLY CODE COLLECTION — SANDBOX SKIPPED")
    print(f"Collection : {cid}")
    print(f"Actions    : {len(results)}")
    print(f"Matched    : {len(union)} unique files")
    print(f"Packed     : {len(selected)} files | {total} bytes")
    print(f"ZIP        : {zip_path}")
    print("Source/Git : not modified")
    print("=" * 78)
    print(zip_path)
    return zip_path


def build_single_request(ns: argparse.Namespace) -> dict[str, Any]:
    action: dict[str, Any] = {
        "id": ns.action_id or "search",
        "title": ns.title or ns.action_id or "Content search",
        "type": "content",
        "paths": ns.path or ["."],
        "query": ns.query,
        "queries": ns.term or [],
        "regex": bool(ns.regex),
        "case_sensitive": bool(ns.case_sensitive),
        "match_mode": ns.match_mode,
        "include_globs": ns.include or [],
        "exclude_globs": ns.exclude or [],
        "name_globs": ns.name_glob or [],
        "extensions": ns.extension or [],
        "context_lines": ns.context,
        "exclude_queries": ns.exclude_query or [],
        "hidden": bool(ns.hidden),
    }
    return {
        "id": ns.collection_id,
        "title": ns.title or ns.collection_id,
        "output_dir": ns.output_dir,
        "keep_directory": not ns.zip_only,
        "limits": {
            "max_file_bytes": ns.max_file_bytes,
            "max_total_bytes": ns.max_total_bytes,
            "max_files": ns.max_files,
            "max_report_bytes": ns.max_report_bytes,
        },
        "actions": [action],
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Python Patch Tool readonly content-driven collector")
    ap.add_argument("--project-root", required=True)
    sub = ap.add_subparsers(dest="command", required=True)

    req = sub.add_parser("request", help="Run multi-action JSON request")
    req.add_argument("request_file", nargs="?", default=".patch_tool_collect.json")

    one = sub.add_parser("search-pack", aliases=["select", "search-files"], help="Search content, collect matching full files and ZIP")
    one.add_argument("--id", dest="collection_id", required=True)
    one.add_argument("--action-id")
    one.add_argument("--title")
    one.add_argument("--path", action="append")
    one.add_argument("--query")
    one.add_argument("--term", action="append", help="Additional query; use with --match-mode any/all")
    one.add_argument("--regex", action="store_true")
    one.add_argument("--literal", action="store_true")
    one.add_argument("--case-sensitive", action="store_true")
    one.add_argument("--match-mode", choices=["any", "all"], default="any")
    one.add_argument("--exclude-query", action="append")
    one.add_argument("--include", action="append")
    one.add_argument("--exclude", action="append")
    one.add_argument("--name-glob", action="append")
    one.add_argument("--extension", action="append")
    one.add_argument("--context", type=int, default=8)
    one.add_argument("--hidden", action="store_true")
    one.add_argument("--output-dir", default="artifacts/patch_tool_code_collections")
    one.add_argument("--zip-only", action="store_true")
    one.add_argument("--max-file-bytes", type=int, default=DEFAULT_MAX_FILE_BYTES)
    one.add_argument("--max-total-bytes", type=int, default=DEFAULT_MAX_TOTAL_BYTES)
    one.add_argument("--max-files", type=int, default=DEFAULT_MAX_FILES)
    one.add_argument("--max-report-bytes", type=int, default=DEFAULT_MAX_REPORT_BYTES)

    sym = sub.add_parser("symbol-pack", aliases=["symbol", "symbol-graph"], help="Collect symbol definitions/references/callers/callees/local dependencies")
    sym.add_argument("--id", dest="collection_id", required=True)
    sym.add_argument("--title")
    sym.add_argument("--symbol", action="append", required=True)
    sym.add_argument("--path", action="append")
    sym.add_argument("--include", action="append")
    sym.add_argument("--exclude", action="append")
    sym.add_argument("--extension", action="append")
    sym.add_argument("--context", type=int, default=6)
    sym.add_argument("--no-references", action="store_true")
    sym.add_argument("--no-callers", action="store_true")
    sym.add_argument("--no-callees", action="store_true")
    sym.add_argument("--no-dependencies", action="store_true")
    sym.add_argument("--dependency-depth", type=int, default=1)
    sym.add_argument("--max-callees", type=int, default=40)
    sym.add_argument("--max-callers", type=int, default=250)
    sym.add_argument("--max-occurrences", type=int, default=1000)
    sym.add_argument("--max-dependency-files", type=int, default=300)
    sym.add_argument("--max-dependency-edges", type=int, default=3000)
    sym.add_argument("--hidden", action="store_true")
    sym.add_argument("--output-dir", default="artifacts/patch_tool_code_collections")
    sym.add_argument("--zip-only", action="store_true")
    sym.add_argument("--max-file-bytes", type=int, default=DEFAULT_MAX_FILE_BYTES)
    sym.add_argument("--max-total-bytes", type=int, default=DEFAULT_MAX_TOTAL_BYTES)
    sym.add_argument("--max-files", type=int, default=DEFAULT_MAX_FILES)
    sym.add_argument("--max-report-bytes", type=int, default=DEFAULT_MAX_REPORT_BYTES)

    dep = sub.add_parser("dependency-pack", aliases=["deps", "dependencies"], help="Collect recursive local include/import/require dependencies")
    dep.add_argument("--id", dest="collection_id", required=True)
    dep.add_argument("--title")
    dep.add_argument("--file", action="append", required=True)
    dep.add_argument("--path", action="append", help="Roots used to resolve dependencies")
    dep.add_argument("--depth", type=int, default=2)
    dep.add_argument("--include", action="append")
    dep.add_argument("--exclude", action="append")
    dep.add_argument("--extension", action="append")
    dep.add_argument("--max-dependency-files", type=int, default=500)
    dep.add_argument("--max-dependency-edges", type=int, default=5000)
    dep.add_argument("--hidden", action="store_true")
    dep.add_argument("--output-dir", default="artifacts/patch_tool_code_collections")
    dep.add_argument("--zip-only", action="store_true")
    dep.add_argument("--max-file-bytes", type=int, default=DEFAULT_MAX_FILE_BYTES)
    dep.add_argument("--max-total-bytes", type=int, default=DEFAULT_MAX_TOTAL_BYTES)
    dep.add_argument("--max-files", type=int, default=DEFAULT_MAX_FILES)
    dep.add_argument("--max-report-bytes", type=int, default=DEFAULT_MAX_REPORT_BYTES)

    inv = sub.add_parser("investigate-pack", aliases=["investigate", "auto-investigate"], help="Bounded automatic expansion from content/symbol seeds through callers/callees/dependencies")
    inv.add_argument("--id", dest="collection_id", required=True)
    inv.add_argument("--title")
    inv.add_argument("--path", action="append")
    inv.add_argument("--query")
    inv.add_argument("--term", action="append")
    inv.add_argument("--symbol", action="append")
    inv.add_argument("--regex", action="store_true")
    inv.add_argument("--case-sensitive", action="store_true")
    inv.add_argument("--include", action="append")
    inv.add_argument("--exclude", action="append")
    inv.add_argument("--extension", action="append")
    inv.add_argument("--context", type=int, default=6)
    inv.add_argument("--rounds", type=int, default=2)
    inv.add_argument("--max-symbols", type=int, default=80)
    inv.add_argument("--max-new-symbols-per-round", type=int, default=24)
    inv.add_argument("--max-investigation-files", type=int, default=500)
    inv.add_argument("--max-relevant-files", type=int, default=200)
    inv.add_argument("--min-relevance-score", type=float, default=20.0)
    inv.add_argument("--no-trim-low-relevance", action="store_true")
    inv.add_argument("--dependency-depth", type=int, default=1)
    inv.add_argument("--max-callees", type=int, default=40)
    inv.add_argument("--max-callers", type=int, default=250)
    inv.add_argument("--max-occurrences", type=int, default=1000)
    inv.add_argument("--max-dependency-files", type=int, default=300)
    inv.add_argument("--max-dependency-edges", type=int, default=3000)
    inv.add_argument("--no-query-symbols", action="store_true")
    inv.add_argument("--no-callers", action="store_true")
    inv.add_argument("--no-callees", action="store_true")
    inv.add_argument("--no-dependencies", action="store_true")
    inv.add_argument("--hidden", action="store_true")
    inv.add_argument("--output-dir", default="artifacts/patch_tool_code_collections")
    inv.add_argument("--zip-only", action="store_true")
    inv.add_argument("--max-file-bytes", type=int, default=DEFAULT_MAX_FILE_BYTES)
    inv.add_argument("--max-total-bytes", type=int, default=DEFAULT_MAX_TOTAL_BYTES)
    inv.add_argument("--max-files", type=int, default=DEFAULT_MAX_FILES)
    inv.add_argument("--max-report-bytes", type=int, default=DEFAULT_MAX_REPORT_BYTES)

    ns = ap.parse_args(argv)
    root = Path(ns.project_root).resolve()
    if not root.is_dir():
        raise CollectError(f"Project root does not exist: {root}")
    if ns.command == "request":
        rf = Path(ns.request_file)
        if not rf.is_absolute():
            rf = root / rf
        data = json.loads(rf.read_text(encoding="utf-8"))
        run_request(root, data)
        return 0
    if ns.command in {"investigate-pack", "investigate", "auto-investigate"}:
        request = {
            "id": ns.collection_id,
            "title": ns.title or ns.collection_id,
            "output_dir": ns.output_dir,
            "keep_directory": not ns.zip_only,
            "limits": {"max_file_bytes": ns.max_file_bytes, "max_total_bytes": ns.max_total_bytes, "max_files": ns.max_files, "max_report_bytes": ns.max_report_bytes},
            "actions": [{
                "id": "investigation", "type": "investigate", "symbols": ns.symbol or [], "paths": ns.path or ["."],
                "query": ns.query, "queries": ns.term or [], "regex": ns.regex, "case_sensitive": ns.case_sensitive,
                "include_globs": ns.include or [], "exclude_globs": ns.exclude or [], "extensions": ns.extension or [],
                "context_lines": ns.context, "max_rounds": ns.rounds, "max_symbols": ns.max_symbols,
                "max_new_symbols_per_round": ns.max_new_symbols_per_round, "max_investigation_files": ns.max_investigation_files,
                "max_relevant_files": ns.max_relevant_files, "min_relevance_score": ns.min_relevance_score,
                "trim_low_relevance": not ns.no_trim_low_relevance,
                "dependency_depth": ns.dependency_depth, "max_callees": ns.max_callees, "max_callers": ns.max_callers,
                "max_occurrences": ns.max_occurrences, "max_dependency_files": ns.max_dependency_files,
                "max_dependency_edges": ns.max_dependency_edges, "seed_query_identifiers": not ns.no_query_symbols,
                "include_callers": not ns.no_callers, "include_callees": not ns.no_callees,
                "include_dependencies": not ns.no_dependencies, "hidden": ns.hidden,
            }],
        }
        if not (ns.symbol or ns.query or ns.term):
            raise CollectError("investigate-pack requires --symbol and/or --query/--term")
        run_request(root, request)
        return 0
    if ns.command in {"symbol-pack", "symbol", "symbol-graph"}:
        request = {
            "id": ns.collection_id,
            "title": ns.title or ns.collection_id,
            "output_dir": ns.output_dir,
            "keep_directory": not ns.zip_only,
            "limits": {"max_file_bytes": ns.max_file_bytes, "max_total_bytes": ns.max_total_bytes, "max_files": ns.max_files, "max_report_bytes": ns.max_report_bytes},
            "actions": [{
                "id": "symbol-graph", "type": "symbol_graph", "symbols": ns.symbol, "paths": ns.path or ["."],
                "include_globs": ns.include or [], "exclude_globs": ns.exclude or [], "extensions": ns.extension or [],
                "context_lines": ns.context, "include_references": not ns.no_references, "include_callers": not ns.no_callers,
                "include_callees": not ns.no_callees, "include_dependencies": not ns.no_dependencies,
                "dependency_depth": ns.dependency_depth, "max_callees": ns.max_callees, "max_callers": ns.max_callers,
                "max_occurrences": ns.max_occurrences, "max_dependency_files": ns.max_dependency_files,
                "max_dependency_edges": ns.max_dependency_edges, "hidden": ns.hidden,
            }],
        }
        run_request(root, request)
        return 0
    if ns.command in {"dependency-pack", "deps", "dependencies"}:
        request = {
            "id": ns.collection_id,
            "title": ns.title or ns.collection_id,
            "output_dir": ns.output_dir,
            "keep_directory": not ns.zip_only,
            "limits": {"max_file_bytes": ns.max_file_bytes, "max_total_bytes": ns.max_total_bytes, "max_files": ns.max_files, "max_report_bytes": ns.max_report_bytes},
            "actions": [{
                "id": "dependencies", "type": "dependency_closure", "files": ns.file, "paths": ns.path or ["."],
                "depth": ns.depth, "include_globs": ns.include or [], "exclude_globs": ns.exclude or [],
                "extensions": ns.extension or [], "max_dependency_files": ns.max_dependency_files,
                "max_dependency_edges": ns.max_dependency_edges, "hidden": ns.hidden,
            }],
        }
        run_request(root, request)
        return 0
    if ns.literal:
        ns.regex = False
    if not ns.query and not ns.term:
        raise CollectError("search-pack requires --query and/or --term")
    run_request(root, build_single_request(ns))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except CollectError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(2)
