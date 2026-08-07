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
import threading
import time
from typing import Any, Iterable

GUARD_VERSION = "5.15.2"
MARKER_NAME = ".ptv5152_force_repeat_once"
AUDIT_NAME = "runtime_integrity_guard.jsonl"
SANDBOX_STATE_NAME = "sandbox_performance.json"
CANDIDATE_SUFFIXES = (".zip", ".py", ".tar.gz", ".tgz")
KNOWN_FALSE_INCIDENTS = {"patch_nfc179_protected_read_consume_cleanup_boundary_v5_20260807_1320.zip"}
DEFAULT_SLOW_SECONDS = 60.0


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
                        token = token.strip("[]():,;'\"")
                        low = token.lower()
                        if low.startswith("patch") and any(low.endswith(s) for s in CANDIDATE_SUFFIXES):
                            out.add(Path(token).name)
        except OSError:
            pass
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
        if (str(p.relative_to(patched_dir)), dg) in before_pairs:
            continue
        for name, qdg in queue_before.items():
            if dg == qdg:
                out.add(name)
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


def rewrite_history_without_new_false(history: Path, pre_lines: list[str], false_candidates: list[tuple[str, str]]) -> int:
    post = history_lines(history)
    prefix_len = min(len(pre_lines), len(post))
    # Never rewrite the pre-run prefix. Only clean lines appended during this invocation.
    kept = list(post[:prefix_len])
    removed = 0
    for line in post[prefix_len:]:
        if any(line_attests_candidate(line, basename, digest) for basename, digest in false_candidates):
            removed += 1
        else:
            kept.append(line)
    if removed:
        tmp = history.with_suffix(history.suffix + ".ptv5152.tmp")
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
    append_audit(patch_dir / "reports", {"event": "known_false_duplicate_recovered", "package": basename, "from": str(src.relative_to(project_root))})
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


def config_adaptive_settings(project_root: Path) -> tuple[bool, float]:
    enabled = True
    threshold = DEFAULT_SLOW_SECONDS
    cfg = load_json(project_root / ".python_patch_tool.json")
    tx = cfg.get("transaction") if isinstance(cfg.get("transaction"), dict) else {}
    adaptive = tx.get("adaptive_sandbox") if isinstance(tx.get("adaptive_sandbox"), dict) else {}
    if "enabled" in adaptive:
        enabled = bool(adaptive.get("enabled"))
    try:
        threshold = float(adaptive.get("slow_threshold_seconds", threshold))
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
    threshold = max(0.05, threshold)
    return enabled, threshold


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
    """Return pid -> (ppid, args). Uses ps so it also works where /proc children is hidden."""
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
            pid = int(parts[0]); ppid = int(parts[1])
        except Exception:
            continue
        args = parts[2] if len(parts) > 2 else ""
        table[pid] = (ppid, args)
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


def monitor_first_git_worktree(proc: subprocess.Popen[Any], result: dict[str, Any]) -> None:
    start: float | None = None
    last_seen: float | None = None
    observed_pids: set[int] = set()
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
        elif start is not None and last_seen is not None and now - last_seen >= 0.10:
            result["seconds"] = max(0.0, last_seen - start)
            result["observed_pids"] = sorted(observed_pids)
            return
        time.sleep(0.05)
    if start is not None and last_seen is not None:
        result["seconds"] = max(0.0, last_seen - start)
        result["observed_pids"] = sorted(observed_pids)


