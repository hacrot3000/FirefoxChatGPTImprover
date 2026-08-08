#!/usr/bin/env python3
from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import time
import zipfile
from typing import Any, Iterable

try:
    import fcntl
except Exception:  # pragma: no cover
    fcntl = None

GUARD_VERSION = "5.15.13"
AUDIT_NAME = "runtime_integrity_guard.jsonl"
SANDBOX_STATE_NAME = "sandbox_performance.json"
RUN_LOCK_NAME = "run.lock"
ACTIVE_RUN_NAME = "active_run.json"
INVOCATION_JOURNAL_NAME = "guard_invocation.json"
LAST_INVOCATION_NAME = "guard_last_invocation.json"
CANDIDATE_SUFFIXES = (".zip", ".py", ".tar.gz", ".tgz")
KNOWN_FALSE_INCIDENTS: set[str] = set()
DEFAULT_SLOW_SECONDS = 60.0
DEFAULT_REPROBE_SKIPS = 5
DEFAULT_REPROBE_HOURS = 24.0
DEFAULT_LOCK_WAIT_SECONDS = 1.0
DEFAULT_SCOPED_MAX_FILES = 12
SCOPED_TX_DIR_NAME = "scoped_file_transactions"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def same_file_identity(path: Path, identity: dict[str, Any]) -> bool:
    try:
        st = path.stat()
    except OSError:
        return False
    return int(st.st_dev) == int(identity.get("dev", -1)) and int(st.st_ino) == int(identity.get("ino", -2))


def is_candidate(path: Path) -> bool:
    if not path.is_file():
        return False
    name = path.name.lower()
    return name.startswith("patch") and any(name.endswith(s) for s in CANDIDATE_SUFFIXES)


def queue_snapshot(patch_dir: Path) -> dict[str, dict[str, Any]]:
    """Capture only queue candidates. No historical patched/quarantine tree scan happens here."""
    result: dict[str, dict[str, Any]] = {}
    if not patch_dir.is_dir():
        return result
    for p in patch_dir.iterdir():
        if not is_candidate(p):
            continue
        try:
            st = p.stat()
            result[p.name] = {
                "sha256": sha256_file(p),
                "size": int(st.st_size),
                "dev": int(st.st_dev),
                "ino": int(st.st_ino),
                "mtime_ns": int(st.st_mtime_ns),
                "ctime_ns": int(st.st_ctime_ns),
            }
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


def history_bytes(history: Path) -> bytes:
    try:
        return history.read_bytes()
    except OSError:
        return b""


def history_lines_from_bytes(raw: bytes) -> list[str]:
    return raw.decode("utf-8", errors="replace").splitlines()


def line_attests_candidate(line: str, basename: str, digest: str) -> bool:
    """Loose match used only for removing new false records created in this invocation."""
    try:
        obj = json.loads(line)
        strings = list(iter_json_strings(obj))
    except Exception:
        strings = [line]
    for raw in strings:
        value = str(raw)
        if value == digest:
            return True
        normalized = value.replace("\\", "/")
        if normalized == basename or normalized.endswith("/" + basename):
            return True
    return False


def line_attests_digest(line: str, digest: str) -> bool:
    """Strong content identity. Basename-only history is intentionally not sufficient."""
    try:
        obj = json.loads(line)
        strings = list(iter_json_strings(obj))
    except Exception:
        strings = [line]
    wanted = digest.lower()
    return any(str(raw).strip().lower() == wanted for raw in strings)


def line_attests_basename(line: str, basename: str) -> bool:
    try:
        obj = json.loads(line)
        strings = list(iter_json_strings(obj))
    except Exception:
        strings = [line]
    for raw in strings:
        normalized = str(raw).replace("\\", "/")
        if normalized == basename or normalized.endswith("/" + basename):
            return True
    return False


def prehistory_attests_content(lines: list[str], digest: str) -> bool:
    return any(line_attests_digest(line, digest) for line in lines)


def prehistory_attests_name_only(lines: list[str], basename: str, digest: str) -> bool:
    return any(line_attests_basename(line, basename) and not line_attests_digest(line, digest) for line in lines)


