#!/usr/bin/env python3
"""
python_patch_decompile_extractor.py
====================

Reusable extractor/indexer for very large IDA/Ghidra-style decompile dumps.

Designed for files that contain blocks like:

//----- (0x21E180E) ----------------------------------------------------
void __cdecl FightBaseLogic::FightBaseLogic(...)

The first run builds a compact SQLite index. Later query scripts reuse it and
extract exact function bodies, neighboring functions, and text-reference
contexts without loading the whole 163 MB file into Python strings.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import mmap
import os
import re
import shutil
import sqlite3
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Iterator, Sequence

TOOL_VERSION = "5.16.0"
INDEX_SCHEMA_VERSION = 2
DEFAULT_SOURCE = Path("docs/decompile.c")
DEFAULT_INDEX = Path("artifacts/.patch_tool_decompile_index.sqlite3")
DEFAULT_OUTPUT_ROOT = Path("artifacts/patch_tool_code_collections")

MARKER_RE = re.compile(
    rb"^//----- \(0x([0-9A-Fa-f]+)\) -+\r?$",
    re.MULTILINE,
)

SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._-]+")
SYMBOL_TOKEN_RE = re.compile(r"([A-Za-z_~][A-Za-z0-9_:~<>]*)\s*\(")


class ExtractError(RuntimeError):
    pass


@dataclass(frozen=True)
class FunctionRecord:
    row_id: int
    address: int
    start_offset: int
    end_offset: int
    marker_line: str
    signature: str
    symbol: str
    preview: str

    @property
    def address_hex(self) -> str:
        return f"0x{self.address:X}"


def _safe_name(value: str, fallback: str = "item") -> str:
    cleaned = SAFE_NAME_RE.sub("_", value.strip()).strip("._-")
    return cleaned or fallback


def _normalize_address(value: int | str) -> int:
    if isinstance(value, int):
        if value < 0:
            raise ExtractError(f"Address must be non-negative: {value}")
        return value
    text = str(value).strip().lower()
    base = 16 if text.startswith("0x") else 16
    try:
        return int(text, base)
    except ValueError as exc:
        raise ExtractError(f"Invalid address: {value!r}") from exc


def _source_fingerprint(source: Path) -> dict[str, str]:
    st = source.stat()
    return {
        "schema_version": str(INDEX_SCHEMA_VERSION),
        "source_name": source.name,
        "source_size": str(st.st_size),
        "source_mtime_ns": str(st.st_mtime_ns),
    }


def _db_meta(conn: sqlite3.Connection) -> dict[str, str]:
    rows = conn.execute("SELECT key, value FROM meta").fetchall()
    return {str(k): str(v) for k, v in rows}


def _index_is_current(index_path: Path, source: Path) -> bool:
    if not index_path.exists():
        return False
    try:
        with sqlite3.connect(index_path) as conn:
            actual = _db_meta(conn)
    except (sqlite3.Error, OSError):
        return False
    expected = _source_fingerprint(source)
    return all(actual.get(k) == v for k, v in expected.items())


def _decode(data: bytes) -> str:
    # IDA exports are normally UTF-8/ASCII. Replacement is safer than failing
    # the entire extraction because of one malformed byte.
    return data.decode("utf-8", errors="replace")


def _extract_signature_and_symbol(block_head: bytes) -> tuple[str, str, str]:
    text = _decode(block_head)
    lines = text.splitlines()

    signature_lines: list[str] = []
    saw_code = False
    brace_seen = False

    for line in lines[1:]:
        stripped = line.strip()
        if not stripped:
            if saw_code and not brace_seen:
                signature_lines.append("")
            continue
        if stripped.startswith("//"):
            if not saw_code:
                continue
            if brace_seen:
                break
        saw_code = True
        signature_lines.append(line.rstrip())
        if "{" in line:
            brace_seen = True
            break
        if stripped.endswith(";"):
            break
        if len(signature_lines) >= 24:
            break

    signature = "\n".join(signature_lines).strip()
    compact = " ".join(part.strip() for part in signature.splitlines() if part.strip())

    symbol = ""
    matches = list(SYMBOL_TOKEN_RE.finditer(compact))
    if matches:
        symbol = matches[-1].group(1)

    preview = "\n".join(lines[:40])
    return signature, symbol, preview


def _iter_markers(mm: mmap.mmap) -> Iterator[tuple[int, int, int, str]]:
    """
    Yield (address, marker_start, marker_end, marker_line).
    marker_end points just after the marker line terminator when present.
    """
    for match in MARKER_RE.finditer(mm):
        address = int(match.group(1), 16)
        marker_start = match.start()
        marker_line_end = mm.find(b"\n", match.end())
        if marker_line_end < 0:
            marker_end = match.end()
        else:
            marker_end = marker_line_end + 1
        marker_line = _decode(mm[match.start():match.end()])
        yield address, marker_start, marker_end, marker_line


def build_index(source: Path, index_path: Path, *, force: bool = False) -> dict[str, Any]:
    source = source.resolve()
    index_path = index_path.resolve()

    if not source.is_file():
        raise ExtractError(f"Source file not found: {source}")

    if not force and _index_is_current(index_path, source):
        with sqlite3.connect(index_path) as conn:
            count = int(conn.execute("SELECT COUNT(*) FROM functions").fetchone()[0])
        return {
            "rebuilt": False,
            "source": source.name,
            "index": index_path.name,
            "function_count": count,
        }

    index_path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(
        prefix=index_path.name + ".",
        suffix=".tmp",
        dir=str(index_path.parent),
    )
    os.close(fd)
    temp_path = Path(temp_name)

    try:
        with sqlite3.connect(temp_path) as conn:
            conn.execute("PRAGMA journal_mode=OFF")
            conn.execute("PRAGMA synchronous=OFF")
            conn.execute(
                """
                CREATE TABLE meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE functions (
                    id INTEGER PRIMARY KEY,
                    address INTEGER NOT NULL,
                    start_offset INTEGER NOT NULL,
                    end_offset INTEGER NOT NULL,
                    marker_line TEXT NOT NULL,
                    signature TEXT NOT NULL,
                    symbol TEXT NOT NULL,
                    preview TEXT NOT NULL
                )
                """
            )
            conn.execute("CREATE INDEX idx_functions_address ON functions(address)")
            conn.execute("CREATE INDEX idx_functions_symbol ON functions(symbol)")

            fingerprint = _source_fingerprint(source)
            conn.executemany(
                "INSERT INTO meta(key, value) VALUES(?, ?)",
                sorted(fingerprint.items()),
            )

            with source.open("rb") as fh:
                mm = mmap.mmap(fh.fileno(), 0, access=mmap.ACCESS_READ)
                try:
                    markers = list(_iter_markers(mm))
                    rows = []
                    for i, (address, start, marker_end, marker_line) in enumerate(markers):
                        end = markers[i + 1][1] if i + 1 < len(markers) else len(mm)
                        head_end = min(end, marker_end + 16_384)
                        signature, symbol, preview = _extract_signature_and_symbol(
                            mm[start:head_end]
                        )
                        rows.append(
                            (
                                address,
                                start,
                                end,
                                marker_line,
                                signature,
                                symbol,
                                preview,
                            )
                        )
                        if len(rows) >= 2000:
                            conn.executemany(
                                """
                                INSERT INTO functions(
                                    address, start_offset, end_offset,
                                    marker_line, signature, symbol, preview
                                ) VALUES(?, ?, ?, ?, ?, ?, ?)
                                """,
                                rows,
                            )
                            rows.clear()

                    if rows:
                        conn.executemany(
                            """
                            INSERT INTO functions(
                                address, start_offset, end_offset,
                                marker_line, signature, symbol, preview
                            ) VALUES(?, ?, ?, ?, ?, ?, ?)
                            """,
                            rows,
                        )
                finally:
                    mm.close()

            conn.commit()

        os.replace(temp_path, index_path)

    except Exception:
        temp_path.unlink(missing_ok=True)
        raise

    with sqlite3.connect(index_path) as conn:
        count = int(conn.execute("SELECT COUNT(*) FROM functions").fetchone()[0])

    return {
        "rebuilt": True,
        "source": source.name,
        "index": index_path.name,
        "function_count": count,
    }


def _row_to_record(row: Sequence[Any]) -> FunctionRecord:
    return FunctionRecord(
        row_id=int(row[0]),
        address=int(row[1]),
        start_offset=int(row[2]),
        end_offset=int(row[3]),
        marker_line=str(row[4]),
        signature=str(row[5]),
        symbol=str(row[6]),
        preview=str(row[7]),
    )


def _select_records_by_address(
    conn: sqlite3.Connection,
    address: int,
) -> list[FunctionRecord]:
    rows = conn.execute(
        """
        SELECT id, address, start_offset, end_offset,
               marker_line, signature, symbol, preview
        FROM functions
        WHERE address = ?
        ORDER BY id
        """,
        (address,),
    ).fetchall()
    return [_row_to_record(row) for row in rows]


def _select_records_by_name(
    conn: sqlite3.Connection,
    name: str,
    *,
    mode: str,
    case_sensitive: bool,
    max_matches: int,
) -> list[FunctionRecord]:
    if max_matches <= 0:
        raise ExtractError("max_matches must be > 0")

    rows = conn.execute(
        """
        SELECT id, address, start_offset, end_offset,
               marker_line, signature, symbol, preview
        FROM functions
        ORDER BY id
        """
    )

    result: list[FunctionRecord] = []
    needle = name if case_sensitive else name.casefold()

    regex = None
    if mode == "regex":
        flags = 0 if case_sensitive else re.IGNORECASE
        regex = re.compile(name, flags)

    for row in rows:
        rec = _row_to_record(row)
        haystack = "\n".join((rec.symbol, rec.signature, rec.preview))
        compare = haystack if case_sensitive else haystack.casefold()

        matched = False
        if mode == "exact":
            symbol = rec.symbol if case_sensitive else rec.symbol.casefold()
            matched = symbol == needle
        elif mode == "contains":
            matched = needle in compare
        elif mode == "regex":
            assert regex is not None
            matched = bool(regex.search(haystack))
        else:
            raise ExtractError(f"Unknown name match mode: {mode!r}")

        if matched:
            result.append(rec)
            if len(result) >= max_matches:
                break

    return result


def _select_neighbors(
    conn: sqlite3.Connection,
    record: FunctionRecord,
    before: int,
    after: int,
) -> list[FunctionRecord]:
    if before < 0 or after < 0:
        raise ExtractError("Neighbor counts must be >= 0")
    low = max(1, record.row_id - before)
    high = record.row_id + after
    rows = conn.execute(
        """
        SELECT id, address, start_offset, end_offset,
               marker_line, signature, symbol, preview
        FROM functions
        WHERE id BETWEEN ? AND ?
        ORDER BY id
        """,
        (low, high),
    ).fetchall()
    return [_row_to_record(row) for row in rows]


def _read_block(mm: mmap.mmap, record: FunctionRecord) -> bytes:
    return mm[record.start_offset:record.end_offset]


def _line_bounds(mm: mmap.mmap, position: int, context_lines: int) -> tuple[int, int]:
    start = position
    for _ in range(context_lines):
        previous = mm.rfind(b"\n", 0, max(0, start - 1))
        if previous < 0:
            start = 0
            break
        start = previous

    if start > 0 and mm[start:start + 1] == b"\n":
        start += 1

    end = position
    for _ in range(context_lines + 1):
        next_nl = mm.find(b"\n", end)
        if next_nl < 0:
            end = len(mm)
            break
        end = next_nl + 1

    return start, end


def _find_text_contexts(
    mm: mmap.mmap,
    needle_text: str,
    *,
    case_sensitive: bool,
    context_lines: int,
    max_hits: int,
) -> list[dict[str, Any]]:
    if max_hits <= 0:
        return []
    if context_lines < 0:
        raise ExtractError("context_lines must be >= 0")

    needle = needle_text.encode("utf-8")
    if not needle:
        return []

    # Most requested C++ symbols are ASCII. For case-insensitive searching,
    # use a lowercase copy only when requested.
    if case_sensitive:
        haystack = mm
        search_needle = needle

        def finder(start: int) -> int:
            return haystack.find(search_needle, start)

    else:
        lowered = bytes(mm).lower()
        search_needle = needle.lower()

        def finder(start: int) -> int:
            return lowered.find(search_needle, start)

    hits: list[dict[str, Any]] = []
    cursor = 0
    while len(hits) < max_hits:
        pos = finder(cursor)
        if pos < 0:
            break
        start, end = _line_bounds(mm, pos, context_lines)
        hits.append(
            {
                "position": pos,
                "start_offset": start,
                "end_offset": end,
                "text": _decode(mm[start:end]),
            }
        )
        cursor = pos + max(1, len(search_needle))
    return hits


def _record_metadata(record: FunctionRecord) -> dict[str, Any]:
    return {
        "row_id": record.row_id,
        "address": record.address_hex,
        "start_offset": record.start_offset,
        "end_offset": record.end_offset,
        "byte_length": record.end_offset - record.start_offset,
        "symbol": record.symbol,
        "signature": record.signature,
    }


def _write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp")
    temp.write_text(text, encoding="utf-8")
    os.replace(temp, path)


def _write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp")
    temp.write_bytes(data)
    os.replace(temp, path)


def _resolve_project_path(project_root: Path, value: Any, *, must_exist: bool = False) -> Path:
    raw = str(value)
    candidate = Path(raw)
    if candidate.is_absolute() or ".." in candidate.parts:
        raise ExtractError(f"Only project-relative paths are allowed: {raw}")
    resolved = (project_root / candidate).resolve(strict=False)
    try:
        resolved.relative_to(project_root.resolve())
    except ValueError as exc:
        raise ExtractError(f"Path escapes project root: {raw}") from exc
    if must_exist and not resolved.exists():
        raise ExtractError(f"Project path not found: {raw}")
    return resolved


def run_request(request: dict[str, Any], *, project_root: Path | None = None) -> dict[str, Any]:
    if project_root is None:
        project_root = Path.cwd()
    project_root = project_root.resolve()

    title = str(request.get("title") or "Decompile extraction")
    source = _resolve_project_path(project_root, request.get("source") or DEFAULT_SOURCE, must_exist=True)
    index_path = _resolve_project_path(project_root, request.get("index") or DEFAULT_INDEX)

    output_value = request.get("output_dir")
    if output_value:
        output_dir = _resolve_project_path(project_root, output_value)
    else:
        output_dir = _resolve_project_path(project_root, DEFAULT_OUTPUT_ROOT / _safe_name(title))

    force_reindex = bool(request.get("force_reindex", False))
    clean_output = bool(request.get("clean_output", True))

    if clean_output and output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    snippets_dir = output_dir / "snippets"
    references_dir = output_dir / "references"
    snippets_dir.mkdir(parents=True, exist_ok=True)
    references_dir.mkdir(parents=True, exist_ok=True)

    index_info = build_index(source, index_path, force=force_reindex)

    queries = request.get("queries")
    if not isinstance(queries, list) or not queries:
        raise ExtractError("REQUEST['queries'] must be a non-empty list")

    report_lines = [
        f"# {title}",
        "",
        f"- Source: `{source.relative_to(project_root).as_posix()}`",
        f"- Index: `{index_path.relative_to(project_root).as_posix()}`",
        f"- Indexed functions: `{index_info['function_count']}`",
        f"- Index rebuilt: `{index_info['rebuilt']}`",
        "",
    ]
    manifest: dict[str, Any] = {
        "title": title,
        "source": source.relative_to(project_root).as_posix(),
        "index": index_path.relative_to(project_root).as_posix(),
        "index_info": index_info,
        "queries": [],
    }

    with sqlite3.connect(index_path) as conn, source.open("rb") as fh:
        mm = mmap.mmap(fh.fileno(), 0, access=mmap.ACCESS_READ)
        try:
            for q_index, query in enumerate(queries, start=1):
                if not isinstance(query, dict):
                    raise ExtractError(f"Query #{q_index} must be an object")

                query_id = _safe_name(
                    str(query.get("id") or f"query_{q_index:02d}"),
                    fallback=f"query_{q_index:02d}",
                )
                label = str(query.get("label") or query_id)
                before = int(query.get("neighbors_before", 0))
                after = int(query.get("neighbors_after", 0))
                max_matches = int(query.get("max_matches", 20))
                include_references = bool(query.get("include_references", False))
                reference_term = query.get("reference_term")
                reference_context_lines = int(query.get("reference_context_lines", 4))
                max_reference_hits = int(query.get("max_reference_hits", 50))
                case_sensitive = bool(query.get("case_sensitive", True))

                records: list[FunctionRecord]
                query_type: str
                query_value: str

                if "address" in query:
                    address = _normalize_address(query["address"])
                    records = _select_records_by_address(conn, address)
                    query_type = "address"
                    query_value = f"0x{address:X}"
                elif "name" in query:
                    name = str(query["name"])
                    mode = str(query.get("match", "contains"))
                    records = _select_records_by_name(
                        conn,
                        name,
                        mode=mode,
                        case_sensitive=case_sensitive,
                        max_matches=max_matches,
                    )
                    query_type = "name"
                    query_value = name
                else:
                    raise ExtractError(
                        f"Query {query_id!r} needs either 'address' or 'name'"
                    )

                expanded: list[FunctionRecord] = []
                seen_rows: set[int] = set()
                for record in records:
                    for item in _select_neighbors(conn, record, before, after):
                        if item.row_id not in seen_rows:
                            seen_rows.add(item.row_id)
                            expanded.append(item)

                query_manifest: dict[str, Any] = {
                    "id": query_id,
                    "label": label,
                    "type": query_type,
                    "value": query_value,
                    "matches": [],
                    "references": [],
                }

                report_lines.extend(
                    [
                        f"## {q_index}. {label}",
                        "",
                        f"- Query type: `{query_type}`",
                        f"- Query value: `{query_value}`",
                        f"- Direct matches: `{len(records)}`",
                        f"- Extracted blocks including neighbors: `{len(expanded)}`",
                        "",
                    ]
                )

                if not records:
                    report_lines.append("**No matching function block found.**")
                    report_lines.append("")

                for item_index, record in enumerate(expanded, start=1):
                    block = _read_block(mm, record)
                    slug = _safe_name(record.symbol or f"function_{record.address_hex}")
                    file_name = (
                        f"{query_id}__{item_index:02d}__"
                        f"{record.address_hex}__{slug}.c"
                    )
                    snippet_path = snippets_dir / file_name
                    _write_bytes(snippet_path, block)

                    meta = _record_metadata(record)
                    meta["file"] = str(snippet_path.relative_to(output_dir))
                    meta["is_direct_match"] = any(
                        direct.row_id == record.row_id for direct in records
                    )
                    query_manifest["matches"].append(meta)

                    report_lines.extend(
                        [
                            f"### {record.address_hex} — "
                            f"{record.symbol or '(symbol not parsed)'}",
                            "",
                            f"- File: `{meta['file']}`",
                            f"- Bytes: `{meta['byte_length']}`",
                            f"- Direct match: `{meta['is_direct_match']}`",
                            "",
                            "```cpp",
                            _decode(block).rstrip(),
                            "```",
                            "",
                        ]
                    )

                if include_references:
                    if reference_term is None:
                        if "name" in query:
                            reference_term = str(query["name"])
                        elif records and records[0].symbol:
                            reference_term = records[0].symbol

                    if reference_term:
                        refs = _find_text_contexts(
                            mm,
                            str(reference_term),
                            case_sensitive=case_sensitive,
                            context_lines=reference_context_lines,
                            max_hits=max_reference_hits,
                        )
                        report_lines.extend(
                            [
                                f"### Text references for `{reference_term}`",
                                "",
                                f"Occurrences exported: `{len(refs)}`",
                                "",
                            ]
                        )
                        for ref_index, ref in enumerate(refs, start=1):
                            ref_file = (
                                references_dir
                                / f"{query_id}__ref_{ref_index:03d}.txt"
                            )
                            _write_text(ref_file, str(ref["text"]))
                            ref_meta = {
                                "position": ref["position"],
                                "start_offset": ref["start_offset"],
                                "end_offset": ref["end_offset"],
                                "file": str(ref_file.relative_to(output_dir)),
                            }
                            query_manifest["references"].append(ref_meta)
                            report_lines.extend(
                                [
                                    f"#### Reference {ref_index}",
                                    "",
                                    f"- File: `{ref_meta['file']}`",
                                    f"- Byte position: `{ref_meta['position']}`",
                                    "",
                                    "```cpp",
                                    str(ref["text"]).rstrip(),
                                    "```",
                                    "",
                                ]
                            )
                    else:
                        report_lines.extend(
                            [
                                "### Text references",
                                "",
                                "Reference search skipped because no term could be derived.",
                                "",
                            ]
                        )

                manifest["queries"].append(query_manifest)
        finally:
            mm.close()

    report_path = output_dir / "report.md"
    manifest_path = output_dir / "manifest.json"
    _write_text(report_path, "\n".join(report_lines).rstrip() + "\n")
    _write_text(
        manifest_path,
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
    )

    archive_path = shutil.make_archive(
        str(output_dir),
        "zip",
        root_dir=str(output_dir),
    )

    result = {
        "title": title,
        "source": source.relative_to(project_root).as_posix(),
        "index": index_path.relative_to(project_root).as_posix(),
        "output_dir": output_dir.relative_to(project_root).as_posix(),
        "report": report_path.relative_to(project_root).as_posix(),
        "manifest": manifest_path.relative_to(project_root).as_posix(),
        "archive": Path(archive_path).relative_to(project_root).as_posix(),
        "query_count": len(queries),
        "index_info": index_info,
    }

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return result


def _load_request_file(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise ExtractError(f"Request JSON not found: {path}")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ExtractError("Request JSON root must be an object")
    return value


def _build_cli() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Index and extract functions from large IDA/Ghidra-style decompile files"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    build = sub.add_parser("build-index", help="Build or refresh the SQLite index")
    build.add_argument("--source", default=str(DEFAULT_SOURCE))
    build.add_argument("--index", default=str(DEFAULT_INDEX))
    build.add_argument("--force", action="store_true")

    run = sub.add_parser("run-json", help="Run a JSON request file")
    run.add_argument("request_json")
    run.add_argument("--project-root", default=".")

    one = sub.add_parser("extract", help="One-off address/name extraction")
    one.add_argument("--source", default=str(DEFAULT_SOURCE))
    one.add_argument("--index", default=str(DEFAULT_INDEX))
    group = one.add_mutually_exclusive_group(required=True)
    group.add_argument("--address")
    group.add_argument("--name")
    one.add_argument("--match", choices=("exact", "contains", "regex"), default="contains")
    one.add_argument("--references", action="store_true")
    one.add_argument("--neighbors-before", type=int, default=0)
    one.add_argument("--neighbors-after", type=int, default=0)
    one.add_argument("--output-dir")
    one.add_argument("--title", default="Decompile one-off extraction")

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = _build_cli()
    args = parser.parse_args(argv)

    try:
        if args.command == "build-index":
            result = build_index(
                Path(args.source),
                Path(args.index),
                force=bool(args.force),
            )
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 0

        if args.command == "run-json":
            request = _load_request_file(Path(args.request_json))
            run_request(request, project_root=Path(args.project_root))
            return 0

        if args.command == "extract":
            query: dict[str, Any] = {
                "id": "one_off",
                "label": args.address or args.name,
                "include_references": bool(args.references),
                "neighbors_before": int(args.neighbors_before),
                "neighbors_after": int(args.neighbors_after),
            }
            if args.address:
                query["address"] = args.address
            else:
                query["name"] = args.name
                query["match"] = args.match

            request = {
                "title": args.title,
                "source": args.source,
                "index": args.index,
                "queries": [query],
            }
            if args.output_dir:
                request["output_dir"] = args.output_dir
            run_request(request)
            return 0

        raise ExtractError(f"Unhandled command: {args.command}")

    except (ExtractError, OSError, sqlite3.Error, re.error, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