def update_sandbox_state(state_path: Path, *, measured_seconds: float | None, decision: str, threshold: float, core_rc: int) -> None:
    state = load_json(state_path)
    state.update({
        "schema": 1,
        "guard_version": GUARD_VERSION,
        "project_root_hash": hashlib.sha256(str(state_path.parents[3] if len(state_path.parents) > 3 else state_path.parent).encode()).hexdigest()[:16],
        "slow_threshold_seconds": threshold,
        "last_decision": decision,
        "last_core_returncode": int(core_rc),
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    })
    if measured_seconds is not None:
        state["last_prepare_seconds"] = round(float(measured_seconds), 3)
        state["last_prepare_slow"] = bool(measured_seconds > threshold)
        state["last_measured_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    save_json_atomic(state_path, state)


def adaptive_transaction_args(project_root: Path, args: list[str], state_path: Path) -> tuple[list[str], str, float]:
    enabled, threshold = config_adaptive_settings(project_root)
    explicit = explicit_transaction_mode(args)
    configured = configured_transaction_mode(project_root)
    state = load_json(state_path)
    try:
        previous = float(state.get("last_prepare_seconds"))
    except Exception:
        previous = -1.0

    if explicit is not None:
        return list(args), f"explicit_{explicit}", threshold
    if configured in {"off", "required"}:
        return list(args), f"configured_{configured}", threshold
    if not enabled:
        return list(args), "adaptive_disabled", threshold
    if previous > threshold:
        new_args = [*args, "--transaction", "off"]
        print("\n" + "!" * 78)
        print("WARNING: SANDBOX AUTO-SKIPPED — RUNNING WITHOUT SANDBOX")
        print(f"Previous isolated worktree preparation: {previous:.1f}s; threshold: {threshold:.1f}s.")
        print("Patch Tool will run in-place for this invocation. Transaction rollback isolation is NOT available.")
        print("To force a sandbox probe once, run with: --transaction auto")
        print("!" * 78 + "\n")
        return new_args, "auto_skip_slow_previous", threshold
    return list(args), "sandbox_auto_measure", threshold


def run_guarded(project_root: Path, runner: Path, core_args: list[str]) -> int:
    print("Python Patch Tool v5.15.2 runtime-integrity layer active (v5.15 core compatibility).")
    patch_dir = project_root / "patchs"
    reports = patch_dir / "reports"
    local_history = reports / ".patch_tool_local_history"
    state_path = local_history / SANDBOX_STATE_NAME

    recovered_at_start: list[str] = []
    for incident_name in sorted(KNOWN_FALSE_INCIDENTS):
        if restore_known_false_duplicate(project_root, incident_name):
            recovered_at_start.append(incident_name)
    marker = reports / MARKER_NAME
    if recovered_at_start:
        reports.mkdir(parents=True, exist_ok=True)
        marker.write_text("\n".join(recovered_at_start) + "\n", encoding="utf-8")
        print("[PTV v5.15.2] Recovered known unexecuted package(s) from false duplicate_success quarantine:")
        for name in recovered_at_start:
            print(f"  - patchs/{name}")

    history = local_history / "successful.jsonl"
    ignored_dup = patch_dir / "ignored" / "duplicate_success"
    patched_dir = patch_dir / "patched"
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
        if not args or args == ["--force-repeat"]:
            args.append("--select")
        print("[PTV v5.15.2 guard] Recovered unexecuted queue item detected; duplicate suppression bypassed for this selection only.")

    args, sandbox_decision, threshold = adaptive_transaction_args(project_root, args, state_path)
    env = {**os.environ, "PYTHONPATH": str(runner.parent) + (os.pathsep + os.environ["PYTHONPATH"] if os.environ.get("PYTHONPATH") else "")}
    proc = subprocess.Popen([sys.executable, str(runner), *args], cwd=str(project_root), env=env)
    timing: dict[str, Any] = {}
    monitor = threading.Thread(target=monitor_first_git_worktree, args=(proc, timing), daemon=True)
    monitor.start()
    rc = int(proc.wait())
    monitor.join(timeout=0.5)
    measured = timing.get("seconds")
    if isinstance(measured, (int, float)):
        measured = float(measured)
        print(f"[PTV v5.15.2] SANDBOX previous-run metric updated: isolated worktree preparation ≈ {measured:.1f}s (slow threshold {threshold:.1f}s).")
    update_sandbox_state(state_path, measured_seconds=measured, decision=sandbox_decision, threshold=threshold, core_rc=rc)
    append_audit(reports, {"event": "sandbox_decision", "decision": sandbox_decision, "measured_seconds": measured, "threshold_seconds": threshold, "core_returncode": rc})

    executed = parse_last_run_executed(reports)
    executed |= newly_patched_names(patched_dir, pre_patched, queue_before)

    restored: list[str] = []
    false_history_candidates: list[tuple[str, str]] = []
    for basename, digest in queue_before.items():
        if basename in executed:
            continue
        # Unexecuted packages must never gain new success evidence during this run,
        # even when they remain in patchs/. This prevents a later false duplicate skip.
        false_history_candidates.append((basename, digest))
        if (patch_dir / basename).exists():
            continue
        moved = find_matching_in_ignored(ignored_dup, basename, digest)
        if moved is None:
            continue
        rel = str(moved.relative_to(ignored_dup))
        if pre_ignored.get(rel) == digest:
            continue
        if prehistory_attests(pre_history, basename, digest):
            # Existing local history may legitimately classify a package as duplicate.
            continue
        dst = patch_dir / basename
        if dst.exists():
            continue
        shutil.move(str(moved), str(dst))
        restored.append(basename)
        append_audit(reports, {"event": "restored_unexecuted_duplicate_success", "package": basename, "sha256": digest, "core_returncode": rc})

    history_removed = rewrite_history_without_new_false(history, pre_history, false_history_candidates)
    if history_removed:
        append_audit(reports, {"event": "removed_new_success_evidence_for_unexecuted", "count": history_removed})

    if restored:
        reports.mkdir(parents=True, exist_ok=True)
        marker.write_text("\n".join(restored) + "\n", encoding="utf-8")
        print("\n[PTV v5.15.2 SELECTION-INTEGRITY FIX]")
        for name in restored:
            print(f"RESTORED UNEXECUTED PATCH: patchs/{name}")
        print("These packages were NOT executed and remain runnable on the next selection.")
    if history_removed:
        print(f"[PTV v5.15.2] Removed {history_removed} newly-created false success-history record(s) for packages not executed in this run.")

    return rc


def main() -> int:
    ap = argparse.ArgumentParser(description="Patch Tool v5.15.2 runtime-integrity guard")
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