def file_evidence_state(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {"exists": False}
    try:
        st = path.stat()
        return {
            "exists": True,
            "sha256": sha256_file(path),
            "size": int(st.st_size),
            "mtime_ns": int(st.st_mtime_ns),
        }
    except OSError:
        return {"exists": False}


def evidence_changed(path: Path, before: dict[str, Any]) -> bool:
    after = file_evidence_state(path)
    if not before.get("exists") and not after.get("exists"):
        return False
    return after != before


def _add_executed_item(out: set[str], item: Any) -> None:
    if isinstance(item, str):
        name = Path(item).name
        low = name.lower()
        if low.startswith("patch") and any(low.endswith(s) for s in CANDIDATE_SUFFIXES):
            out.add(name)
        return
    if not isinstance(item, dict):
        return
    category = str(item.get("category", "")).lower()
    if "skip" in category or "not_execut" in category or category in {"user_not_selected", "user_deleted"}:
        return
    for key in ("file", "filename", "name", "package", "path", "source"):
        value = item.get(key)
        if isinstance(value, str) and value:
            name = Path(value).name
            low = name.lower()
            if low.startswith("patch") and any(low.endswith(s) for s in CANDIDATE_SUFFIXES):
                out.add(name)
            return


def parse_last_run_executed_json(path: Path) -> set[str]:
    out: set[str] = set()
    if not path.is_file():
        return out
    try:
        data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except Exception:
        return out

    def walk(value: Any, key_hint: str = "") -> None:
        kh = key_hint.lower().replace("-", "_")
        explicitly_executed = (
            ("executed" in kh or kh in {"run", "runs", "patches_run"})
            and "not_execut" not in kh and "skip" not in kh
        )
        if isinstance(value, list):
            if explicitly_executed:
                for item in value:
                    _add_executed_item(out, item)
            for item in value:
                walk(item, key_hint)
        elif isinstance(value, dict):
            for key, child in value.items():
                walk(child, str(key))

    walk(data)
    return out


def parse_last_run_executed_md(path: Path) -> set[str]:
    out: set[str] = set()
    if not path.is_file():
        return out
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return out
    in_exec = False
    for line in text.splitlines():
        upper = line.upper()
        if "PATCHES EXECUTED" in upper:
            in_exec = True
            continue
        if in_exec and ("PATCHES SKIPPED" in upper or "SKIPPED / NOT EXECUTED" in upper):
            in_exec = False
        if not in_exec:
            continue
        for token in line.replace("`", " ").split():
            token = token.strip("[]():,;'\"")
            low = token.lower()
            if low.startswith("patch") and any(low.endswith(s) for s in CANDIDATE_SUFFIXES):
                out.add(Path(token).name)
    return out


def parse_current_run_executed(
    reports_dir: Path,
    pre_evidence: dict[str, dict[str, Any]],
) -> tuple[set[str], list[str]]:
    """Only trust last-run artifacts that changed during this guarded invocation."""
    out: set[str] = set()
    sources: list[str] = []
    js = reports_dir / "last_run.json"
    md = reports_dir / "LAST_RUN.md"
    if evidence_changed(js, pre_evidence.get("last_run.json", {"exists": False})):
        out |= parse_last_run_executed_json(js)
        sources.append("last_run.json")
    if evidence_changed(md, pre_evidence.get("LAST_RUN.md", {"exists": False})):
        out |= parse_last_run_executed_md(md)
        sources.append("LAST_RUN.md")
    return out, sources




def _candidate_name_from_item(item: Any) -> str | None:
    if isinstance(item, str):
        name = Path(item).name
        low = name.lower()
        if low.startswith("patch") and any(low.endswith(s) for s in CANDIDATE_SUFFIXES):
            return name
        return None
    if not isinstance(item, dict):
        return None
    for key in ("file", "filename", "name", "package", "path", "source"):
        value = item.get(key)
        if isinstance(value, str) and value:
            name = Path(value).name
            low = name.lower()
            if low.startswith("patch") and any(low.endswith(s) for s in CANDIDATE_SUFFIXES):
                return name
    return None


def _status_from_text(value: Any) -> str | None:
    if value is None:
        return None
    raw = str(value).strip().upper()
    if not raw:
        return None
    normalized = "".join(ch if ch.isalnum() else "_" for ch in raw)
    parts = {part for part in normalized.split("_") if part}
    joined = "_".join(normalized.split("_"))
    if any(part.startswith("FAIL") for part in parts) or parts & {"ERROR", "EXCEPTION"}:
        return "FAIL"
    if (
        any(part.startswith("SKIP") for part in parts)
        or "NOT_EXECUT" in joined
        or "USER_NOT_SELECTED" in joined
        or "DUPLICATE_SUCCESS" in joined
    ):
        return "SKIPPED"
    if parts & {"PASS", "PASSED", "SUCCESS", "SUCCESSFUL", "SUCCEEDED", "OK"}:
        return "PASS"
    return None


def _item_outcome(item: Any, *, context: str = "") -> tuple[str | None, str | None]:
    name = _candidate_name_from_item(item)
    if name is None:
        return None, None
    if isinstance(item, dict):
        for key in ("status", "result", "outcome", "state", "category"):
            status = _status_from_text(item.get(key))
            if status:
                return name, status
    ctx = context.lower().replace("-", "_")
    if "skip" in ctx or "not_execut" in ctx:
        return name, "SKIPPED"
    if "executed" in ctx or ctx in {"run", "runs", "patches_run"}:
        return name, "EXECUTED_UNKNOWN"
    return name, None


def parse_last_run_outcomes_json(path: Path) -> tuple[dict[str, set[str]], str | None]:
    outcomes: dict[str, set[str]] = {}
    if not path.is_file():
        return outcomes, None
    try:
        data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except Exception:
        return outcomes, None

    overall: str | None = None
    if isinstance(data, dict):
        for key in ("status", "result", "outcome"):
            overall = _status_from_text(data.get(key)) or overall

    def add(name: str | None, status: str | None) -> None:
        if name and status:
            outcomes.setdefault(name, set()).add(status)

    def walk(value: Any, key_hint: str = "") -> None:
        kh = key_hint.lower().replace("-", "_")
        relevant_list = (
            "executed" in kh or "skip" in kh or "not_execut" in kh
            or kh in {"run", "runs", "patches_run", "patches_executed"}
        )
        if isinstance(value, list):
            if relevant_list:
                for item in value:
                    add(*_item_outcome(item, context=key_hint))
            for item in value:
                if isinstance(item, (dict, list)):
                    walk(item, key_hint)
        elif isinstance(value, dict):
            # Some formats put package dictionaries directly below a result collection.
            name, status = _item_outcome(value, context=key_hint)
            if relevant_list:
                add(name, status)
            for key, child in value.items():
                walk(child, str(key))

    walk(data)
    return outcomes, overall


def parse_last_run_outcomes_md(path: Path) -> tuple[dict[str, set[str]], str | None]:
    outcomes: dict[str, set[str]] = {}
    if not path.is_file():
        return outcomes, None
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return outcomes, None
    overall: str | None = None
    section: str | None = None
    for line in text.splitlines():
        upper = line.upper()
        if upper.strip().startswith("STATUS:"):
            overall = _status_from_text(upper.split(":", 1)[1]) or overall
        if "PATCHES EXECUTED" in upper:
            section = "executed"
            continue
        if "PATCHES SKIPPED" in upper or "SKIPPED / NOT EXECUTED" in upper:
            section = "skipped"
            continue
        names: list[str] = []
        for token in line.replace("`", " ").split():
            token = token.strip("[]():,;'\"")
            low = token.lower()
            if low.startswith("patch") and any(low.endswith(s) for s in CANDIDATE_SUFFIXES):
                names.append(Path(token).name)
        if not names or section is None:
            continue
        line_status = _status_from_text(upper)
        if section == "skipped":
            line_status = "SKIPPED"
        elif line_status is None:
            line_status = "EXECUTED_UNKNOWN"
        for name in names:
            outcomes.setdefault(name, set()).add(line_status)
    return outcomes, overall


def parse_current_run_outcomes(
    reports_dir: Path,
    pre_evidence: dict[str, dict[str, Any]],
) -> tuple[dict[str, set[str]], list[str], str | None]:
    combined: dict[str, set[str]] = {}
    sources: list[str] = []
    overall_statuses: set[str] = set()

    def merge(part: dict[str, set[str]], overall: str | None) -> None:
        for name, statuses in part.items():
            combined.setdefault(name, set()).update(statuses)
        if overall:
            overall_statuses.add(overall)

    js = reports_dir / "last_run.json"
    md = reports_dir / "LAST_RUN.md"
    if evidence_changed(js, pre_evidence.get("last_run.json", {"exists": False})):
        part, overall = parse_last_run_outcomes_json(js)
        merge(part, overall)
        sources.append("last_run.json")
    if evidence_changed(md, pre_evidence.get("LAST_RUN.md", {"exists": False})):
        part, overall = parse_last_run_outcomes_md(md)
        merge(part, overall)
        sources.append("LAST_RUN.md")

    overall: str | None = None
    if "FAIL" in overall_statuses:
        overall = "FAIL"
    elif "PASS" in overall_statuses and len(overall_statuses) == 1:
        overall = "PASS"
    elif overall_statuses:
        overall = "CONFLICT"

    # Older last-run formats may list executed packages but omit per-package PASS.
    # A clean overall PASS is sufficient to promote EXECUTED_UNKNOWN to PASS.
    if overall == "PASS":
        for statuses in combined.values():
            if "EXECUTED_UNKNOWN" in statuses and not ({"FAIL", "SKIPPED"} & statuses):
                statuses.add("PASS")
    return combined, sources, overall


def classify_current_outcomes(outcomes: dict[str, set[str]]) -> tuple[set[str], set[str], set[str], set[str]]:
    executed: set[str] = set()
    passed: set[str] = set()
    failed: set[str] = set()
    ambiguous: set[str] = set()
    for name, statuses in outcomes.items():
        if statuses & {"PASS", "FAIL", "EXECUTED_UNKNOWN"}:
            executed.add(name)
        if "FAIL" in statuses:
            failed.add(name)
            continue
        if "PASS" in statuses and "SKIPPED" not in statuses:
            passed.add(name)
        elif statuses & {"EXECUTED_UNKNOWN", "SKIPPED"}:
            ambiguous.add(name)
    return executed, passed, failed, ambiguous

def candidate_is_current_move(
    path: Path,
    identity: dict[str, Any],
    run_start_wall_ns: int,
    run_end_wall_ns: int | None = None,
) -> bool:
    """Prove a discovered quarantine/patched file came from the intended invocation.

    Same-filesystem moves preserve inode, but the ctime window is still checked when a
    completed-run upper bound is available. This prevents a later manual/core run from
    being mistaken for the interrupted guarded invocation during crash recovery.
    """
    try:
        st = path.stat()
    except OSError:
        return False

    tolerance_ns = 2_000_000_000
    ctime_ns = int(st.st_ctime_ns)
    same_identity = (
        int(st.st_dev) == int(identity.get("dev", -1))
        and int(st.st_ino) == int(identity.get("ino", -2))
    )
    if same_identity:
        if run_end_wall_ns is not None and ctime_ns > int(run_end_wall_ns) + tolerance_ns:
            return False
        return True

    if ctime_ns + tolerance_ns < int(run_start_wall_ns):
        return False
    if run_end_wall_ns is not None and ctime_ns > int(run_end_wall_ns) + tolerance_ns:
        return False
    return True


def find_current_moved_candidate(
    root: Path,
    basename: str,
    identity: dict[str, Any],
    run_start_wall_ns: int,
    run_end_wall_ns: int | None = None,
) -> Path | None:
    """Lazy lookup used only when a queue package disappeared after this run."""
    if not root.is_dir():
        return None
    digest = str(identity.get("sha256") or "")
    if not digest:
        return None

    exact = root / basename
    if exact.is_file():
        try:
            if same_file_identity(exact, identity) and candidate_is_current_move(
                exact, identity, run_start_wall_ns, run_end_wall_ns
            ):
                return exact
            if (
                sha256_file(exact) == digest
                and candidate_is_current_move(exact, identity, run_start_wall_ns, run_end_wall_ns)
            ):
                return exact
        except OSError:
            pass

    for candidate in root.rglob(basename):
        if not candidate.is_file() or candidate == exact:
            continue
        try:
            if same_file_identity(candidate, identity) and candidate_is_current_move(
                candidate, identity, run_start_wall_ns, run_end_wall_ns
            ):
                return candidate
            if (
                sha256_file(candidate) == digest
                and candidate_is_current_move(candidate, identity, run_start_wall_ns, run_end_wall_ns)
            ):
                return candidate
        except OSError:
            continue

    for candidate in root.rglob("*"):
        if not candidate.is_file():
            continue
        try:
            if candidate.stat().st_size != int(identity.get("size", -1)):
                continue
            if not candidate_is_current_move(candidate, identity, run_start_wall_ns, run_end_wall_ns):
                continue
            if sha256_file(candidate) == digest:
                return candidate
        except OSError:
            continue
    return None


def write_invocation_journal(

    path: Path,
    *,
    queue_before: dict[str, dict[str, Any]],
    core_args: list[str],
    run_start_wall_ns: int,
    pre_evidence: dict[str, dict[str, Any]],
    pre_history_raw: bytes,
) -> None:
    save_json_atomic(
        path,
        {
            "schema": 1,
            "guard_version": GUARD_VERSION,
            "pid": os.getpid(),
            "started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "run_start_wall_ns": int(run_start_wall_ns),
            "queue_before": queue_before,
            "core_args": list(core_args),
            "pre_evidence": pre_evidence,
            "pre_history_size": len(pre_history_raw),
            "pre_history_sha256": sha256_bytes(pre_history_raw),
            "state": "running",
        },
    )

def record_core_completion_checkpoint(
    journal_path: Path,
    reports: Path,
    history: Path,
    core_returncode: int,
) -> None:
    """Persist a run-bound post-core checkpoint before any guard cleanup.

    Crash recovery may only mutate queue/history when this checkpoint exists and the
    current LAST_RUN files still match the exact states captured here.  This prevents a
    later unguarded/core run from being mistaken for the interrupted guarded invocation.
    """
    journal = load_json(journal_path)
    post_evidence = {
        "last_run.json": file_evidence_state(reports / "last_run.json"),
        "LAST_RUN.md": file_evidence_state(reports / "LAST_RUN.md"),
    }
    post_history = history_bytes(history)
    journal.update({
        "state": "core_completed",
        "core_returncode": int(core_returncode),
        "core_completed_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "core_completed_wall_ns": int(time.time_ns()),
        "post_evidence": post_evidence,
        "post_history_size": len(post_history),
        "post_history_sha256": sha256_bytes(post_history),
    })
    save_json_atomic(journal_path, journal)


def checkpoint_evidence_matches(stale: dict[str, Any], reports: Path) -> bool:
    expected = stale.get("post_evidence")
    if not isinstance(expected, dict) or not expected:
        return False
    for name in ("last_run.json", "LAST_RUN.md"):
        wanted = expected.get(name)
        if not isinstance(wanted, dict):
            return False
        if file_evidence_state(reports / name) != wanted:
            return False
    return True


def rewrite_checkpoint_history_segment_without_false(
    history: Path,
    *,
    pre_size: int,
    pre_hash: str,
    post_size: int,
    post_hash: str,
    false_candidates: list[tuple[str, str]],
    protected_pass_digests: set[str] | None = None,
) -> tuple[int, bool]:
    """Clean only the success-history bytes produced by one checkpointed core run.

    Bytes appended by later invocations are preserved.  Both the pre-run prefix and the
    complete post-core prefix must match the hashes captured by the journal.
    """
    try:
        current = history.read_bytes()
    except OSError:
        current = b""
    if pre_size < 0 or post_size < pre_size or post_size > len(current):
        return 0, False
    if sha256_bytes(current[:pre_size]) != pre_hash:
        return 0, False
    if sha256_bytes(current[:post_size]) != post_hash:
        return 0, False

    protected = {d.lower() for d in (protected_pass_digests or set()) if d}
    segment = current[pre_size:post_size].decode("utf-8", errors="replace")
    kept: list[str] = []
    removed = 0
    for line in segment.splitlines():
        remove = False
        for basename, digest in false_candidates:
            if line_attests_basename(line, basename):
                remove = True
                break
            if digest and digest.lower() not in protected and line_attests_digest(line, digest):
                remove = True
                break
        if remove:
            removed += 1
        else:
            kept.append(line)
    if not removed:
        return 0, True
    cleaned = ("\n".join(kept) + ("\n" if kept else "")).encode("utf-8")
    rewritten = current[:pre_size] + cleaned + current[post_size:]
    tmp = history.with_suffix(history.suffix + ".ptv5158.tmp")
    tmp.parent.mkdir(parents=True, exist_ok=True)
    tmp.write_bytes(rewritten)
    os.replace(tmp, history)
    return removed, True


def recover_stale_invocation_journal(path: Path, reports: Path, project_root: Path) -> None:
    """Recover only a checkpointed interrupted invocation with exact evidence.

    v5.15.13 requires a post-core checkpoint written immediately after ``proc.wait()``.
    Without it, or if LAST_RUN has changed since that checkpoint, the interrupted run is
    ambiguous and no package/history is automatically mutated.
    """
    if not path.is_file():
        return
    stale = load_json(path)
    if not stale:
        try:
            path.unlink()
        except OSError:
            pass
        return

    queue_before = stale.get("queue_before") if isinstance(stale.get("queue_before"), dict) else {}
    pre_evidence = stale.get("pre_evidence") if isinstance(stale.get("pre_evidence"), dict) else {}
    checkpointed = stale.get("state") == "core_completed" and checkpoint_evidence_matches(stale, reports)

    outcomes: dict[str, set[str]] = {}
    sources: list[str] = []
    overall: str | None = None
    executed: set[str] = set()
    passed: set[str] = set()
    failed: set[str] = set()
    ambiguous: set[str] = set()
    if checkpointed:
        outcomes, sources, overall = parse_current_run_outcomes(reports, pre_evidence)
        executed, passed, failed, ambiguous = classify_current_outcomes(outcomes)
    evidence_available = checkpointed and bool(sources)
    restored: list[str] = []
    restored_failed: list[str] = []
    history_removed = 0
    history_cleanup_ok = True

    if evidence_available and queue_before:
        patch_dir = project_root / "patchs"
        ignored_dup = patch_dir / "ignored" / "duplicate_success"
        patched_dir = patch_dir / "patched"
        run_start_wall_ns = int(stale.get("run_start_wall_ns", 0) or 0)
        run_end_wall_ns = int(stale.get("core_completed_wall_ns", 0) or 0) or None
        if run_start_wall_ns <= 0:
            run_start_wall_ns = int(time.time_ns())

        stale_skipped = {
            name for name, statuses in outcomes.items()
            if "SKIPPED" in statuses and not ({"PASS", "FAIL", "EXECUTED_UNKNOWN"} & statuses)
        }
        stale_failed = set(failed)
        for basename, identity_any in queue_before.items():
            if not isinstance(identity_any, dict):
                continue
            identity = identity_any
            # Absence from PATCHES EXECUTED is not proof after a crash. Restore only:
            #   1) packages explicitly recorded SKIPPED / NOT EXECUTED, or
            #   2) packages explicitly recorded EXECUTED + FAIL.
            # The v5.15 contract requires selected FAIL packages to remain available in
            # patchs/ for replacement or rerun. EXECUTED_UNKNOWN remains fail-safe.
            is_failed = basename in stale_failed
            if (basename not in stale_skipped and not is_failed) or (patch_dir / basename).exists():
                continue
            moved = find_current_moved_candidate(
                ignored_dup, basename, identity, run_start_wall_ns, run_end_wall_ns
            )
            if moved is None:
                moved = find_current_moved_candidate(
                    patched_dir, basename, identity, run_start_wall_ns, run_end_wall_ns
                )
            if moved is None:
                continue
            dst = patch_dir / basename
            if dst.exists():
                continue
            shutil.move(str(moved), str(dst))
            restored.append(basename)
            if is_failed:
                restored_failed.append(basename)

        history = reports / ".patch_tool_local_history" / "successful.jsonl"
        try:
            pre_size = int(stale.get("pre_history_size", -1))
            post_size = int(stale.get("post_history_size", -1))
        except Exception:
            pre_size = post_size = -1
        pre_hash = str(stale.get("pre_history_sha256") or "")
        post_hash = str(stale.get("post_history_sha256") or "")
        false_candidates: list[tuple[str, str]] = []
        protected_pass_digests: set[str] = set()
        for passed_name in passed:
            identity = queue_before.get(passed_name)
            if isinstance(identity, dict) and identity.get("sha256"):
                protected_pass_digests.add(str(identity["sha256"]))
        for basename, identity_any in queue_before.items():
            if not isinstance(identity_any, dict):
                continue
            statuses = outcomes.get(basename, set())
            if basename in passed or not (statuses & {"SKIPPED", "FAIL"}):
                continue
            false_candidates.append((basename, str(identity_any.get("sha256") or "")))
        if false_candidates and pre_hash and post_hash:
            history_removed, history_cleanup_ok = rewrite_checkpoint_history_segment_without_false(
                history,
                pre_size=pre_size,
                pre_hash=pre_hash,
                post_size=post_size,
                post_hash=post_hash,
                false_candidates=false_candidates,
                protected_pass_digests=protected_pass_digests,
            )

    append_audit(
        reports,
        {
            "event": "stale_invocation_journal_detected",
            "previous_pid": stale.get("pid"),
            "previous_started_at": stale.get("started_at"),
            "previous_state": stale.get("state"),
            "checkpoint_verified": bool(checkpointed),
            "queue_before": sorted(queue_before.keys()),
            "execution_sources": sources,
            "executed": sorted(executed),
            "passed": sorted(passed),
            "failed": sorted(failed),
            "ambiguous": sorted(ambiguous),
            "overall_run_status": overall,
            "restored_proven_unexecuted_or_failed": restored,
            "restored_executed_failed": restored_failed if evidence_available else [],
            "history_records_removed": history_removed,
            "history_cleanup_verified": bool(history_cleanup_ok),
        },
    )
    if restored:
        print("[PTV v5.15.13 CRASH-RECOVERY] Restored package(s) that must remain runnable:")
        for name in restored:
            kind = "EXECUTED+FAIL" if name in (restored_failed if evidence_available else []) else "NOT EXECUTED"
            print(f"  - patchs/{name}  [{kind}]")
    elif not checkpointed:
        print(
            "[PTV v5.15.13 WARNING] Previous invocation has no trustworthy post-core checkpoint, "
            "or LAST_RUN changed after that checkpoint. No ambiguous package/history is auto-repaired."
        )
    elif not evidence_available:
        print(
            "[PTV v5.15.13 WARNING] Checkpoint exists but contains no trustworthy changed LAST_RUN evidence. "
            "No ambiguous package is auto-rerun."
        )
    else:
        print(
            "[PTV v5.15.13] Reconciled a checkpointed stale invocation; "
            "no additional proven-unexecuted package required restoration."
        )
    if not history_cleanup_ok:
        print(
            "[PTV v5.15.13 WARNING] Success history no longer matches the checkpointed pre/post segment; "
            "history cleanup was skipped to preserve later activity."
        )

    last_path = path.with_name(LAST_INVOCATION_NAME)
    stale.update({
        "state": "recovered_after_checkpointed_interruption" if evidence_available else "ambiguous_interrupted",
        "recovered_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "checkpoint_verified": bool(checkpointed),
        "execution_sources": sources,
        "executed": sorted(executed),
        "passed": sorted(passed),
        "failed": sorted(failed),
        "ambiguous": sorted(ambiguous),
        "restored_proven_unexecuted_or_failed": restored,
        "restored_executed_failed": restored_failed if evidence_available else [],
        "history_records_removed": history_removed,
        "history_cleanup_verified": bool(history_cleanup_ok),
    })
    save_json_atomic(last_path, stale)
    try:
        path.unlink()
    except OSError:
        pass


def append_audit(reports_dir: Path, event: dict[str, Any]) -> None:
    reports_dir.mkdir(parents=True, exist_ok=True)
    event = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "guard_version": GUARD_VERSION, **event}
    with (reports_dir / AUDIT_NAME).open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(event, sort_keys=True, ensure_ascii=False) + "\n")


