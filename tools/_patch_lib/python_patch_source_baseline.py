#!/usr/bin/env python3
"""Generate a Patch Tool v5.16 source_baseline manifest fragment.

The generator hashes current project files and, when possible, infers a function/
class symbol from PATCH_TOOL_OPS.json anchors.  It uses the same symbol extractor
and normalization rules as the runner, preventing hand-written baseline drift.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
from typing import Any

from python_patch_diagnostics import extract_ops_paths, extract_symbol_context

TOOL_VERSION = "5.16.0"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate source_baseline JSON for a Patch Tool manifest.")
    parser.add_argument("--project-root", type=Path, default=Path.cwd())
    parser.add_argument("--ops", type=Path, help="PATCH_TOOL_OPS.json; target files and anchor symbols are inferred.")
    parser.add_argument("--file", action="append", default=[], help="Additional project-relative file; repeat as needed.")
    parser.add_argument("--symbol", action="append", default=[], metavar="FILE=SYMBOL", help="Bind a file to a function/class symbol.")
    parser.add_argument("--line", action="append", default=[], metavar="FILE=LINE", help="Optional line hint for symbol extraction.")
    parser.add_argument("--output", type=Path, help="Write JSON to this path instead of stdout.")
    parser.add_argument("--fragment-only", action="store_true", help="Emit only the source_baseline object (default emits a manifest-ready wrapper).")
    return parser.parse_args()


def safe_rel(value: str) -> str:
    normalized=value.strip().replace("\\", "/")
    pure=PurePosixPath(normalized)
    if not normalized or pure.is_absolute() or any(part in {"", ".."} for part in pure.parts):
        raise ValueError(f"Path must stay inside the project root: {value!r}")
    return pure.as_posix()


def parse_map(values: list[str], *, numeric: bool=False) -> dict[str, Any]:
    result={}
    for value in values:
        if "=" not in value:
            raise ValueError(f"Expected FILE=VALUE, got {value!r}")
        rel, raw=value.split("=",1)
        rel=safe_rel(rel)
        if numeric:
            number=int(raw)
            if number < 1: raise ValueError(f"Line must be >= 1 for {rel}")
            result[rel]=number
        else:
            raw=raw.strip()
            if not raw or any(ch in raw for ch in "\r\n\x00"):
                raise ValueError(f"Invalid symbol for {rel}")
            result[rel]=raw
    return result


def infer_ops(data: Any) -> tuple[set[str], dict[str,str]]:
    files=extract_ops_paths(data)
    symbols={}
    def walk(value: Any) -> None:
        if isinstance(value,dict):
            rel=value.get("file")
            anchor=str(value.get("anchor","") or value.get("old","") or "")
            if isinstance(rel,str) and anchor:
                match=re.search(r"\b([A-Za-z_$~][\w$:]*)\s*\(",anchor)
                if match: symbols.setdefault(rel,match.group(1).split("::")[-1])
            for child in value.values(): walk(child)
        elif isinstance(value,list):
            for child in value: walk(child)
    walk(data)
    return files,symbols


def git_head(root: Path) -> str:
    try:
        cp=subprocess.run(["git","rev-parse","HEAD"],cwd=root,text=True,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,check=False)
        return cp.stdout.strip() if cp.returncode==0 else ""
    except Exception:
        return ""


def main() -> int:
    args=parse_args(); root=args.project_root.expanduser().resolve()
    files={safe_rel(x) for x in args.file}; inferred_symbols={}
    if args.ops:
        ops_path=args.ops.expanduser()
        if not ops_path.is_absolute(): ops_path=(Path.cwd()/ops_path).resolve()
        data=json.loads(ops_path.read_text(encoding="utf-8"))
        ops_files, inferred_symbols=infer_ops(data)
        files.update(safe_rel(x) for x in ops_files)
    symbols={safe_rel(k):v for k,v in inferred_symbols.items()}
    symbols.update(parse_map(args.symbol)); lines=parse_map(args.line,numeric=True)
    entries=[]
    for rel in sorted(files | set(symbols)):
        path=(root/rel).resolve()
        try: path.relative_to(root)
        except ValueError: raise ValueError(f"Path escapes project root: {rel}")
        if not path.is_file(): raise FileNotFoundError(f"Source file not found: {rel}")
        entry={"file":rel,"sha256":hashlib.sha256(path.read_bytes()).hexdigest()}
        symbol_name=symbols.get(rel,"")
        if symbol_name:
            symbol=extract_symbol_context(path,line_hint=int(lines.get(rel,0)),symbol_hint=symbol_name)
            if not symbol: raise RuntimeError(f"Could not locate symbol {symbol_name!r} in {rel}")
            entry.update(symbol=symbol_name,symbol_sha256=symbol["sha256"],line_hint=symbol["start_line"])
        entries.append(entry)
    head=git_head(root)
    baseline={"generated_from":f"git:{head}" if head else f"filesystem:PatchTool-{TOOL_VERSION}","files":entries}
    payload=baseline if args.fragment_only else {"source_baseline":baseline}
    text=json.dumps(payload,ensure_ascii=False,indent=2)+"\n"
    if args.output:
        args.output.parent.mkdir(parents=True,exist_ok=True); args.output.write_text(text,encoding="utf-8")
        print(args.output)
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    try: raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}",file=sys.stderr); raise SystemExit(1)
