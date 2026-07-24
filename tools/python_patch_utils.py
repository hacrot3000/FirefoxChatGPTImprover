#!/usr/bin/env python3
"""
Shared helper functions for one-shot Python patch scripts.

Version 4 goals:
- Keep compatibility with older patches that use replace_exact_once(), insert_after_once(),
  write_file_if_changed(), finish_success(), finish_failure().
- Let ChatGPT generate much smaller patch files through run_patch(PATCH_NAME, OPS).
- Support safer adaptive matching: exact, variant, whitespace-normalized, regex, and fuzzy
  line-window matching.
- Support operation-level error policy: stop, skip, or ignore.
- Support simple if/then/else and first-success alternatives.
- Track failed files and optionally zip them for sending back to ChatGPT.
- Work with runner v4, which accepts standalone .py patches and .zip/.tar.gz packages.

No external dependencies. Do not put this file in patchs/; keep it in tools/.
"""

from __future__ import annotations

PYTHON_PATCH_TOOL_VERSION = "4.0.0"

PYTHON_PATCH_UTILS_RESULT_POLICY = "failed-first/no-change-only-on-0-0-v2"

from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path
import datetime as _dt
import os
import re
import shutil
import sys
import textwrap
import zipfile
from typing import Any, Callable, Iterable, Optional


# ---------------------------------------------------------------------------
# Exceptions / state
# ---------------------------------------------------------------------------


class PatchFailure(Exception):
    """Patch error with a file path and human-readable diagnostic."""

    def __init__(
        self,
        rel_path: str,
        message: str,
        *,
        expected: Optional[str] = None,
        anchor: Optional[str] = None,
        context: Optional[str] = None,
        op_id: Optional[str] = None,
        strategy: Optional[str] = None,
        candidates: Optional[list[str]] = None,
    ) -> None:
        self.rel_path = rel_path
        self.message = message
        self.expected = expected
        self.anchor = anchor
        self.context = context
        self.op_id = op_id
        self.strategy = strategy
        self.candidates = candidates or []
        super().__init__(f"{rel_path}: {message}")


@dataclass
class PatchStats:
    patched: int = 0
    unchanged: int = 0
    created: int = 0
    backups: int = 0
    skipped: int = 0
    ignored: int = 0
    failed: int = 0


@dataclass
class PatchRunState:
    project_root: Path
    patch_name: str
    stats: PatchStats = field(default_factory=PatchStats)
    failures: list[PatchFailure] = field(default_factory=list)
    failed_files: set[str] = field(default_factory=set)
    backed_up_files: dict[str, Path] = field(default_factory=dict)
    changed_files: set[str] = field(default_factory=set)

    def record_failure(self, exc: PatchFailure) -> None:
        self.failures.append(exc)
        self.failed_files.add(exc.rel_path)
        self.stats.failed += 1


# ---------------------------------------------------------------------------
# Project / file helpers
# ---------------------------------------------------------------------------


def find_project_root(start: Optional[Path] = None) -> Path:
    """Find the repository/project root.

    Normal runner behavior runs patches with cwd=<project>. This function keeps
    that behavior but is tolerant when a patch is invoked directly from patchs/.
    """
    cwd = (start or Path.cwd()).resolve()

    if (cwd / "patchs").is_dir():
        return cwd

    for parent in [cwd, *cwd.parents]:
        if parent.name == "patchs":
            return parent.parent
        if (parent / "patchs").is_dir():
            return parent

    raise RuntimeError("Cannot determine project root. Run patch from project root or <project>/patchs.")


def _safe_patch_name(patch_name: str) -> str:
    out = re.sub(r"[^A-Za-z0-9_.-]+", "_", patch_name.strip())
    return out or "patch"


def backup_path(project_root: Path, rel_path: str, patch_name: str) -> Path:
    """Return the standard backup path for a file.

    Format:
      patchs/backup/<full-relative-path-to-file>/<stem>.<patch-name>.<original-ext>.patch.bak
    """
    rel = Path(rel_path)
    suffix = rel.suffix[1:] if rel.suffix else "noext"
    stem = rel.stem if rel.suffix else rel.name
    backup_name = f"{stem}.{_safe_patch_name(patch_name)}.{suffix}.patch.bak"
    return project_root / "patchs" / "backup" / rel / backup_name


def _non_overwriting_path(path: Path) -> Path:
    if not path.exists():
        return path
    for i in range(2, 1000):
        candidate = path.with_name(f"{path.name}.{i}")
        if not candidate.exists():
            return candidate
    raise RuntimeError(f"Cannot allocate backup path near {path}")


def backup_file(project_root: Path, rel_path: str, patch_name: str) -> Path:
    src = project_root / rel_path
    if not src.exists():
        raise PatchFailure(rel_path, "cannot back up because file does not exist")

    dst = _non_overwriting_path(backup_path(project_root, rel_path, patch_name))
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    return dst


def backup_file_once(state: PatchRunState, rel_path: str) -> Path:
    if rel_path in state.backed_up_files:
        return state.backed_up_files[rel_path]
    backup = backup_file(state.project_root, rel_path, state.patch_name)
    state.backed_up_files[rel_path] = backup
    state.stats.backups += 1
    return backup


