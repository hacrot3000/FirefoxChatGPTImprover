#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from typing import Any, Iterable

GUARD_VERSION = "5.15.1"
MARKER_NAME = ".ptv5151_force_repeat_once"
AUDIT_NAME = "selection_integrity_guard.jsonl"
CANDIDATE_SUFFIXES = (".zip", ".py", ".tar.gz", ".tgz")
KNOWN_FALSE_INCIDENTS = {"patch_nfc179_protected_read_consume_cleanup_boundary_v5_20260807_1320.zip"}


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def is_candidate(path: Path) -> bool:
    if not path.is_file():
        return False
    name = path.name.lower()
    return name.startswith("patch") and any(name.endswith(s) for s in CANDIDATE_SUFFIXES)


def queue_snapshot(patch_dir: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    if not patch_dir.is_dir():
        return result
    for p in patch_dir.iterdir():
        if is_candidate(p):
            try:
                result[p.name] = sha256_file(p)
            except OSError:
                pass
    return result


def iter_json_strings(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for k, v in value.items():
            yield str(k)
            yield from iter_json_strings(v)
    elif isinstance(value, list):
        for item in value:
            yield from iter_json_strings(item)


def history_lines(history: Path) -> list[str]:
    try:
        return history.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []


def line_attests_candidate(line: str, basename: str, digest: str) -> bool:
    # History schemas changed across v5 releases. Match only strong, portable
    # evidence: exact basename/path component or exact file SHA-256.
    try:
        obj = json.loads(line)
        strings = list(iter_json_strings(obj))
    except Exception:
        strings = [line]
    for raw in strings:
        s = str(raw)
        if s == digest:
            return True
        normalized = s.replace("\\", "/")
        if normalized == basename or normalized.endswith("/" + basename):
            return True
    return False


def prehistory_attests(lines: list[str], basename: str, digest: str) -> bool:
    return any(line_attests_candidate(line, basename, digest) for line in lines)


def parse_last_run_executed(reports_dir: Path) -> set[str]:
    out: set[str] = set()
    js = reports_dir / "last_run.json"
    if js.is_file():
        try:
            data = json.loads(js.read_text(encoding="utf-8", errors="replace"))
            def walk(value: Any, key_hint: str = "") -> None:
                kh = key_hint.lower()
                if isinstance(value, dict):
                    status = str(value.get("status", value.get("result", ""))).upper()
                    category = str(value.get("category", "")).lower()
                    looks_executed = (
                        "execut" in kh or status in {"PASS", "FAIL"} or category in {"executed", "pass", "fail"}
                    ) and "skip" not in kh and "not_execut" not in kh
                    if looks_executed:
                        for k in ("file", "filename", "name", "package", "path", "source"):
                            v = value.get(k)
                            if isinstance(v, str) and v:
                                out.add(Path(v).name)
                    for k, v in value.items():
                        walk(v, str(k))
                elif isinstance(value, list):
                    if "execut" in kh and "not_execut" not in kh and "skip" not in kh:
                        for item in value:
                            if isinstance(item, str):
                                out.add(Path(item).name)
                    for item in value:
                        walk(item, key_hint)
            walk(data)
        except Exception:
            pass

    md = reports_dir / "LAST_RUN.md"
    if md.is_file():
        try:
            text = md.read_text(encoding="utf-8", errors="replace")
            in_exec = False
            for line in text.splitlines():
                upper = line.upper()
                if "PATCHES EXECUTED" in upper:
                    in_exec = True
                    continue
                if in_exec and ("PATCHES SKIPPED" in upper or "SKIPPED / NOT EXECUTED" in upper):
                    in_exec = False
                if in_exec:
                    for token in line.replace("`", " ").split():
                        token = token.strip("[]():,;'")
                        low = token.lower()
                        if low.startswith("patch") and any(low.endswith(s) for s in CANDIDATE_SUFFIXES):
                            out.add(Path(token).name)
        except OSError:
            pass
    return out


def newly_patched_names(patched_dir: Path, before: dict[str, str], queue_before: dict[str, str]) -> set[str]:
    out: set[str] = set()
    if not patched_dir.is_dir():
        return out
    before_pairs = set(before.items())
    for p in patched_dir.rglob("*"):
        if not p.is_file():
            continue
        try:
            dg = sha256_file(p)
        except OSError:
            continue
        pair = (p.name, dg)
        if pair in before_pairs:
            continue
        for name, qdg in queue_before.items():
            if dg == qdg:
                out.add(name)
    return out


def snapshot_tree_hashes(root: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if root.is_dir():
        for p in root.rglob("*"):
            if p.is_file():
                try:
                    out[str(p.relative_to(root))] = sha256_file(p)
                except OSError:
                    pass
    return out


def find_matching_in_ignored(ignored_dup: Path, basename: str, digest: str) -> Path | None:
    if not ignored_dup.is_dir():
        return None
    exact = ignored_dup / basename
    candidates = [exact] if exact.is_file() else []
    candidates += [p for p in ignored_dup.rglob(basename) if p.is_file() and p != exact]
    for p in candidates:
        try:
            if sha256_file(p) == digest:
                return p
        except OSError:
            continue
    return None


def append_audit(reports_dir: Path, event: dict[str, Any]) -> None:
    reports_dir.mkdir(parents=True, exist_ok=True)
    event = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "guard_version": GUARD_VERSION, **event}
    with (reports_dir / AUDIT_NAME).open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(event, sort_keys=True, ensure_ascii=False) + "\n")


def remove_new_false_history(history: Path, pre_lines: list[str], basename: str, digest: str) -> int:
    post = history_lines(history)
    prefix_len = len(pre_lines)
    # Preserve all pre-existing history. Only remove newly appended lines that
    # strongly identify the restored unexecuted package.
    kept = list(pre_lines)
    removed = 0
    for line in post[prefix_len:]:
        if line_attests_candidate(line, basename, digest):
            removed += 1
        else:
            kept.append(line)
    if removed:
        tmp = history.with_suffix(history.suffix + ".ptv5151.tmp")
        tmp.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_text(("\n".join(kept) + ("\n" if kept else "")), encoding="utf-8")
        os.replace(tmp, history)
    return removed


def restore_known_false_duplicate(project_root: Path, basename: str) -> bool:
    patch_dir = project_root / "patchs"
    ignored = patch_dir / "ignored" / "duplicate_success"
    dst = patch_dir / basename
    if dst.exists():
        return False
    matches = [p for p in ignored.rglob(basename) if p.is_file()] if ignored.is_dir() else []
    if not matches:
        return False
    src = max(matches, key=lambda p: p.stat().st_mtime_ns)
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(src), str(dst))
    reports = patch_dir / "reports"
    append_audit(reports, {"event": "installer_recovery", "package": basename, "from": str(src.relative_to(project_root))})
    return True


