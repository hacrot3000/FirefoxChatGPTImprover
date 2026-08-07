#!/usr/bin/env python3
"""Transactional sandbox support for Python Patch Tool v5.8.

The runner executes patch payloads and validation inside a detached Git worktree.
Only the verified delta is copied back to the user's real worktree. Existing dirty
and staged changes are preserved; the real Git index is never shared with the
sandbox. Applying the verified delta uses a rollback journal so an interrupted or
failed copy cannot silently leave a partially applied patch.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import fnmatch
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import tempfile
from typing import Any, Callable, Iterable


class TransactionError(RuntimeError):
    pass


def _run(command: list[str], cwd: Path) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(command, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)


def _safe_rel(value: str) -> str:
    value = value.replace("\\", "/")
    pure = PurePosixPath(value)
    if not value or pure.is_absolute() or any(part in {"", ".", ".."} for part in pure.parts):
        raise TransactionError(f"Unsafe transaction path: {value!r}")
    return pure.as_posix()


def _parse_porcelain_z(data: bytes) -> dict[str, str]:
    tokens = data.split(b"\0")
    result: dict[str, str] = {}
    index = 0
    while index < len(tokens):
        token = tokens[index]
        index += 1
        if not token or len(token) < 4:
            continue
        status = token[:2].decode("ascii", "replace")
        path = token[3:].decode("utf-8", "surrogateescape")
        result[path] = status
        if "R" in status or "C" in status:
            if index < len(tokens) and tokens[index]:
                result[tokens[index].decode("utf-8", "surrogateescape")] = status
                index += 1
    return result


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def path_fingerprint(path: Path) -> str:
    try:
        info = path.lstat()
    except FileNotFoundError:
        return "missing"
    if stat.S_ISLNK(info.st_mode):
        return "symlink:" + os.readlink(path)
    if stat.S_ISREG(info.st_mode):
        return f"file:{info.st_mode & 0o7777:o}:{info.st_size}:{_sha256(path)}"
    if stat.S_ISDIR(info.st_mode):
        return f"dir:{info.st_mode & 0o7777:o}"
    return f"special:{info.st_mode}"


def _remove(path: Path) -> None:
    try:
        info = path.lstat()
    except FileNotFoundError:
        return
    if stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode):
        shutil.rmtree(path)
    else:
        path.unlink()


def _copy_entry(source: Path, target: Path) -> None:
    info = source.lstat()
    target.parent.mkdir(parents=True, exist_ok=True)
    _remove(target)
    if stat.S_ISLNK(info.st_mode):
        target.symlink_to(os.readlink(source), target_is_directory=False)
    elif stat.S_ISDIR(info.st_mode):
        shutil.copytree(source, target, symlinks=True)
    elif stat.S_ISREG(info.st_mode):
        temp = target.with_name(target.name + ".patch-tool-tmp")
        _remove(temp)
        shutil.copy2(source, temp, follow_symlinks=False)
        os.replace(temp, target)
    else:
        raise TransactionError(f"Unsupported filesystem entry in transaction: {source}")


def _matches(path: str, patterns: Iterable[str]) -> bool:
    normalized = path.replace("\\", "/")
    for pattern in patterns:
        pattern = str(pattern).replace("\\", "/")
        if fnmatch.fnmatch(normalized, pattern):
            return True
        if pattern.endswith("/**") and normalized.startswith(pattern[:-3].rstrip("/") + "/"):
            return True
    return False


def _git_status(root: Path) -> dict[str, str]:
    result = _run(["git", "status", "--porcelain=v1", "-z", "--untracked-files=all"], root)
    if result.returncode != 0:
        raise TransactionError(result.stderr.decode("utf-8", "replace").strip() or "git status failed")
    return _parse_porcelain_z(result.stdout)


def _is_tracked(root: Path, rel: str) -> bool:
    return _run(["git", "ls-files", "--error-unmatch", "--", rel], root).returncode == 0


def _copy_overlay(real_root: Path, sandbox_root: Path, rel: str) -> None:
    rel = _safe_rel(rel)
    source = real_root / rel
    target = sandbox_root / rel
    if source.exists() or source.is_symlink():
        _copy_entry(source, target)
    else:
        _remove(target)


def _backup_entry(source: Path, backup: Path) -> dict[str, Any]:
    fingerprint = path_fingerprint(source)
    metadata: dict[str, Any] = {"fingerprint": fingerprint, "exists": fingerprint != "missing"}
    if fingerprint != "missing":
        _copy_entry(source, backup)
    return metadata


def _restore_entry(backup: Path, target: Path, metadata: dict[str, Any]) -> None:
    if metadata.get("exists"):
        _copy_entry(backup, target)
    else:
        _remove(target)


def _sensitive_report_path(rel: str) -> bool:
    lower = rel.replace("\\", "/").lower()
    name = PurePosixPath(lower).name
    if name in {".env", "id_rsa", "id_ed25519", "credentials", "credentials.json", "secrets.json"}:
        return True
    if name.endswith((".pem", ".key", ".p12", ".pfx", ".jks", ".keystore")):
        return True
    return any(token in lower for token in ("/secrets/", "/credentials/", "access_token", "refresh_token", "private_key"))


@dataclass
class SandboxTransaction:
    real_root: Path
    temp_root: Path
    report_dir: Path
    config: dict[str, Any]
    log: Callable[[str, bool], None]
    status: Callable[[str], None] | None = None
    sandbox_root: Path | None = None
    container_dir: Path | None = None
    initial_status: dict[str, str] = field(default_factory=dict)
    initial_fingerprints: dict[str, str] = field(default_factory=dict)
    result: dict[str, Any] = field(default_factory=lambda: {
        "mode": "sandbox", "status": "NOT_STARTED", "sandbox": "", "overlay_paths": [],
        "delta_paths": [], "applied_paths": [], "conflicts": [], "rollback": "NOT_NEEDED",
        "cleanup": "NOT_RUN", "warnings": [],
    })

    def _line(self, text: str, error: bool = False) -> None:
        self.log(text, error)

    def _status(self, text: str) -> None:
        if self.status is not None:
            try:
                self.status(text)
            except Exception:
                pass

    def _display_path(self, path: Path) -> str:
        try:
            return path.resolve().relative_to(self.real_root.resolve()).as_posix()
        except Exception:
            return path.name

    def start(self) -> Path:
        check = _run(["git", "rev-parse", "--is-inside-work-tree"], self.real_root)
        if check.returncode != 0 or check.stdout.strip() != b"true":
            raise TransactionError("Transactional sandbox requires a Git worktree")
        self.temp_root.mkdir(parents=True, exist_ok=True)
        self.container_dir = Path(tempfile.mkdtemp(prefix="transaction.", dir=self.temp_root))
        self.sandbox_root = self.container_dir / "worktree"
        self._status("creating detached git worktree")
        add = _run(["git", "worktree", "add", "--detach", str(self.sandbox_root), "HEAD"], self.real_root)
        if add.returncode != 0:
            raise TransactionError(add.stderr.decode("utf-8", "replace").strip() or "git worktree add failed")

        excludes = list(self.config.get("exclude_paths", []))
        excludes.extend([".git", ".git/**", "patchs", "patchs/**"])
        self.initial_status = _git_status(self.real_root)
        overlay: list[str] = []
        for rel in sorted(self.initial_status):
            if not _matches(rel, excludes):
                overlay.append(rel)
        for rel in self.config.get("overlay_paths", []):
            rel = _safe_rel(str(rel))
            if not _matches(rel, excludes) and rel not in overlay:
                overlay.append(rel)
        for rel in (".python_patch_tool.json", "tools/_patch_lib/python_patch_tool_config.json", "tools/python_patch_tool_config.json"):
            if (self.real_root / rel).exists() and rel not in overlay:
                overlay.append(rel)

        total_overlay = len(overlay)
        for index, rel in enumerate(overlay, 1):
            self._status(f"overlay {index}/{total_overlay}: {rel}")
            _copy_overlay(self.real_root, self.sandbox_root, rel)
        (self.sandbox_root / "patchs").mkdir(exist_ok=True)
        self.initial_fingerprints = {rel: path_fingerprint(self.real_root / rel) for rel in self.initial_status}
        self.result.update({
            "status": "SANDBOX_READY",
            "sandbox": self._display_path(self.sandbox_root),
            "overlay_paths": overlay,
            "initial_dirty_paths": sorted(self.initial_status),
        })
        self._line(f"Transaction sandbox: ready at {self._display_path(self.sandbox_root)}")
        self._line(f"Transaction overlay: {len(overlay)} dirty/config path(s) copied; real Git index remains isolated")
        return self.sandbox_root

    def _verify_real_unchanged(self, rel: str) -> tuple[bool, str]:
        current = path_fingerprint(self.real_root / rel)
        if rel in self.initial_fingerprints:
            expected = self.initial_fingerprints[rel]
            return current == expected, f"expected={expected} current={current}"
        if _is_tracked(self.real_root, rel):
            status = _run(["git", "status", "--porcelain=v1", "--", rel], self.real_root)
            text = status.stdout.decode("utf-8", "replace").strip()
            return not text, f"expected=clean HEAD current_status={text or 'clean'}"
        return current == "missing", f"expected=missing current={current}"

    def apply_delta(self, paths: Iterable[str]) -> dict[str, Any]:
        if not self.sandbox_root:
            raise TransactionError("Sandbox was not started")
        safe_paths = []
        for raw in paths:
            rel = _safe_rel(str(raw))
            if rel.startswith("patchs/") or rel == "patchs" or rel.startswith(".git/") or rel == ".git":
                continue
            if rel not in safe_paths:
                safe_paths.append(rel)
        max_paths = int(self.config.get("max_apply_paths", 4000))
        if len(safe_paths) > max_paths:
            raise TransactionError(f"Transaction delta contains {len(safe_paths)} paths, exceeding max_apply_paths={max_paths}")
        self.result["delta_paths"] = safe_paths
        conflicts: list[dict[str, str]] = []
        for rel in safe_paths:
            okay, evidence = self._verify_real_unchanged(rel)
            if not okay:
                conflicts.append({"path": rel, "evidence": evidence})
        if conflicts:
            self.result.update({"status": "APPLY_CONFLICT", "conflicts": conflicts})
            raise TransactionError("PTV-TRANSACTION-CONFLICT-001: real worktree changed while sandbox was running")

        backup_root = self.report_dir / "transaction" / "rollback_journal"
        backup_root.mkdir(parents=True, exist_ok=True)
        journal: dict[str, dict[str, Any]] = {}
        applied: list[str] = []
        self.result["status"] = "APPLYING"
        try:
            total_apply = len(safe_paths)
            for index, rel in enumerate(safe_paths, 1):
                self._status(f"apply {index}/{total_apply}: {rel}")
                real = self.real_root / rel
                sandbox = self.sandbox_root / rel
                backup = backup_root / f"{index:05d}" / "entry"
                metadata = _backup_entry(real, backup)
                metadata["backup"] = str(backup.relative_to(self.report_dir))
                journal[rel] = metadata
                if sandbox.exists() or sandbox.is_symlink():
                    _copy_entry(sandbox, real)
                else:
                    _remove(real)
                applied.append(rel)
            manifest_data = {
                rel: {"before_fingerprint": metadata.get("fingerprint", "missing")}
                for rel, metadata in journal.items()
            }
            (self.report_dir / "transaction" / "rollback_manifest.json").write_text(
                json.dumps(manifest_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
            shutil.rmtree(backup_root, ignore_errors=True)
            self.result.update({
                "status": "APPLIED", "applied_paths": applied, "rollback": "NOT_NEEDED",
                "rollback_journal_retained": False,
            })
            self._line(f"Transaction apply: copied verified delta to real worktree ({len(applied)} path(s))")
        except BaseException as exc:
            rollback_errors: list[str] = []
            for rel in reversed(applied):
                try:
                    metadata = journal[rel]
                    backup = self.report_dir / metadata["backup"]
                    _restore_entry(backup, self.real_root / rel, metadata)
                except Exception as rollback_exc:
                    rollback_errors.append(f"{rel}: {rollback_exc}")
            rollback = "SUCCESS" if not rollback_errors else "FAIL"
            if not rollback_errors:
                shutil.rmtree(backup_root, ignore_errors=True)
            self.result.update({
                "status": "APPLY_FAILED_ROLLED_BACK" if not rollback_errors else "APPLY_FAILED_ROLLBACK_FAILED",
                "applied_paths": applied, "rollback": rollback, "rollback_errors": rollback_errors,
                "apply_error": str(exc), "rollback_journal_retained": bool(rollback_errors),
            })
            raise TransactionError(f"Transaction apply failed; rollback={rollback}: {exc}") from exc
        finally:
            manifest = self.report_dir / "transaction" / "transaction.json"
            manifest.parent.mkdir(parents=True, exist_ok=True)
            manifest.write_text(json.dumps(self.result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return self.result

    def preserve_delta(self, paths: Iterable[str], *, max_bytes: int = 8 * 1024 * 1024) -> dict[str, Any]:
        """Copy bounded sandbox-after evidence into the report without touching real files."""
        if not self.sandbox_root:
            return {"included": 0, "bytes": 0, "skipped": []}
        destination = self.report_dir / "transaction" / "sandbox_after"
        included = 0
        used = 0
        skipped: list[str] = []
        for raw in paths:
            try:
                rel = _safe_rel(str(raw))
            except Exception:
                continue
            source = self.sandbox_root / rel
            if _sensitive_report_path(rel):
                skipped.append(rel + " [sensitive]")
                continue
            if not source.exists() or source.is_symlink() or not source.is_file():
                continue
            size = source.stat().st_size
            if size > max_bytes or used + size > max_bytes:
                skipped.append(rel)
                continue
            target = destination / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            included += 1
            used += size
        result = {"included": included, "bytes": used, "skipped": skipped}
        self.result["sandbox_evidence"] = result
        return result

    def mark_discarded(self, reason: str) -> None:
        if self.result.get("status") not in {"APPLIED", "APPLY_FAILED_ROLLED_BACK", "APPLY_FAILED_ROLLBACK_FAILED"}:
            self.result["status"] = reason

    def cleanup(self, *, keep: bool = False) -> None:
        if not self.sandbox_root or not self.container_dir:
            return
        if keep:
            self.result["cleanup"] = "KEPT"
            self.result["sandbox"] = self._display_path(self.sandbox_root)
            return
        remove = _run(["git", "worktree", "remove", "--force", str(self.sandbox_root)], self.real_root)
        if remove.returncode != 0:
            self.result["warnings"].append(remove.stderr.decode("utf-8", "replace").strip())
            _run(["git", "worktree", "prune"], self.real_root)
            shutil.rmtree(self.container_dir, ignore_errors=True)
            self.result["cleanup"] = "FORCED"
        else:
            shutil.rmtree(self.container_dir, ignore_errors=True)
            self.result["cleanup"] = "REMOVED"
        manifest = self.report_dir / "transaction" / "transaction.json"
        manifest.parent.mkdir(parents=True, exist_ok=True)
        manifest.write_text(json.dumps(self.result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