def rewrite_history_without_new_false(
    history: Path,
    pre_raw: bytes,
    false_candidates: list[tuple[str, str]],
    *,
    protected_pass_digests: set[str] | None = None,
) -> tuple[int, bool]:
    """Remove only success lines newly created for non-PASS packages.

    Basename/path evidence is package-specific and can always identify a false record.
    Digest-only evidence is removed only when that digest is not also owned by a package
    that has current-run EXECUTED+PASS evidence. This prevents an unselected duplicate
    payload from deleting the legitimate PASS record of the package that actually ran.
    """
    protected = {d.lower() for d in (protected_pass_digests or set()) if d}
    try:
        post_raw = history.read_bytes()
    except OSError:
        return 0, True
    if not post_raw.startswith(pre_raw):
        return 0, False
    appended = post_raw[len(pre_raw):]
    text = appended.decode("utf-8", errors="replace")
    kept: list[str] = []
    removed = 0
    for line in text.splitlines():
        remove = False
        for basename, digest in false_candidates:
            if line_attests_basename(line, basename):
                remove = True
                break
            if digest and digest.lower() not in protected and line_attests_digest(line, digest):
                remove = True
                break
        if remove:
            removed += 1
        else:
            kept.append(line)
    if removed:
        suffix = ("\n".join(kept) + ("\n" if kept else "")).encode("utf-8")
        tmp = history.with_suffix(history.suffix + ".ptv5157.tmp")
        tmp.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_bytes(pre_raw + suffix)
        os.replace(tmp, history)
    return removed, True