def run_guarded(project_root: Path, runner: Path, core_args: list[str]) -> int:
    print("Python Patch Tool v5.15.1 selection-integrity layer active (v5.15.0 core compatibility).")
    patch_dir = project_root / "patchs"
    reports = patch_dir / "reports"

    recovered_at_start = []
    for incident_name in sorted(KNOWN_FALSE_INCIDENTS):
        if restore_known_false_duplicate(project_root, incident_name):
            recovered_at_start.append(incident_name)
    if recovered_at_start:
        reports.mkdir(parents=True, exist_ok=True)
        (reports / MARKER_NAME).write_text("\n".join(recovered_at_start) + "\n", encoding="utf-8")
        print("[PTV v5.15.1] Recovered known unexecuted package(s) from false duplicate_success quarantine:")
        for incident_name in recovered_at_start:
            print(f"  - patchs/{incident_name}")
    history = reports / ".patch_tool_local_history" / "successful.jsonl"
    ignored_dup = patch_dir / "ignored" / "duplicate_success"
    patched_dir = patch_dir / "patched"
    marker = reports / MARKER_NAME

    queue_before = queue_snapshot(patch_dir)
    pre_history = history_lines(history)
    pre_patched = snapshot_tree_hashes(patched_dir)
    pre_ignored = snapshot_tree_hashes(ignored_dup)

    args = list(core_args)
    force_once = marker.exists()
    if force_once:
        try:
            marker.unlink()
        except OSError:
            pass
        if "--force-repeat" not in args:
            args.append("--force-repeat")
        if not args and "--select" not in args:
            args.append("--select")
        elif args == ["--force-repeat"]:
            args.append("--select")
        print("[PTV v5.15.1 guard] Recovered unexecuted queue item detected; duplicate suppression is bypassed for this selection only.")

    completed = subprocess.run([sys.executable, str(runner), *args], cwd=str(project_root), env={**os.environ, "PYTHONPATH": str(runner.parent) + (os.pathsep + os.environ["PYTHONPATH"] if os.environ.get("PYTHONPATH") else "")})

    executed = parse_last_run_executed(reports)
    executed |= newly_patched_names(patched_dir, pre_patched, queue_before)

    restored: list[str] = []
    history_removed = 0
    for basename, digest in queue_before.items():
        if basename in executed:
            continue
        if (patch_dir / basename).exists():
            continue
        moved = find_matching_in_ignored(ignored_dup, basename, digest)
        if moved is None:
            continue
        rel = str(moved.relative_to(ignored_dup))
        prev = pre_ignored.get(rel)
        # Only undo a duplicate_success move that happened during this run.
        if prev == digest:
            continue
        # If this exact package was already positively attested before the run,
        # the duplicate classification is legitimate and must remain ignored.
        if prehistory_attests(pre_history, basename, digest):
            continue
        dst = patch_dir / basename
        if dst.exists():
            continue
        shutil.move(str(moved), str(dst))
        restored.append(basename)
        history_removed += remove_new_false_history(history, pre_history, basename, digest)
        append_audit(reports, {
            "event": "restored_unexecuted_duplicate_success",
            "package": basename,
            "sha256": digest,
            "core_returncode": completed.returncode,
        })

    if restored:
        reports.mkdir(parents=True, exist_ok=True)
        marker.write_text("\n".join(restored) + "\n", encoding="utf-8")
        print("\n[PTV v5.15.1 SELECTION-INTEGRITY FIX]")
        for name in restored:
            print(f"RESTORED UNEXECUTED PATCH: patchs/{name}")
        if history_removed:
            print(f"Removed {history_removed} newly-created false success-history record(s).")
        print("These packages were NOT executed and remain runnable on the next selection.")

    return int(completed.returncode)


def main() -> int:
    ap = argparse.ArgumentParser(description="Patch Tool v5.15.1 selection-integrity guard")
    ap.add_argument("--project-root", required=True)
    ap.add_argument("--runner", required=True)
    ap.add_argument("core_args", nargs=argparse.REMAINDER)
    ns = ap.parse_args()
    root = Path(ns.project_root).resolve()
    runner = Path(ns.runner).resolve()
    args = list(ns.core_args)
    if args and args[0] == "--":
        args = args[1:]
    return run_guarded(root, runner, args)


if __name__ == "__main__":
    raise SystemExit(main())