def read_text(project_root: Path, rel_path: str) -> str:
    path = project_root / rel_path
    if not path.exists():
        raise PatchFailure(rel_path, "file not found")
    return path.read_text(encoding="utf-8")


def write_text(project_root: Path, rel_path: str, text: str) -> None:
    path = project_root / rel_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _read_for_state(state: PatchRunState, rel_path: str) -> str:
    return read_text(state.project_root, rel_path)


def _write_changed(state: PatchRunState, rel_path: str, updated: str, *, create: bool = False) -> bool:
    path = state.project_root / rel_path
    if path.exists():
        old = path.read_text(encoding="utf-8")
        if old == updated:
            print(f"unchanged/check: {rel_path}")
            state.stats.unchanged += 1
            return False
        backup = backup_file_once(state, rel_path)
        path.write_text(updated, encoding="utf-8")
        print(f"patched: {rel_path}")
        print(f"backup : {backup.relative_to(state.project_root)}")
        state.stats.patched += 1
        state.changed_files.add(rel_path)
        return True

    if not create:
        raise PatchFailure(rel_path, "file not found")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(updated, encoding="utf-8")
    print(f"created: {rel_path}")
    state.stats.created += 1
    state.changed_files.add(rel_path)
    return True


# ---------------------------------------------------------------------------
# Context / diagnostics
# ---------------------------------------------------------------------------


def _line_col_from_index(text: str, index: int) -> tuple[int, int]:
    before = text[:index]
    line = before.count("\n") + 1
    last_nl = before.rfind("\n")
    col = index + 1 if last_nl < 0 else index - last_nl
    return line, col


def context_around_index(text: str, index: int, *, context_lines: int = 5) -> str:
    lines = text.splitlines()
    if not lines:
        return "<empty file>"
    line_no, _ = _line_col_from_index(text, max(0, min(index, len(text))))
    line_no = max(1, min(line_no, len(lines)))
    start = max(1, line_no - context_lines)
    end = min(len(lines), line_no + context_lines)
    width = len(str(end))
    out = []
    for n in range(start, end + 1):
        marker = ">" if n == line_no else " "
        out.append(f"{marker} L{n:>{width}}: {lines[n - 1]}")
    return "\n".join(out)


def context_around_pattern(text: str, pattern: str, *, context_lines: int = 5) -> Optional[str]:
    index = text.find(pattern)
    if index < 0:
        return None
    return context_around_index(text, index, context_lines=context_lines)


def _preview_block(block: str, *, max_lines: int = 20) -> str:
    lines = block.splitlines()
    shown = lines[:max_lines]
    suffix = "" if len(lines) <= max_lines else f"\n... ({len(lines) - max_lines} more lines)"
    return "\n".join(shown) + suffix


def print_patch_error(exc: PatchFailure) -> None:
    RED = "\033[91m"
    BOLD = "\033[1m"
    RESET = "\033[0m"
    print(f"{RED}{BOLD}ERROR: {exc.message}{RESET}")
    print(f"File : {exc.rel_path}")
    if exc.op_id:
        print(f"Op   : {exc.op_id}")
    if exc.strategy:
        print(f"Mode : {exc.strategy}")
    if exc.anchor:
        print(f"Anchor: {exc.anchor}")
    if exc.expected:
        print("Expected block preview:")
        print(_preview_block(exc.expected))
    if exc.context:
        print("Nearby context:")
        print(exc.context)
    if exc.candidates:
        print("Candidate contexts:")
        for item in exc.candidates[:5]:
            print("---")
            print(item)


def _candidate_contexts(text: str, indexes: Iterable[int], *, context_lines: int = 4, limit: int = 5) -> list[str]:
    out = []
    for i, index in enumerate(indexes):
        if i >= limit:
            break
        out.append(context_around_index(text, index, context_lines=context_lines))
    return out


# ---------------------------------------------------------------------------
# Matching helpers
# ---------------------------------------------------------------------------


@dataclass
class MatchSpan:
    start: int
    end: int
    strategy: str
    score: float = 1.0