def remove_exact_basename_history(history: Path, basename: str) -> int:
    """Repair a known historical false incident without global --force-repeat."""
    try:
        lines = history.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return 0
    kept: list[str] = []
    removed = 0
    for line in lines:
        try:
            obj = json.loads(line)
            strings = [str(x).replace("\\", "/") for x in iter_json_strings(obj)]
        except Exception:
            strings = [line.replace("\\", "/")]
        exact_name = any(s == basename or s.endswith("/" + basename) for s in strings)
        if exact_name:
            removed += 1
        else:
            kept.append(line)
    if removed:
        tmp = history.with_suffix(history.suffix + ".ptv5155.repair.tmp")
        tmp.write_text("\n".join(kept) + ("\n" if kept else ""), encoding="utf-8")
        os.replace(tmp, history)
    return removed


def restore_known_false_duplicate(project_root: Path, basename: str, history: Path) -> bool:
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
    removed = remove_exact_basename_history(history, basename)
    append_audit(
        patch_dir / "reports",
        {
            "event": "known_false_duplicate_recovered",
            "package": basename,
            "from": str(src.relative_to(project_root)),
            "history_records_removed": removed,
        },
    )
    return True


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_json_atomic(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def _safe_rel_target(raw: Any) -> str | None:
    if not isinstance(raw, str):
        return None
    value = raw.replace('\\', '/').strip()
    if not value or value.startswith('/') or re.match(r'^[A-Za-z]:', value):
        return None
    parts = Path(value).parts
    if '..' in parts or value.startswith('.git/') or value == '.git' or value.startswith('patchs/'):
        return None
    return Path(value).as_posix()


def _ops_target_files(value: Any, out: set[str]) -> bool:
    """Conservatively collect every literal operation target; False means unknown/unsafe."""
    if isinstance(value, list):
        return all(_ops_target_files(x, out) for x in value)
    if not isinstance(value, dict):
        return True
    if 'file' in value:
        rel = _safe_rel_target(value.get('file'))
        if rel is None:
            return False
        out.add(rel)
    for key, child in value.items():
        if key in {'file','old','new','anchor','content','insert','pattern','replacement'}:
            continue
        if isinstance(child, (dict, list)) and not _ops_target_files(child, out):
            return False
    return True


def static_data_only_scope(package: Path) -> tuple[set[str] | None, str]:
    if not package.is_file() or package.suffix.lower() != '.zip':
        return None, 'not_v5_zip'
    try:
        with zipfile.ZipFile(package, 'r') as zf:
            names=[n for n in zf.namelist() if not n.endswith('/')]
            roots={Path(n).name: n for n in names if '/' not in n.strip('/')}
            ops_name=roots.get('PATCH_TOOL_OPS.json')
            has_py=any('/' not in n.strip('/') and Path(n).name.startswith('patch_') and n.lower().endswith('.py') for n in names)
            if not ops_name or has_py:
                return None, 'dynamic_or_missing_ops'
            raw=json.loads(zf.read(ops_name).decode('utf-8'))
    except Exception:
        return None, 'unreadable_package'
    targets:set[str]=set()
    ops=raw.get('ops') if isinstance(raw,dict) else None
    if not isinstance(ops,list) or not _ops_target_files(ops,targets):
        return None, 'unknown_ops_scope'
    if not targets:
        return set(), 'data_only_no_source_targets'
    return targets, 'data_only_exact_targets'


def _explicit_package_names(args: list[str]) -> list[str]:
    names=[]; i=0
    while i < len(args):
        arg=str(args[i])
        if arg == '--patch' and i+1 < len(args):
            names.append(Path(str(args[i+1])).name); i += 2; continue
        if arg.startswith('--patch='):
            names.append(Path(arg.split('=',1)[1]).name); i += 1; continue
        if not arg.startswith('-') and is_candidate(Path(arg)):
            names.append(Path(arg).name)
        i += 1
    return names


def infer_scoped_file_transaction(project_root: Path, args: list[str], queue_before: dict[str, dict[str, Any]]) -> dict[str, Any]:
    explicit=explicit_transaction_mode(args)
    configured=configured_transaction_mode(project_root)
    if explicit is not None or configured in {'off','required'} or readonly_core_invocation(args):
        return {'eligible':False,'reason':'transaction_policy_override'}
    cfg=load_json(project_root/'.python_patch_tool.json')
    tx=cfg.get('transaction') if isinstance(cfg.get('transaction'),dict) else {}
    scoped=tx.get('scoped_files') if isinstance(tx.get('scoped_files'),dict) else {}
    enabled=bool(scoped.get('enabled',True))
    try: max_files=max(1,int(scoped.get('max_files',DEFAULT_SCOPED_MAX_FILES)))
    except Exception: max_files=DEFAULT_SCOPED_MAX_FILES
    if os.environ.get('PTV_SCOPED_FILE_TRANSACTION','').strip().lower() in {'0','false','no','off'}:
        enabled=False
    if not enabled:
        return {'eligible':False,'reason':'disabled','max_files':max_files}
    requested=_explicit_package_names(args)
    names=requested or sorted(queue_before)
    if not names:
        return {'eligible':False,'reason':'no_queue_packages','max_files':max_files}
    targets:set[str]=set(); package_meta=[]
    for name in names:
        package=project_root/'patchs'/name
        if not package.is_file():
            return {'eligible':False,'reason':f'missing_package:{name}','max_files':max_files}
        scope,reason=static_data_only_scope(package)
        package_meta.append({'package':name,'reason':reason,'targets':sorted(scope or [])})
        if scope is None:
            return {'eligible':False,'reason':f'unknown_scope:{name}:{reason}','packages':package_meta,'max_files':max_files}
        targets.update(scope)
        if len(targets)>max_files:
            return {'eligible':False,'reason':'scope_too_large','target_count':len(targets),'packages':package_meta,'max_files':max_files}
    return {'eligible':True,'reason':'exact_data_only_scope','targets':sorted(targets),'target_count':len(targets),'packages':package_meta,'max_files':max_files,'zero_arg_union':not bool(requested)}


def _git_head(project_root: Path) -> str | None:
    try:
        p=subprocess.run(['git','rev-parse','HEAD'],cwd=str(project_root),text=True,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,check=False)
        return p.stdout.strip() if p.returncode==0 and p.stdout.strip() else None
    except Exception:
        return None


def create_scoped_snapshot(project_root: Path, local_history: Path, scope: dict[str, Any]) -> dict[str, Any]:
    base=local_history/SCOPED_TX_DIR_NAME
    base.mkdir(parents=True,exist_ok=True)
    run_id=f"{time.strftime('%Y%m%d_%H%M%S')}_{os.getpid()}_{time.time_ns()%1000000:06d}"
    snap=base/run_id; files=snap/'files'; files.mkdir(parents=True,exist_ok=True)
    entries=[]
    for rel in scope.get('targets',[]):
        src=project_root/rel
        entry={'path':rel,'existed':src.is_file(),'sha256_before':None}
        if src.is_file():
            entry['sha256_before']=sha256_file(src)
            dst=files/rel; dst.parent.mkdir(parents=True,exist_ok=True); shutil.copy2(src,dst)
        elif src.exists():
            raise RuntimeError(f'Scoped transaction target is not a regular file: {rel}')
        entries.append(entry)
    meta={'schema':1,'guard_version':GUARD_VERSION,'mode':'scoped_file_transaction','created_at':time.strftime('%Y-%m-%dT%H:%M:%S%z'),'git_head_before':_git_head(project_root),'scope':scope,'entries':entries}
    save_json_atomic(snap/'manifest.json',meta)
    return {'dir':snap,'manifest':meta}


def restore_scoped_snapshot(project_root: Path, snapshot: dict[str, Any]) -> dict[str, Any]:
    snap=Path(snapshot['dir']); meta=snapshot['manifest']; restored=[]; removed=[]; errors=[]
    for entry in meta.get('entries',[]):
        rel=entry.get('path'); dst=project_root/rel; src=snap/'files'/rel
        try:
            if entry.get('existed'):
                dst.parent.mkdir(parents=True,exist_ok=True); shutil.copy2(src,dst); restored.append(rel)
            elif dst.exists():
                if dst.is_file() or dst.is_symlink(): dst.unlink(); removed.append(rel)
                else: errors.append({'path':rel,'error':'created target became directory; not removed'})
        except Exception as exc:
            errors.append({'path':rel,'error':repr(exc)})
    return {'restored':restored,'removed_created':removed,'errors':errors}


def cleanup_scoped_snapshot(snapshot: dict[str, Any] | None) -> None:
    if not snapshot: return
    try: shutil.rmtree(Path(snapshot['dir']))
    except OSError: pass


def config_adaptive_settings(project_root: Path) -> tuple[bool, float, int, float]:
    enabled = True
    threshold = DEFAULT_SLOW_SECONDS
    reprobe_skips = DEFAULT_REPROBE_SKIPS
    reprobe_hours = DEFAULT_REPROBE_HOURS
    cfg = load_json(project_root / ".python_patch_tool.json")
    tx = cfg.get("transaction") if isinstance(cfg.get("transaction"), dict) else {}
    adaptive = tx.get("adaptive_sandbox") if isinstance(tx.get("adaptive_sandbox"), dict) else {}
    if "enabled" in adaptive:
        enabled = bool(adaptive.get("enabled"))
    try:
        threshold = float(adaptive.get("slow_threshold_seconds", threshold))
    except Exception:
        pass
    try:
        reprobe_skips = int(adaptive.get("reprobe_after_skips", reprobe_skips))
    except Exception:
        pass
    try:
        reprobe_hours = float(adaptive.get("reprobe_after_hours", reprobe_hours))
    except Exception:
        pass

    env = os.environ.get("PTV_ADAPTIVE_SANDBOX")
    if env is not None and env.strip().lower() in {"0", "false", "no", "off"}:
        enabled = False
    if os.environ.get("PTV_SANDBOX_SLOW_SECONDS"):
        try:
            threshold = float(os.environ["PTV_SANDBOX_SLOW_SECONDS"])
        except Exception:
            pass
    if os.environ.get("PTV_SANDBOX_REPROBE_SKIPS"):
        try:
            reprobe_skips = int(os.environ["PTV_SANDBOX_REPROBE_SKIPS"])
        except Exception:
            pass
    if os.environ.get("PTV_SANDBOX_REPROBE_HOURS"):
        try:
            reprobe_hours = float(os.environ["PTV_SANDBOX_REPROBE_HOURS"])
        except Exception:
            pass
    return enabled, max(0.05, threshold), max(1, reprobe_skips), max(0.01, reprobe_hours)


READONLY_CORE_COMMANDS = {"collect", "research", "inspect", "query", "overview"}


def readonly_core_invocation(args: list[str]) -> bool:
    """Return True for source-inspection commands that must never need a transaction sandbox.

    This covers legacy core collection/research verbs. New content-driven collector
    commands are dispatched directly by the launcher and do not enter the guard at all.
    """
    for arg in args:
        value = str(arg).strip()
        if not value or value.startswith("-"):
            continue
        return value.lower() in READONLY_CORE_COMMANDS
    return False


def configured_transaction_mode(project_root: Path) -> str:
    cfg = load_json(project_root / ".python_patch_tool.json")
    tx = cfg.get("transaction") if isinstance(cfg.get("transaction"), dict) else {}
    return str(tx.get("mode", "auto")).strip().lower() or "auto"


def explicit_transaction_mode(args: list[str]) -> str | None:
    for i, arg in enumerate(args):
        if arg == "--transaction" and i + 1 < len(args):
            return str(args[i + 1]).strip().lower()
        if arg.startswith("--transaction="):
            return arg.split("=", 1)[1].strip().lower()
    return None


def process_table() -> dict[int, tuple[int, str]]:
    try:
        out = subprocess.check_output(["ps", "-eo", "pid=,ppid=,args="], text=True, stderr=subprocess.DEVNULL)
    except Exception:
        return {}
    table: dict[int, tuple[int, str]] = {}
    for line in out.splitlines():
        parts = line.strip().split(None, 2)
        if len(parts) < 2:
            continue
        try:
            pid = int(parts[0])
            ppid = int(parts[1])
        except Exception:
            continue
        table[pid] = (ppid, parts[2] if len(parts) > 2 else "")
    return table


def descendant_rows(root_pid: int) -> list[tuple[int, str]]:
    table = process_table()
    children: dict[int, list[int]] = {}
    for pid, (ppid, _args) in table.items():
        children.setdefault(ppid, []).append(pid)
    out: list[tuple[int, str]] = []
    stack = list(children.get(root_pid, []))
    seen: set[int] = set()
    while stack:
        pid = stack.pop()
        if pid in seen:
            continue
        seen.add(pid)
        row = table.get(pid)
        if row:
            out.append((pid, row[1]))
        stack.extend(children.get(pid, []))
    return out


def monitor_first_git_worktree(proc: subprocess.Popen[Any], result: dict[str, Any], threshold: float) -> None:
    start: float | None = None
    last_seen: float | None = None
    observed_pids: set[int] = set()
    warned = False
    while proc.poll() is None:
        now = time.monotonic()
        found = False
        for pid, command in descendant_rows(proc.pid):
            c = command.lower()
            if "git" in c and "worktree" in c:
                found = True
                observed_pids.add(pid)
        if found:
            if start is None:
                start = now
            last_seen = now
            elapsed = now - start
            if elapsed > threshold and not warned:
                warned = True
                result["live_slow"] = True
                print("\n" + "!" * 78, flush=True)
                print("WARNING: CURRENT SANDBOX PREPARATION IS SLOW", flush=True)
                print(f"git worktree has exceeded {threshold:.1f}s in this run.", flush=True)
                print(
                    "This interactive run is not killed/restarted because doing so could lose "
                    "the patch selection you already confirmed.",
                    flush=True,
                )
                print(
                    "The metric is saved; the next transaction=auto run will skip SANDBOX automatically.",
                    flush=True,
                )
                print("!" * 78 + "\n", flush=True)
        elif start is not None and last_seen is not None and now - last_seen >= 0.10:
            result["seconds"] = max(0.0, last_seen - start)
            result["observed_pids"] = sorted(observed_pids)
            return
        time.sleep(0.05)
    if start is not None and last_seen is not None:
        result["seconds"] = max(0.0, last_seen - start)
        result["observed_pids"] = sorted(observed_pids)


def update_sandbox_state(
    state_path: Path,
    *,
    measured_seconds: float | None,
    decision: str,
    threshold: float,
    core_rc: int,
) -> None:
    state = load_json(state_path)
    now = time.time()
    state.update(
        {
            "schema": 2,
            "guard_version": GUARD_VERSION,
            "slow_threshold_seconds": threshold,
            "last_decision": decision,
            "last_core_returncode": int(core_rc),
            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        }
    )
    if measured_seconds is not None:
        state["last_prepare_seconds"] = round(float(measured_seconds), 3)
        state["last_prepare_slow"] = bool(measured_seconds > threshold)
        state["last_measured_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        state["last_probe_epoch"] = now
        state["consecutive_auto_skips"] = 0
    elif decision == "auto_skip_slow_previous":
        state["consecutive_auto_skips"] = int(state.get("consecutive_auto_skips", 0) or 0) + 1
    save_json_atomic(state_path, state)


def adaptive_transaction_args(project_root: Path, args: list[str], state_path: Path) -> tuple[list[str], str, float]:
    enabled, threshold, reprobe_skips, reprobe_hours = config_adaptive_settings(project_root)
    explicit = explicit_transaction_mode(args)
    if readonly_core_invocation(args) and explicit is None:
        print("[PTV v5.15.13 READONLY] SANDBOX SKIPPED — source inspection/collection runs transaction=off.")
        return [*args, "--transaction", "off"], "readonly_no_sandbox", threshold
    configured = configured_transaction_mode(project_root)
    state = load_json(state_path)
    try:
        previous = float(state.get("last_prepare_seconds"))
    except Exception:
        previous = -1.0
    try:
        skips = int(state.get("consecutive_auto_skips", 0) or 0)
    except Exception:
        skips = 0
    try:
        last_probe = float(state.get("last_probe_epoch", 0) or 0)
    except Exception:
        last_probe = 0.0
    age_hours = (time.time() - last_probe) / 3600.0 if last_probe > 0 else 1e9

    if explicit is not None:
        return list(args), f"explicit_{explicit}", threshold
    if configured in {"off", "required"}:
        return list(args), f"configured_{configured}", threshold
    if not enabled:
        return list(args), "adaptive_disabled", threshold
    if previous > threshold:
        if skips >= reprobe_skips or age_hours >= reprobe_hours:
            print(
                f"[PTV v5.15.13] SANDBOX AUTO-REPROBE: previous={previous:.1f}s, "
                f"skips={skips}, age={age_hours:.1f}h."
            )
            return list(args), "sandbox_auto_reprobe", threshold
        new_args = [*args, "--transaction", "off"]
        print("\n" + "!" * 78)
        print("WARNING: SANDBOX AUTO-SKIPPED — RUNNING WITHOUT SANDBOX")
        print(f"Previous isolated worktree preparation: {previous:.1f}s; threshold: {threshold:.1f}s.")
        print(f"Automatic re-probe after {reprobe_skips} skipped runs or {reprobe_hours:.1f}h.")
        print("Patch Tool will run in-place for this invocation. Transaction rollback isolation is NOT available.")
        print("To force a sandbox probe now, run with: --transaction auto")
        print("!" * 78 + "\n")
        return new_args, "auto_skip_slow_previous", threshold
    return list(args), "sandbox_auto_measure", threshold


@contextmanager
def project_run_lock(local_history: Path):
    local_history.mkdir(parents=True, exist_ok=True)
    lock_path = local_history / RUN_LOCK_NAME
    active_path = local_history / ACTIVE_RUN_NAME
    fh = lock_path.open("a+")
    try:
        wait = max(0.0, float(os.environ.get("PTV_RUN_LOCK_WAIT_SECONDS", DEFAULT_LOCK_WAIT_SECONDS)))
    except Exception:
        wait = DEFAULT_LOCK_WAIT_SECONDS

    if fcntl is None:
        try:
            yield
        finally:
            fh.close()
        return

    deadline = time.monotonic() + wait
    while True:
        try:
            fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except BlockingIOError:
            if time.monotonic() >= deadline:
                info = load_json(active_path)
                detail = f" pid={info.get('pid')} since={info.get('started_at')}" if info else ""
                fh.close()
                raise RuntimeError("Another Patch Tool run is active for this project." + detail)
            time.sleep(0.05)

    stale_active = load_json(active_path) if active_path.exists() else {}
    if stale_active:
        append_audit(
            local_history.parent,
            {
                "event": "stale_active_run_marker_recovered",
                "previous_pid": stale_active.get("pid"),
                "previous_started_at": stale_active.get("started_at"),
            },
        )
        print(
            "[PTV v5.15.13] Recovered stale active-run marker from a previous crashed/terminated runner."
        )
    save_json_atomic(
        active_path,
        {
            "pid": os.getpid(),
            "started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "guard_version": GUARD_VERSION,
        },
    )
    try:
        yield
    finally:
        try:
            active_path.unlink()
        except OSError:
            pass
        try:
            fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
        except Exception:
            pass
        fh.close()


def run_guarded_unlocked(project_root: Path, runner: Path, core_args: list[str]) -> int:
    print("Python Patch Tool v5.15.13 runtime-integrity layer active (v5.15 core compatibility).")
    patch_dir = project_root / "patchs"
    reports = patch_dir / "reports"
    local_history = reports / ".patch_tool_local_history"
    state_path = local_history / SANDBOX_STATE_NAME
    history = local_history / "successful.jsonl"
    ignored_dup = patch_dir / "ignored" / "duplicate_success"
    patched_dir = patch_dir / "patched"

    recovered_at_start: list[str] = []
    for incident_name in sorted(KNOWN_FALSE_INCIDENTS):
        if restore_known_false_duplicate(project_root, incident_name, history):
            recovered_at_start.append(incident_name)
    if recovered_at_start:
        print("[PTV v5.15.13] Recovered known unexecuted package(s) from false duplicate_success quarantine:")
        for name in recovered_at_start:
            print(f"  - patchs/{name}")

    journal_path = local_history / INVOCATION_JOURNAL_NAME
    recover_stale_invocation_journal(journal_path, reports, project_root)
    queue_before = queue_snapshot(patch_dir)
    pre_history_raw = history_bytes(history)
    pre_history_lines = history_lines_from_bytes(pre_history_raw)
    pre_run_evidence = {
        "last_run.json": file_evidence_state(reports / "last_run.json"),
        "LAST_RUN.md": file_evidence_state(reports / "LAST_RUN.md"),
    }
    run_start_wall_ns = time.time_ns()
    write_invocation_journal(
        journal_path,
        queue_before=queue_before,
        core_args=list(core_args),
        run_start_wall_ns=run_start_wall_ns,
        pre_evidence=pre_run_evidence,
        pre_history_raw=pre_history_raw,
    )

    scoped_plan = infer_scoped_file_transaction(project_root, list(core_args), queue_before)
    scoped_snapshot: dict[str, Any] | None = None
    if scoped_plan.get("eligible"):
        try:
            scoped_snapshot = create_scoped_snapshot(project_root, local_history, scoped_plan)
            args = [*list(core_args), "--transaction", "off"]
            sandbox_decision = "scoped_file_transaction"
            _enabled, threshold, _skips, _hours = config_adaptive_settings(project_root)
            print(
                f"[PTV v5.15.13] SCOPED FILE TRANSACTION: {scoped_plan.get('target_count',0)} exact target file(s); "
                "full Git worktree SANDBOX skipped."
            )
            if scoped_plan.get("zero_arg_union"):
                print("Scope is the union of all statically-safe queued data-only patches; unselected files are only snapshotted, never modified by the guard.")
        except Exception as exc:
            print(f"[PTV v5.15.13 WARNING] Scoped-file snapshot unavailable: {exc}; falling back to normal sandbox policy.")
            scoped_snapshot = None
            args, sandbox_decision, threshold = adaptive_transaction_args(project_root, list(core_args), state_path)
    else:
        args, sandbox_decision, threshold = adaptive_transaction_args(project_root, list(core_args), state_path)
    append_audit(reports, {"event":"scoped_transaction_preflight", **scoped_plan, "decision":sandbox_decision})
    env = {
        **os.environ,
        "PYTHONPATH": str(runner.parent)
        + (os.pathsep + os.environ["PYTHONPATH"] if os.environ.get("PYTHONPATH") else ""),
    }
    proc = subprocess.Popen([sys.executable, str(runner), *args], cwd=str(project_root), env=env)
    timing: dict[str, Any] = {}
    monitor: threading.Thread | None = None
    monitor_sandbox = sandbox_decision not in {
        "explicit_off",
        "configured_off",
        "auto_skip_slow_previous",
        "readonly_no_sandbox",
        "scoped_file_transaction",
    }
    if monitor_sandbox:
        monitor = threading.Thread(
            target=monitor_first_git_worktree,
            args=(proc, timing, threshold),
            daemon=True,
        )
        monitor.start()
    rc = int(proc.wait())
    # First durable action after core exit: bind LAST_RUN/history evidence to this invocation.
    # A checkpoint I/O failure must not turn an already-executed patch into an apparent
    # rerunnable failure.  Continue current-run cleanup, but future crash recovery remains
    # fail-safe because the journal never reaches state=core_completed.
    try:
        record_core_completion_checkpoint(journal_path, reports, history, rc)
    except Exception as exc:
        print(
            f"[PTV v5.15.13 WARNING] Could not persist post-core crash-recovery checkpoint: {exc}. "
            "Current-run integrity cleanup continues; a later interruption will not auto-repair ambiguous packages."
        )
        append_audit(
            reports,
            {
                "event": "core_completion_checkpoint_write_failed",
                "core_returncode": rc,
                "error": repr(exc),
            },
        )
    if monitor is not None:
        monitor.join(timeout=0.5)

    measured = timing.get("seconds") if monitor_sandbox else None
    if isinstance(measured, (int, float)):
        measured = float(measured)
        print(
            f"[PTV v5.15.13] SANDBOX metric updated: git worktree preparation ≈ {measured:.1f}s "
            f"(slow threshold {threshold:.1f}s)."
        )
    update_sandbox_state(
        state_path,
        measured_seconds=measured,
        decision=sandbox_decision,
        threshold=threshold,
        core_rc=rc,
    )
    append_audit(
        reports,
        {
            "event": "sandbox_decision",
            "decision": sandbox_decision,
            "measured_seconds": measured,
            "threshold_seconds": threshold,
            "core_returncode": rc,
            "live_slow": bool(timing.get("live_slow")),
            "monitor_enabled": monitor_sandbox,
        },
    )

    # Only current-invocation last-run evidence is authoritative. A stale LAST_RUN from
    # a previous invocation must never mark a package executed or PASS in this run.
    outcomes, execution_sources, overall_run_status = parse_current_run_outcomes(reports, pre_run_evidence)
    executed, passed, failed, ambiguous = classify_current_outcomes(outcomes)
    evidence_available = bool(execution_sources)

    scoped_rollback: dict[str, Any] | None = None
    if scoped_snapshot is not None:
        should_rollback = rc != 0 or bool(failed)
        if should_rollback:
            head_before = scoped_snapshot.get("manifest", {}).get("git_head_before")
            head_after = _git_head(project_root)
            if head_before and head_after and head_before != head_after:
                scoped_rollback = {"skipped": True, "reason": "git_head_changed", "git_head_before": head_before, "git_head_after": head_after}
                print("[PTV v5.15.13 WARNING] Scoped rollback skipped because Git HEAD changed during the run (for example a commit succeeded before a later Git/push error).")
            else:
                scoped_rollback = restore_scoped_snapshot(project_root, scoped_snapshot)
                if scoped_rollback.get("errors"):
                    print(f"[PTV v5.15.13 WARNING] Scoped rollback completed with {len(scoped_rollback['errors'])} error(s).")
                else:
                    print(f"[PTV v5.15.13] SCOPED ROLLBACK: restored {len(scoped_rollback.get('restored',[]))} existing and removed {len(scoped_rollback.get('removed_created',[]))} newly-created target file(s).")
        else:
            scoped_rollback = {"skipped": True, "reason": "run_passed"}
        append_audit(reports, {"event":"scoped_transaction_result", "plan":scoped_plan, "rollback":scoped_rollback, "core_returncode":rc, "failed":sorted(failed)})
        cleanup_scoped_snapshot(scoped_snapshot)

    append_audit(
        reports,
        {
            "event": "current_run_execution_evidence",
            "sources": execution_sources,
            "executed": sorted(executed),
            "passed": sorted(passed),
            "failed": sorted(failed),
            "ambiguous": sorted(ambiguous),
            "overall_run_status": overall_run_status,
            "raw_outcomes": {k: sorted(v) for k, v in sorted(outcomes.items())},
            "core_returncode": rc,
        },
    )

    if not evidence_available:
        print(
            "[PTV v5.15.13 WARNING] No current-invocation last_run evidence was produced. "
            "Stale LAST_RUN data was ignored; automatic queue/history repair is skipped for safety."
        )
        append_audit(
            reports,
            {
                "event": "selection_repair_skipped_no_current_execution_evidence",
                "queue_before": sorted(queue_before),
                "core_returncode": rc,
            },
        )
        journal = load_json(journal_path)
        journal.update({
            "state": "ambiguous_no_current_execution_evidence",
            "core_returncode": rc,
            "finished_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        })
        save_json_atomic(journal_path.with_name(LAST_INVOCATION_NAME), journal)
        try:
            journal_path.unlink()
        except OSError:
            pass
        return rc

    restored: list[tuple[str, str]] = []
    # Success history is allowed only for packages with current-run EXECUTED + PASS evidence.
    # FAIL, SKIPPED, NOT EXECUTED and ambiguous executed outcomes must not create PASS records.
    false_history_candidates: list[tuple[str, str]] = []
    protected_pass_digests: set[str] = set()
    for passed_name in passed:
        identity = queue_before.get(passed_name)
        if identity and identity.get("sha256"):
            protected_pass_digests.add(str(identity["sha256"]))
    weak_history_seen: list[str] = []
    for basename, identity in queue_before.items():
        digest = str(identity.get("sha256") or "")
        if basename not in passed:
            false_history_candidates.append((basename, digest))
        # Queue retention follows the v5.15 contract:
        #   PASS -> may leave the queue and move to patched/
        #   FAIL -> must remain available in patchs/ for replacement or rerun
        #   SKIPPED / NOT EXECUTED -> must remain unchanged in patchs/
        #   EXECUTED_UNKNOWN -> fail-safe: do not auto-move because the patch may have
        #                       partially mutated the project without a trustworthy outcome.
        is_failed = basename in failed
        if basename in executed and not is_failed:
            continue
        if (patch_dir / basename).exists():
            continue

        moved = find_current_moved_candidate(ignored_dup, basename, identity, run_start_wall_ns)
        source_kind = "executed_fail_wrongly_quarantined" if is_failed else "duplicate_success"
        if moved is not None and not is_failed:
            if prehistory_attests_content(pre_history_lines, digest):
                # A pre-run success record proves this exact content already succeeded.
                moved = None
            elif prehistory_attests_name_only(pre_history_lines, basename, digest):
                weak_history_seen.append(basename)

        if moved is None:
            moved = find_current_moved_candidate(patched_dir, basename, identity, run_start_wall_ns)
            source_kind = "executed_fail_wrongly_moved_to_patched" if is_failed else "patched_without_execution"

        if moved is None:
            continue
        dst = patch_dir / basename
        if dst.exists():
            continue
        current_digest = ""
        try:
            current_digest = sha256_file(moved)
        except OSError:
            pass
        shutil.move(str(moved), str(dst))
        restored.append((basename, source_kind))
        append_audit(
            reports,
            {
                "event": "restored_runnable_package",
                "package": basename,
                "sha256_before_selector": digest,
                "sha256_restored": current_digest or None,
                "content_changed_during_invocation": bool(current_digest and digest and current_digest != digest),
                "from_kind": source_kind,
                "core_returncode": rc,
            },
        )
        if current_digest and digest and current_digest != digest:
            print(
                f"[PTV v5.15.13 WARNING] {basename} changed content while the selection run was active; "
                "the same queued file identity was restored with its newer bytes."
            )

    history_removed, append_only_ok = rewrite_history_without_new_false(
        history,
        pre_history_raw,
        false_history_candidates,
        protected_pass_digests=protected_pass_digests,
    )
    if not append_only_ok:
        append_audit(reports, {"event": "history_not_append_only_skip_rewrite", "path": str(history)})
        print(
            "[PTV v5.15.13 WARNING] successful.jsonl changed non-append-only during the run; "
            "guard did not rewrite it automatically."
        )
    if history_removed:
        append_audit(reports, {"event": "removed_new_success_evidence_for_unexecuted", "count": history_removed})

    if weak_history_seen:
        unique = sorted(set(weak_history_seen))
        append_audit(
            reports,
            {
                "event": "weak_basename_only_success_history_ignored",
                "packages": unique,
            },
        )
        print(
            "[PTV v5.15.13] Ignored basename-only historical success evidence for changed/unverified "
            "package content: " + ", ".join(unique)
        )

    if restored:
        print("\n[PTV v5.15.13 SELECTION-INTEGRITY FIX]")
        for name, kind in restored:
            print(f"RESTORED UNEXECUTED PATCH: patchs/{name}  [{kind}]")
        print("These packages must remain runnable: either they were NOT executed or they EXECUTED+FAIL.")
    if history_removed:
        print(
            f"[PTV v5.15.13] Removed {history_removed} newly-created false success-history record(s) "
            "for packages not executed in this run."
        )
    journal = load_json(journal_path)
    journal.update({
        "state": "completed",
        "core_returncode": rc,
        "finished_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "executed": sorted(executed),
        "passed": sorted(passed),
        "failed": sorted(failed),
        "ambiguous": sorted(ambiguous),
        "overall_run_status": overall_run_status,
        "execution_sources": execution_sources,
        "restored_runnable": [name for name, _kind in restored],
        "history_records_removed": history_removed,
        "scoped_transaction": {"plan": scoped_plan, "rollback": scoped_rollback},
    })
    save_json_atomic(journal_path.with_name(LAST_INVOCATION_NAME), journal)
    try:
        journal_path.unlink()
    except OSError:
        pass
    return rc

def run_guarded(project_root: Path, runner: Path, core_args: list[str]) -> int:
    local_history = project_root / "patchs" / "reports" / ".patch_tool_local_history"
    try:
        with project_run_lock(local_history):
            return run_guarded_unlocked(project_root, runner, core_args)
    except RuntimeError as exc:
        print("\n" + "!" * 78, file=sys.stderr)
        print("ERROR: PATCH TOOL PROJECT LOCK ACTIVE", file=sys.stderr)
        print(str(exc), file=sys.stderr)
        print(
            "A second runner is blocked to protect patchs/, successful.jsonl and transaction state.",
            file=sys.stderr,
        )
        print("!" * 78 + "\n", file=sys.stderr)
        return 75


def main() -> int:
    ap = argparse.ArgumentParser(description="Patch Tool v5.15.13 runtime-integrity guard")
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