def _normalize_newlines(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _normalize_ws_with_map(text: str) -> tuple[str, list[int]]:
    """Collapse whitespace to single spaces while keeping map to original indexes."""
    out: list[str] = []
    mapping: list[int] = []
    in_ws = False
    for idx, ch in enumerate(text):
        if ch.isspace():
            if not in_ws:
                out.append(" ")
                mapping.append(idx)
                in_ws = True
        else:
            out.append(ch)
            mapping.append(idx)
            in_ws = False
    return "".join(out), mapping


def _find_exact_spans(text: str, needle: str) -> list[MatchSpan]:
    spans = []
    start = 0
    while True:
        index = text.find(needle, start)
        if index < 0:
            break
        spans.append(MatchSpan(index, index + len(needle), "exact"))
        start = index + max(1, len(needle))
    return spans


def _find_regex_spans(text: str, pattern: str, *, flags: int = 0) -> list[MatchSpan]:
    return [MatchSpan(m.start(), m.end(), "regex") for m in re.finditer(pattern, text, flags)]


def _find_normalized_ws_spans(text: str, needle: str) -> list[MatchSpan]:
    norm_text, text_map = _normalize_ws_with_map(text)
    norm_needle, _ = _normalize_ws_with_map(needle)
    if not norm_needle:
        return []

    spans = []
    start = 0
    while True:
        index = norm_text.find(norm_needle, start)
        if index < 0:
            break
        original_start = text_map[index]
        norm_end = index + len(norm_needle) - 1
        original_end = text_map[min(norm_end, len(text_map) - 1)] + 1
        # Expand over trailing whitespace that belonged to the same original block cautiously.
        spans.append(MatchSpan(original_start, original_end, "normalized_ws"))
        start = index + max(1, len(norm_needle))
    return spans


def _line_offsets(text: str) -> list[int]:
    offsets = [0]
    for m in re.finditer("\n", text):
        offsets.append(m.end())
    return offsets


def _line_span_to_char_span(text: str, offsets: list[int], start_line: int, end_line_exclusive: int) -> tuple[int, int]:
    start = offsets[start_line]
    if end_line_exclusive >= len(offsets):
        end = len(text)
    else:
        end = offsets[end_line_exclusive]
    return start, end


def _find_fuzzy_line_spans(
    text: str,
    needle: str,
    *,
    min_ratio: float = 0.88,
    context_hint: Optional[str] = None,
    search_radius_lines: int = 80,
    max_candidates: int = 5,
) -> list[MatchSpan]:
    """Find approximate line-window matches.

    This intentionally works on line windows instead of arbitrary character windows to
    avoid replacing a half expression. It is conservative: only a clearly best match
    should be accepted by callers.
    """
    text_lf = _normalize_newlines(text)
    needle_lf = _normalize_newlines(needle).strip("\n")
    if not needle_lf.strip():
        return []

    lines = text_lf.splitlines(keepends=True)
    needle_lines = needle_lf.splitlines(keepends=True)
    n = max(1, len(needle_lines))
    offsets = _line_offsets(text_lf)

    search_line_start = 0
    search_line_end = len(lines)
    if context_hint:
        hint_index = text_lf.find(context_hint)
        if hint_index >= 0:
            hint_line, _ = _line_col_from_index(text_lf, hint_index)
            center = hint_line - 1
            search_line_start = max(0, center - search_radius_lines)
            search_line_end = min(len(lines), center + search_radius_lines)

    window_sizes = sorted(set([n, max(1, n - 2), max(1, n - 1), n + 1, n + 2]))
    target_norm = " ".join(needle_lf.split())
    candidates: list[MatchSpan] = []

    for size in window_sizes:
        if size <= 0:
            continue
        last = max(search_line_start, search_line_end - size + 1)
        for start_line in range(search_line_start, last):
            end_line = min(len(lines), start_line + size)
            window = "".join(lines[start_line:end_line])
            window_norm = " ".join(window.split())
            if not window_norm:
                continue
            ratio = SequenceMatcher(None, target_norm, window_norm).ratio()
            if ratio >= min_ratio:
                start, end = _line_span_to_char_span(text_lf, offsets, start_line, end_line)
                candidates.append(MatchSpan(start, end, "fuzzy", ratio))

    candidates.sort(key=lambda c: c.score, reverse=True)
    return candidates[:max_candidates]


def _anchor_limited_text(text: str, anchor: Optional[str], *, radius: Optional[int]) -> tuple[str, int]:
    if not anchor or not radius:
        return text, 0
    index = text.find(anchor)
    if index < 0:
        return text, 0
    start = max(0, index - radius)
    end = min(len(text), index + len(anchor) + radius)
    return text[start:end], start


def _find_unique_span(
    text: str,
    needle: str,
    *,
    rel_path: str,
    anchor: Optional[str] = None,
    op_id: Optional[str] = None,
    mode: str = "auto",
    variants: Optional[list[str]] = None,
    regex_flags: int = 0,
    context_lines: int = 6,
    fuzzy_min: float = 0.88,
    fuzzy_unique_gap: float = 0.04,
    anchor_radius: Optional[int] = None,
) -> MatchSpan:
    if not needle and mode != "regex":
        raise PatchFailure(rel_path, "empty search block is not allowed", op_id=op_id, anchor=anchor)

    search_needles = [needle] + list(variants or [])
    text_area, base = _anchor_limited_text(text, anchor, radius=anchor_radius)

    all_spans: list[MatchSpan] = []

    def add_spans(spans: list[MatchSpan]) -> None:
        for span in spans:
            all_spans.append(MatchSpan(span.start + base, span.end + base, span.strategy, span.score))

    modes = [mode]
    if mode == "auto":
        modes = ["exact", "variants", "normalized_ws", "fuzzy"]

    for m in modes:
        if m == "exact":
            add_spans(_find_exact_spans(text_area, needle))
        elif m == "variants":
            for variant in search_needles:
                spans = _find_exact_spans(text_area, variant)
                for span in spans:
                    span.strategy = "variant" if variant != needle else "exact"
                add_spans(spans)
        elif m in {"normalized_ws", "whitespace", "ws"}:
            for variant in search_needles:
                add_spans(_find_normalized_ws_spans(text_area, variant))
        elif m == "regex":
            add_spans(_find_regex_spans(text_area, needle, flags=regex_flags))
        elif m == "fuzzy":
            add_spans(_find_fuzzy_line_spans(text_area, needle, min_ratio=fuzzy_min, context_hint=anchor))
        elif m == "auto":
            pass
        else:
            raise PatchFailure(rel_path, f"unknown search mode: {mode}", op_id=op_id, anchor=anchor)

        # For auto mode, return as soon as a conservative unique match is found.
        if mode == "auto" and all_spans:
            break

    if not all_spans:
        context = None
        if anchor:
            context = context_around_pattern(text, anchor, context_lines=context_lines)
        if context is None and needle:
            first_line = needle.strip().splitlines()[0] if needle.strip() else needle[:80]
            if first_line:
                context = context_around_pattern(text, first_line, context_lines=context_lines)
        raise PatchFailure(
            rel_path,
            "expected block not found",
            expected=needle,
            anchor=anchor,
            context=context,
            op_id=op_id,
            strategy=mode,
        )

    # De-duplicate identical spans.
    dedup: dict[tuple[int, int], MatchSpan] = {}
    for span in all_spans:
        key = (span.start, span.end)
        if key not in dedup or span.score > dedup[key].score:
            dedup[key] = span
    spans = sorted(dedup.values(), key=lambda s: s.score, reverse=True)

    if len(spans) == 1:
        return spans[0]

    if spans[0].strategy == "fuzzy":
        if spans[0].score >= fuzzy_min and (spans[0].score - spans[1].score) >= fuzzy_unique_gap:
            return spans[0]

    indexes = [s.start for s in spans]
    raise PatchFailure(
        rel_path,
        f"expected block found {len(spans)} times; patch is ambiguous",
        expected=needle,
        anchor=anchor,
        context=context_around_index(text, spans[0].start, context_lines=context_lines),
        op_id=op_id,
        strategy=mode,
        candidates=_candidate_contexts(text, indexes, context_lines=context_lines),
    )


def _already_patched(text: str, new: Optional[str], already: Any = None) -> bool:
    checks: list[str] = []
    if isinstance(already, str):
        checks = [already]
    elif isinstance(already, list):
        checks = [str(x) for x in already]
    elif new:
        checks = [new]
    return any(check and check in text for check in checks)


# ---------------------------------------------------------------------------
# Operation implementations
# ---------------------------------------------------------------------------


def op_replace(state: PatchRunState, op: dict[str, Any]) -> bool:
    rel_path = op["file"]
    old = op.get("old", "")
    new = op.get("new", "")
    anchor = op.get("anchor")
    op_id = op.get("id") or op.get("desc")
    mode = op.get("mode", "auto")
    context_lines = int(op.get("context_lines", 6))

    text = _read_for_state(state, rel_path)
    if _already_patched(text, new, op.get("already")):
        print(f"already patched/check: {rel_path}")
        state.stats.unchanged += 1
        return False

    span = _find_unique_span(
        text,
        old,
        rel_path=rel_path,
        anchor=anchor,
        op_id=op_id,
        mode=mode,
        variants=op.get("old_variants"),
        regex_flags=int(op.get("regex_flags", 0)),
        context_lines=context_lines,
        fuzzy_min=float(op.get("fuzzy_min", 0.88)),
        fuzzy_unique_gap=float(op.get("fuzzy_unique_gap", 0.04)),
        anchor_radius=op.get("anchor_radius"),
    )
    updated = text[: span.start] + new + text[span.end :]
    changed = _write_changed(state, rel_path, updated)
    if span.strategy != "exact":
        print(f"match  : {span.strategy} score={span.score:.3f} file={rel_path}")
    return changed


def op_replace_any(state: PatchRunState, op: dict[str, Any]) -> bool:
    """Try several old->new alternatives and apply the first unambiguous match."""
    rel_path = op["file"]
    replacements = op.get("replacements") or []
    if not replacements:
        raise PatchFailure(rel_path, "replace_any requires replacements[]", op_id=op.get("id"))
    errors: list[PatchFailure] = []
    for index, repl in enumerate(replacements, start=1):
        child = dict(op)
        child.pop("replacements", None)
        child.update(repl)
        child.setdefault("id", f"{op.get('id') or 'replace_any'}#{index}")
        try:
            return op_replace(state, child)
        except PatchFailure as exc:
            errors.append(exc)
    first = errors[0]
    raise PatchFailure(
        rel_path,
        f"none of {len(replacements)} replacement alternatives matched",
        expected=first.expected,
        anchor=op.get("anchor"),
        context=first.context,
        op_id=op.get("id"),
        strategy="replace_any",
    )


def op_regex_replace(state: PatchRunState, op: dict[str, Any]) -> bool:
    rel_path = op["file"]
    pattern = op["pattern"]
    repl = op.get("repl", op.get("new", ""))
    flags = int(op.get("regex_flags", re.MULTILINE))
    expected_count = op.get("count", op.get("expected_count", 1))
    anchor = op.get("anchor")
    op_id = op.get("id") or op.get("desc")
    context_lines = int(op.get("context_lines", 6))

    text = _read_for_state(state, rel_path)
    if _already_patched(text, op.get("already"), op.get("already")):
        print(f"already patched/check: {rel_path}")
        state.stats.unchanged += 1
        return False

    area, base = _anchor_limited_text(text, anchor, radius=op.get("anchor_radius"))
    match_count = len(list(re.finditer(pattern, area, flags)))
    if expected_count not in {None, "any"} and match_count != int(expected_count):
        ctx = context_around_pattern(text, anchor, context_lines=context_lines) if anchor else None
        candidates = _candidate_contexts(area, [m.start() for m in re.finditer(pattern, area, flags)], context_lines=context_lines)
        raise PatchFailure(
            rel_path,
            f"regex replacement count mismatch: expected {expected_count}, got {match_count}",
            expected=pattern,
            anchor=anchor,
            context=ctx,
            op_id=op_id,
            strategy="regex_replace",
            candidates=candidates,
        )
    updated_area, count = re.subn(pattern, repl, area, count=0 if expected_count in {None, "any"} else int(expected_count), flags=flags)

    if count == 0:
        raise PatchFailure(
            rel_path,
            "regex pattern not found",
            expected=pattern,
            anchor=anchor,
            context=context_around_pattern(text, anchor, context_lines=context_lines) if anchor else None,
            op_id=op_id,
            strategy="regex_replace",
        )

    updated = text[:base] + updated_area + text[base + len(area) :]
    return _write_changed(state, rel_path, updated)


def op_insert(state: PatchRunState, op: dict[str, Any], *, before: bool = False) -> bool:
    rel_path = op["file"]
    anchor = op["anchor"]
    insertion = op.get("insert", op.get("insertion", ""))
    op_id = op.get("id") or op.get("desc")
    mode = op.get("mode", "auto")
    context_lines = int(op.get("context_lines", 6))

    text = _read_for_state(state, rel_path)
    if _already_patched(text, insertion, op.get("already")):
        print(f"already patched/check: {rel_path}")
        state.stats.unchanged += 1
        return False

    span = _find_unique_span(
        text,
        anchor,
        rel_path=rel_path,
        anchor=op.get("context_anchor") or anchor,
        op_id=op_id,
        mode=mode,
        variants=op.get("anchor_variants"),
        regex_flags=int(op.get("regex_flags", 0)),
        context_lines=context_lines,
        fuzzy_min=float(op.get("fuzzy_min", 0.88)),
        fuzzy_unique_gap=float(op.get("fuzzy_unique_gap", 0.04)),
        anchor_radius=op.get("anchor_radius"),
    )
    at = span.start if before else span.end
    updated = text[:at] + insertion + text[at:]
    changed = _write_changed(state, rel_path, updated)
    if span.strategy != "exact":
        print(f"match  : {span.strategy} score={span.score:.3f} file={rel_path}")
    return changed


def op_append(state: PatchRunState, op: dict[str, Any]) -> bool:
    rel_path = op["file"]
    content = op.get("content", op.get("insert", ""))
    text = _read_for_state(state, rel_path)
    if _already_patched(text, content, op.get("already")):
        print(f"already patched/check: {rel_path}")
        state.stats.unchanged += 1
        return False
    sep = "" if text.endswith("\n") or not text else "\n"
    return _write_changed(state, rel_path, text + sep + content)


def op_prepend(state: PatchRunState, op: dict[str, Any]) -> bool:
    rel_path = op["file"]
    content = op.get("content", op.get("insert", ""))
    text = _read_for_state(state, rel_path)
    if _already_patched(text, content, op.get("already")):
        print(f"already patched/check: {rel_path}")
        state.stats.unchanged += 1
        return False
    return _write_changed(state, rel_path, content + text)


def op_write(state: PatchRunState, op: dict[str, Any]) -> bool:
    rel_path = op["file"]
    content = op.get("content", "")
    create = bool(op.get("create", True))
    return _write_changed(state, rel_path, content, create=create)


def _condition_matches(state: PatchRunState, condition: dict[str, Any]) -> bool:
    rel_path = condition.get("file")
    if condition.get("path_exists") is not None:
        p = state.project_root / str(condition["path_exists"])
        return p.exists()
    if not rel_path:
        raise PatchFailure("<condition>", "condition requires file or path_exists")
    path = state.project_root / rel_path
    exists = path.exists()
    if condition.get("exists") is not None:
        return exists is bool(condition["exists"])
    if not exists:
        return False
    text = path.read_text(encoding="utf-8")
    if "contains" in condition:
        return str(condition["contains"]) in text
    if "not_contains" in condition:
        return str(condition["not_contains"]) not in text
    if "regex" in condition:
        return re.search(str(condition["regex"]), text, int(condition.get("regex_flags", re.MULTILINE))) is not None
    if "not_regex" in condition:
        return re.search(str(condition["not_regex"]), text, int(condition.get("regex_flags", re.MULTILINE))) is None
    raise PatchFailure(rel_path, "unknown condition")


def op_if(state: PatchRunState, op: dict[str, Any]) -> bool:
    condition = op.get("condition") or {k: op[k] for k in ("file", "contains", "not_contains", "regex", "not_regex", "exists", "path_exists") if k in op}
    branch = op.get("then", []) if _condition_matches(state, condition) else op.get("else", [])
    if not branch:
        print(f"condition/no-op: {op.get('id') or condition}")
        state.stats.unchanged += 1
        return False
    before = (state.stats.patched, state.stats.created, state.stats.unchanged)
    _apply_ops(state, branch, inherited_on_error=op.get("on_error", "stop"))
    after = (state.stats.patched, state.stats.created, state.stats.unchanged)
    return after != before


def op_first_success(state: PatchRunState, op: dict[str, Any]) -> bool:
    """Try alternatives until one succeeds.

    Alternatives should be independent. This function is best for finding local code
    shape A vs B before any write happens. If an alternative partially writes then
    fails, that failure is not rolled back; keep alternatives small and atomic.
    """
    rel_path = op.get("file", "<multi-file>")
    alternatives = op.get("alternatives") or []
    if not alternatives:
        raise PatchFailure(rel_path, "first_success requires alternatives[]", op_id=op.get("id"))
    errors: list[PatchFailure] = []
    for index, alt in enumerate(alternatives, start=1):
        checkpoint = (state.stats.patched, state.stats.created, state.stats.unchanged, len(state.failures))
        try:
            ops = alt if isinstance(alt, list) else [alt]
            _apply_ops(state, ops, inherited_on_error="stop")
            print(f"first_success: selected alternative #{index} ({op.get('id') or rel_path})")
            return True
        except PatchFailure as exc:
            # Only safe if the alternative failed before writing. If it wrote and then
            # failed, do not continue because rollback is intentionally not implicit.
            wrote = (state.stats.patched, state.stats.created) != checkpoint[:2]
            errors.append(exc)
            if wrote:
                raise PatchFailure(
                    rel_path,
                    f"alternative #{index} failed after writing; refusing to try next alternative",
                    expected=exc.expected,
                    anchor=exc.anchor,
                    context=exc.context,
                    op_id=op.get("id"),
                    strategy="first_success",
                )
            # Remove any failure that was recorded by nested code before retrying.
            while len(state.failures) > checkpoint[3]:
                state.failures.pop()
            state.stats.failed = max(0, state.stats.failed - 1)
    first = errors[0]
    raise PatchFailure(
        rel_path,
        f"all {len(alternatives)} alternatives failed",
        expected=first.expected,
        anchor=first.anchor,
        context=first.context,
        op_id=op.get("id"),
        strategy="first_success",
    )


_OPS: dict[str, Callable[[PatchRunState, dict[str, Any]], bool]] = {
    "replace": op_replace,
    "replace_exact": lambda s, o: op_replace(s, {**o, "mode": "exact"}),
    "replace_ws": lambda s, o: op_replace(s, {**o, "mode": "normalized_ws"}),
    "replace_fuzzy": lambda s, o: op_replace(s, {**o, "mode": "fuzzy"}),
    "replace_any": op_replace_any,
    "regex_replace": op_regex_replace,
    "insert_after": lambda s, o: op_insert(s, o, before=False),
    "insert_before": lambda s, o: op_insert(s, o, before=True),
    "append": op_append,
    "prepend": op_prepend,
    "write": op_write,
    "if": op_if,
    "first_success": op_first_success,
}


def _apply_one(state: PatchRunState, op: dict[str, Any], *, inherited_on_error: str) -> None:
    kind = op.get("kind", "replace")
    on_error = op.get("on_error", inherited_on_error)
    if kind not in _OPS:
        raise PatchFailure(op.get("file", "<operation>"), f"unknown operation kind: {kind}", op_id=op.get("id"))

    try:
        _OPS[kind](state, op)
    except PatchFailure as exc:
        if not exc.op_id and op.get("id"):
            exc.op_id = str(op["id"])
        if on_error == "skip":
            state.record_failure(exc)
            state.stats.skipped += 1
            print_patch_error(exc)
            YELLOW = "\033[93m"
            RESET = "\033[0m"
            print(f"{YELLOW}SKIP : continuing after failed operation ({op.get('id') or kind}){RESET}")
            return
        if on_error == "ignore":
            state.stats.ignored += 1
            YELLOW = "\033[93m"
            RESET = "\033[0m"
            print(f"{YELLOW}IGNORE: {exc.rel_path}: {exc.message}{RESET}")
            return
        raise exc


def _apply_ops(state: PatchRunState, ops: Iterable[dict[str, Any]], *, inherited_on_error: str = "stop") -> None:
    for op in ops:
        _apply_one(state, op, inherited_on_error=inherited_on_error)


# ---------------------------------------------------------------------------
# Public runner API
# ---------------------------------------------------------------------------


def apply_ops(
    project_root: Path,
    patch_name: str,
    ops: Iterable[dict[str, Any]],
    *,
    default_on_error: str = "stop",
) -> PatchRunState:
    state = PatchRunState(project_root=project_root, patch_name=patch_name)
    try:
        _apply_ops(state, ops, inherited_on_error=default_on_error)
    except PatchFailure as exc:
        state.record_failure(exc)
        print_patch_error(exc)
    return state


def print_summary(state: PatchRunState) -> None:
    RED = "\033[91m"
    YELLOW = "\033[93m"
    BOLD = "\033[1m"
    RESET = "\033[0m"
    s = state.stats

    # A failure always retains the complete summary. The no-change banner is
    # valid only when the run succeeded and both patched and created are zero.
    if s.failed == 0 and s.patched == 0 and s.created == 0:
        print()
        print(f"{YELLOW}{BOLD}============================================================{RESET}")
        print(f"{YELLOW}{BOLD}PATCH KHÔNG THAY ĐỔI CODE{RESET}")
        print(f"{YELLOW}{BOLD}============================================================{RESET}")
        print()
        return

    print("Patch summary:")
    print(f"  patched : {s.patched}")
    print(f"  created : {s.created}")
    print(f"  unchanged/check: {s.unchanged}")
    print(f"  backups : {s.backups}")
    if s.failed > 0:
        print(f"  failed  : {RED}{s.failed}{RESET}")
    else:
        print(f"  failed  : {s.failed}")
    if s.skipped:
        print(f"  skipped : {s.skipped}")
    if s.ignored:
        print(f"  ignored : {s.ignored}")
    if state.failed_files:
        print(f"{RED}Failed files:{RESET}")
        for rel_path in sorted(state.failed_files):
            print(f"  - {rel_path}")


def zip_failed_files(state: PatchRunState) -> Optional[Path]:
    if not state.failed_files:
        return None
    ts = _dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    out_dir = state.project_root / "patchs" / "failed_patch_files"
    out_dir.mkdir(parents=True, exist_ok=True)
    zip_path = out_dir / f"{_safe_patch_name(state.patch_name)}_failed_{ts}.zip"
    
    # Map failed rel_paths to their respective failures to look up expected/old content if missing
    failure_map = {exc.rel_path: exc for exc in state.failures}
    
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        # 1. Zip the running patch script itself if found
        patch_file_path = None
        if sys.argv and sys.argv[0]:
            argv_path = Path(sys.argv[0]).resolve()
            if argv_path.exists() and argv_path.is_file() and argv_path.suffix == ".py":
                patch_file_path = argv_path
        if not patch_file_path:
            candidate = state.project_root / "patchs" / f"patch_{state.patch_name}.py"
            if candidate.exists():
                patch_file_path = candidate
                
        if patch_file_path:
            try:
                rel_patch = patch_file_path.relative_to(state.project_root)
            except ValueError:
                rel_patch = Path("patchs") / patch_file_path.name
            zf.write(patch_file_path, arcname=str(rel_patch))

        # 2. Zip all failed files (or write expected content if they don't exist)
        for rel_path in sorted(state.failed_files):
            path = state.project_root / rel_path
            if path.exists() and path.is_file():
                zf.write(path, arcname=rel_path)
            else:
                exc = failure_map.get(rel_path)
                content = ""
                if exc and exc.expected:
                    content = exc.expected
                else:
                    content = f"// ERROR: File {rel_path} was not found on disk during patch execution.\n"
                zf.writestr(rel_path, content)
                
    print(f"failed-files zip: {zip_path.resolve()}")
    return zip_path


def maybe_prompt_zip_failed_files(
    state: PatchRunState,
    *,
    force: Optional[bool] = None,
    delete_generated_zip: Optional[bool] = None,
) -> Optional[Path]:
    if not state.failed_files:
        return None
    if force is False:
        print("Zip failed files: skipped by patch setting.")
        return None

    zip_path = None
    if force is True:
        zip_path = zip_failed_files(state)
    else:
        if not sys.stdin.isatty():
            print("Zip failed files: skipped because stdin is not interactive.")
            print("Use --zip-failed to create it without a prompt.")
            return None
        answer = input("Có zip toàn bộ file patch lỗi để gửi lên ChatGPT không? [Y/n]: ").strip().lower()
        if answer in {"", "y", "yes", "c", "co", "có"}:
            zip_path = zip_failed_files(state)
        else:
            print("Zip failed files: no")

    if not zip_path or not zip_path.exists():
        return zip_path

    try:
        rel_zip = zip_path.relative_to(state.project_root)
    except Exception:
        rel_zip = zip_path

    if delete_generated_zip is True:
        zip_path.unlink()
        print(f"Deleted: {rel_zip}")
        return zip_path
    if delete_generated_zip is False:
        print(f"Kept: {rel_zip}")
        return zip_path
    if not sys.stdin.isatty():
        print(f"Kept: {rel_zip}")
        return zip_path

    try:
        answer = input(f"Delete this generated zip file: {rel_zip}? [Y/n]: ").strip().lower()
        if answer in {"", "y", "yes", "c", "co", "có"}:
            zip_path.unlink()
            print(f"Deleted: {rel_zip}")
        else:
            print(f"Kept: {rel_zip}")
    except KeyboardInterrupt:
        print(f"\nKept: {rel_zip}")
    except Exception as exc:
        print(f"Error deleting zip file: {exc}")

    return zip_path


def _print_patch_cli_help(patch_name: str) -> None:
    print(f"Usage: {Path(sys.argv[0]).name} [PATCH OPTIONS]")
    print()
    print(f"Patch: {patch_name}")
    print()
    print("Options handled by tools/python_patch_utils.py:")
    print("  -h, --help                 Show this help and do not apply the patch")
    print("      --zip-failed           Create failed-files ZIP without asking")
    print("      --no-zip-failed        Never create failed-files ZIP")
    print("      --delete-failed-zip    Delete generated failed-files ZIP")
    print("      --keep-failed-zip      Keep generated failed-files ZIP")
    print()
    print("Unknown options are left available for patch-specific code.")


def _read_patch_cli_options(patch_name: str) -> tuple[bool, Optional[bool], Optional[bool]]:
    help_requested = False
    zip_failed: Optional[bool] = None
    delete_failed_zip: Optional[bool] = None

    for arg in sys.argv[1:]:
        if arg in {"-h", "--help"}:
            help_requested = True
        elif arg == "--zip-failed":
            zip_failed = True
        elif arg == "--no-zip-failed":
            zip_failed = False
        elif arg == "--delete-failed-zip":
            delete_failed_zip = True
        elif arg == "--keep-failed-zip":
            delete_failed_zip = False

    if help_requested:
        _print_patch_cli_help(patch_name)
    return help_requested, zip_failed, delete_failed_zip


def run_patch(
    patch_name: str,
    ops: Iterable[dict[str, Any]],
    *,
    default_on_error: str = "stop",
    prompt_zip_on_error: Optional[bool] = None,
    delete_failed_zip: Optional[bool] = None,
) -> int:
    help_requested, cli_zip_failed, cli_delete_failed_zip = _read_patch_cli_options(patch_name)
    if help_requested:
        return 0

    if cli_zip_failed is not None:
        prompt_zip_on_error = cli_zip_failed
    if cli_delete_failed_zip is not None:
        delete_failed_zip = cli_delete_failed_zip

    root = find_project_root()
    state = apply_ops(root, patch_name, ops, default_on_error=default_on_error)
    print_summary(state)
    maybe_prompt_zip_failed_files(
        state,
        force=prompt_zip_on_error,
        delete_generated_zip=delete_failed_zip,
    )
    if state.failures:
        RED = "\033[91m"
        BOLD = "\033[1m"
        RESET = "\033[0m"
        print(f"{RED}{BOLD}Patch completed with errors.{RESET}")
        return 1
    print("Patch completed successfully.")
    return 0


# ---------------------------------------------------------------------------
# Backward-compatible legacy functions
# ---------------------------------------------------------------------------


def replace_exact_once(
    project_root: Path,
    rel_path: str,
    old: str,
    new: str,
    patch_name: str,
    *,
    anchor: Optional[str] = None,
    context_lines: int = 6,
) -> bool:
    state = PatchRunState(project_root=project_root, patch_name=patch_name)
    return op_replace(
        state,
        {
            "kind": "replace_exact",
            "file": rel_path,
            "old": old,
            "new": new,
            "anchor": anchor,
            "context_lines": context_lines,
        },
    )


def replace_ws_once(
    project_root: Path,
    rel_path: str,
    old: str,
    new: str,
    patch_name: str,
    *,
    anchor: Optional[str] = None,
    context_lines: int = 6,
) -> bool:
    state = PatchRunState(project_root=project_root, patch_name=patch_name)
    return op_replace(
        state,
        {
            "kind": "replace_ws",
            "file": rel_path,
            "old": old,
            "new": new,
            "anchor": anchor,
            "context_lines": context_lines,
        },
    )


def replace_fuzzy_once(
    project_root: Path,
    rel_path: str,
    old: str,
    new: str,
    patch_name: str,
    *,
    anchor: Optional[str] = None,
    fuzzy_min: float = 0.88,
    context_lines: int = 6,
) -> bool:
    state = PatchRunState(project_root=project_root, patch_name=patch_name)
    return op_replace(
        state,
        {
            "kind": "replace_fuzzy",
            "file": rel_path,
            "old": old,
            "new": new,
            "anchor": anchor,
            "fuzzy_min": fuzzy_min,
            "context_lines": context_lines,
        },
    )


def insert_after_once(
    project_root: Path,
    rel_path: str,
    anchor: str,
    insertion: str,
    patch_name: str,
    *,
    context_lines: int = 6,
) -> bool:
    state = PatchRunState(project_root=project_root, patch_name=patch_name)
    return op_insert(
        state,
        {
            "kind": "insert_after",
            "file": rel_path,
            "anchor": anchor,
            "insert": insertion,
            "context_lines": context_lines,
        },
        before=False,
    )


def insert_before_once(
    project_root: Path,
    rel_path: str,
    anchor: str,
    insertion: str,
    patch_name: str,
    *,
    context_lines: int = 6,
) -> bool:
    state = PatchRunState(project_root=project_root, patch_name=patch_name)
    return op_insert(
        state,
        {
            "kind": "insert_before",
            "file": rel_path,
            "anchor": anchor,
            "insert": insertion,
            "context_lines": context_lines,
        },
        before=True,
    )


def write_file_if_changed(project_root: Path, rel_path: str, content: str, patch_name: str) -> bool:
    state = PatchRunState(project_root=project_root, patch_name=patch_name)
    return op_write(state, {"kind": "write", "file": rel_path, "content": content, "create": True})


def finish_success() -> None:
    print("Patch completed successfully.")


def finish_failure(exc: Exception) -> int:
    if isinstance(exc, PatchFailure):
        print_patch_error(exc)
    else:
        RED = "\033[91m"
        BOLD = "\033[1m"
        RESET = "\033[0m"
        print(f"{RED}{BOLD}ERROR: unexpected patch failure: {exc}{RESET}")
    return 1
