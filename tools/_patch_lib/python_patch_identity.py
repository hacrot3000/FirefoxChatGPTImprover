#!/usr/bin/env python3
"""Local project identity, patch-package inspection, and duplicate history.

The state managed here is intentionally machine-local. It is an automation aid,
not a source-of-truth for patch ordering or repository correctness.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import tarfile
from typing import Any, Optional
import zipfile

PROJECT_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,127}$")
PATCH_SCRIPT_RE = re.compile(r"(?:^|/)patch_[^/]+\.py$", re.IGNORECASE)
MANIFEST_NAME = "PATCH_TOOL_MANIFEST.json"
OPS_NAME = "PATCH_TOOL_OPS.json"
LEGACY_V4_MARKERS = (b"python_patch_utils", b"run_patch(", b"apply_ops(", b"PATCH_NAME")


class IdentityError(RuntimeError):
    pass


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).astimezone().isoformat(timespec="seconds")


def validate_project_key(value: Any, field: str = "project.key") -> str:
    if not isinstance(value, str):
        raise IdentityError(f"{field} must be a string")
    key = value.strip().lower()
    if not PROJECT_KEY_RE.fullmatch(key):
        raise IdentityError(
            f"{field} must match {PROJECT_KEY_RE.pattern!r}; use a stable lowercase project identifier"
        )
    return key


def _safe_member(name: str) -> str:
    if not name or "\x00" in name:
        raise IdentityError("archive contains an empty or NUL member name")
    normalized = name.replace("\\", "/")
    pure = PurePosixPath(normalized)
    if pure.is_absolute() or any(part in {"", ".", ".."} for part in pure.parts):
        raise IdentityError(f"unsafe archive member path: {name!r}")
    if pure.parts and re.match(r"^[A-Za-z]:$", pure.parts[0]):
        raise IdentityError(f"drive-qualified archive member path: {name!r}")
    return pure.as_posix()


def _canonical_json_bytes(data: Any) -> bytes:
    return json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _manifest_metadata(manifest: dict[str, Any]) -> tuple[str, str, str]:
    project = manifest.get("project", {})
    patch = manifest.get("patch", {})
    project_key = ""
    if isinstance(project, dict) and project.get("key") not in (None, ""):
        project_key = validate_project_key(project.get("key"))
    patch_id = str(patch.get("id", "")).strip() if isinstance(patch, dict) else ""
    version = str(patch.get("version", "")).strip() if isinstance(patch, dict) else ""
    return project_key, patch_id, version


def _legacy_finish_info(
    path: Path,
    *,
    payloads: list[tuple[str, str]],
    all_members: list[tuple[str, str]],
    detection: str,
) -> dict[str, Any]:
    if not payloads:
        return _finish_info(path, manifest={}, payloads=[], reason="legacy package has no executable Python patch")
    digest = hashlib.sha256()
    digest.update(b"PATCH-TOOL-LEGACY-V4-CANONICAL-v1\0")
    for name, content_sha256 in sorted(all_members or payloads, key=lambda item: item[0]):
        digest.update(b"\0MEMBER\0")
        digest.update(name.encode("utf-8", "surrogateescape"))
        digest.update(b"\0")
        digest.update(bytes.fromhex(content_sha256))
    return {
        "path": path,
        "is_patch": True,
        "reason": "legacy Patch Tool v4 package",
        "manifest": {},
        "project_key": "",
        "patch_id": path.name,
        "version": "v4-legacy",
        "fingerprint": digest.hexdigest(),
        "payload_members": [name for name, _ in payloads],
        "command_only": False,
        "legacy_v4": True,
        "package_format": "legacy_v4",
        "legacy_detection": detection,
        "project_scope_verified": False,
    }


def _finish_info(path: Path, *, manifest: dict[str, Any], payloads: list[tuple[str, str]], reason: str = "") -> dict[str, Any]:
    if reason:
        return {
            "path": path, "is_patch": False, "reason": reason, "manifest": manifest,
            "project_key": "", "patch_id": "", "version": "", "fingerprint": "", "payload_members": [],
            "legacy_v4": False, "package_format": "unknown", "project_scope_verified": False,
        }
    if not manifest:
        return _finish_info(path, manifest={}, payloads=[], reason=f"missing root {MANIFEST_NAME}")
    post_patch = manifest.get("post_patch", {})
    command_only = (
        isinstance(post_patch, dict)
        and isinstance(post_patch.get("commands", []), list)
        and len(post_patch.get("commands", [])) > 0
    )
    if not payloads and not command_only:
        return _finish_info(
            path, manifest=manifest, payloads=[],
            reason=f"missing patch payload ({OPS_NAME} or patch_*.py) and no command-only request",
        )
    names = [name for name, _ in payloads]
    has_ops = OPS_NAME in names
    has_scripts = any(PATCH_SCRIPT_RE.search(name) for name in names)
    if has_ops and has_scripts:
        return _finish_info(path, manifest=manifest, payloads=[], reason="contains both data-only and Python patch payloads")
    project_key, patch_id, version = _manifest_metadata(manifest)
    digest = hashlib.sha256()
    digest.update(b"PATCH-TOOL-CANONICAL-PACKAGE-v1\0")
    digest.update(_canonical_json_bytes(manifest))
    for name, content_sha256 in sorted(payloads, key=lambda item: item[0]):
        digest.update(b"\0MEMBER\0")
        digest.update(name.encode("utf-8", "surrogateescape"))
        digest.update(b"\0")
        digest.update(bytes.fromhex(content_sha256))
    return {
        "path": path,
        "is_patch": True,
        "reason": "",
        "manifest": manifest,
        "project_key": project_key,
        "patch_id": patch_id,
        "version": version,
        "fingerprint": digest.hexdigest(),
        "payload_members": names if names else ["<command-only>"],
        "command_only": command_only,
        "legacy_v4": False,
        "package_format": "v5_manifest",
        "project_scope_verified": bool(project_key),
    }


def _stream_sha256_and_prefix(handle: Any, *, prefix_bytes: int = 256 * 1024) -> tuple[str, bytes]:
    digest = hashlib.sha256()
    prefix = bytearray()
    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
        digest.update(chunk)
        if len(prefix) < prefix_bytes:
            prefix.extend(chunk[: prefix_bytes - len(prefix)])
    return digest.hexdigest(), bytes(prefix)


def _looks_like_legacy_v4_script(name: str, prefix: bytes) -> bool:
    if PATCH_SCRIPT_RE.search(name):
        return True
    compact = prefix.replace(b" ", b"").replace(b"\t", b"")
    marker_hits = sum(1 for marker in LEGACY_V4_MARKERS if marker.replace(b" ", b"") in compact)
    return marker_hits >= 2 or (b"python_patch_utils" in prefix and b"run_patch" in prefix)


def _looks_like_handoff_or_tool_archive(path: Path, member_names: list[str]) -> bool:
    upper_name = path.name.upper()
    if any(marker in upper_name for marker in (
        "AI_HANDOFF", "AI_SUMMARY", "CODE_CONTEXT", "_DETAIL", "REPORT", "PYTHON_PATCH_TOOL_V5",
    )):
        return True
    normalized = {name.replace("\\", "/").upper() for name in member_names}
    strong_members = {
        "START_HERE.MD", "DETAIL_INDEX.MD", "AI_REQUEST_TEMPLATE.TXT",
        "ROOT_CAUSES.MD", "DIAGNOSTICS.JSON", "SUMMARY.JSON",
    }
    if normalized & strong_members:
        return True
    if any(name.startswith(("AI_SUMMARY/", "CODE_CONTEXT/", "TRANSACTION/")) for name in normalized):
        return True
    if any(name.startswith("TOOLS/_PATCH_LIB/") for name in normalized):
        return True
    return False


def _archive_name_allows_v4_fallback(path: Path) -> bool:
    stem = path.name.casefold()
    return stem.startswith("patch") or "_patch" in stem or "patch_" in stem or "legacy_v4" in stem


def _stream_sha256(handle: Any) -> str:
    digest = hashlib.sha256()
    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
        digest.update(chunk)
    return digest.hexdigest()


def _file_sha256(path: Path) -> str:
    with path.open("rb") as handle:
        return _stream_sha256(handle)


def inspect_patch_candidate(path: Path, *, max_manifest_bytes: int = 2 * 1024 * 1024, max_payload_hash_bytes: int = 512 * 1024 * 1024) -> dict[str, Any]:
    """Inspect without executing, including manifestless Patch Tool v4 packages."""
    lower = path.name.lower()
    try:
        if lower.endswith(".py"):
            raw_prefix = path.read_bytes()[:256 * 1024]
            if not _looks_like_legacy_v4_script(path.name, raw_prefix):
                return _finish_info(
                    path, manifest={}, payloads=[],
                    reason="standalone Python file is not named patch_*.py and has no recognizable v4 helper markers",
                )
            digest = hashlib.sha256(b"PATCH-TOOL-STANDALONE-v1\0" + bytes.fromhex(_file_sha256(path))).hexdigest()
            return {
                "path": path, "is_patch": True, "reason": "legacy standalone Python patch",
                "manifest": {}, "project_key": "", "patch_id": path.stem,
                "version": "v4-legacy", "fingerprint": digest, "payload_members": [path.name],
                "legacy_v4": True, "package_format": "legacy_v4_standalone",
                "legacy_detection": "standalone_python", "project_scope_verified": False,
            }

        manifest: dict[str, Any] = {}
        v5_payloads: list[tuple[str, str]] = []
        python_payloads: list[tuple[str, str]] = []
        all_members: list[tuple[str, str]] = []
        legacy_candidates: list[tuple[str, str]] = []
        total_payload = 0
        if lower.endswith(".zip"):
            with zipfile.ZipFile(path, "r") as zf:
                seen: set[str] = set()
                for info in zf.infolist():
                    name = _safe_member(info.filename)
                    if name in seen:
                        raise IdentityError(f"duplicate archive member: {name}")
                    seen.add(name)
                    if info.is_dir():
                        continue
                    if name == MANIFEST_NAME:
                        if info.file_size > max_manifest_bytes:
                            raise IdentityError("patch manifest exceeds inspection size limit")
                        raw = zf.read(info)
                        data = json.loads(raw.decode("utf-8"))
                        if not isinstance(data, dict):
                            raise IdentityError("patch manifest is not a JSON object")
                        manifest = data
                        all_members.append((name, hashlib.sha256(raw).hexdigest()))
                        continue
                    total_payload += info.file_size
                    if total_payload > max_payload_hash_bytes:
                        raise IdentityError("archive inspection exceeds hash limit")
                    with zf.open(info, "r") as source:
                        member_hash, prefix = _stream_sha256_and_prefix(source)
                    all_members.append((name, member_hash))
                    if name == OPS_NAME or PATCH_SCRIPT_RE.search(name):
                        v5_payloads.append((name, member_hash))
                    if name.lower().endswith(".py"):
                        python_payloads.append((name, member_hash))
                        if _looks_like_legacy_v4_script(name, prefix):
                            legacy_candidates.append((name, member_hash))
        elif lower.endswith((".tar.gz", ".tgz")):
            with tarfile.open(path, "r:gz") as tf:
                seen: set[str] = set()
                for member in tf.getmembers():
                    name = _safe_member(member.name)
                    if name in seen:
                        raise IdentityError(f"duplicate archive member: {name}")
                    seen.add(name)
                    if not member.isfile():
                        continue
                    total_payload += member.size
                    if total_payload > max_payload_hash_bytes:
                        raise IdentityError("archive inspection exceeds hash limit")
                    source = tf.extractfile(member)
                    if source is None:
                        raise IdentityError(f"cannot read archive member: {name}")
                    with source:
                        member_hash, prefix = _stream_sha256_and_prefix(source)
                    all_members.append((name, member_hash))
                    if name == MANIFEST_NAME:
                        if member.size > max_manifest_bytes:
                            raise IdentityError("patch manifest exceeds inspection size limit")
                        # The manifest is small, so re-open it for parsing.
                        parsed = tf.extractfile(member)
                        if parsed is None:
                            raise IdentityError(f"cannot re-read archive member: {name}")
                        with parsed:
                            data = json.loads(parsed.read().decode("utf-8"))
                        if not isinstance(data, dict):
                            raise IdentityError("patch manifest is not a JSON object")
                        manifest = data
                    elif name == OPS_NAME or PATCH_SCRIPT_RE.search(name):
                        v5_payloads.append((name, member_hash))
                    if name.lower().endswith(".py"):
                        python_payloads.append((name, member_hash))
                        if _looks_like_legacy_v4_script(name, prefix):
                            legacy_candidates.append((name, member_hash))
        else:
            return _finish_info(path, manifest={}, payloads=[], reason="unsupported file type")

        if manifest:
            return _finish_info(path, manifest=manifest, payloads=v5_payloads)
        member_names = [name for name, _ in all_members]
        if _looks_like_handoff_or_tool_archive(path, member_names):
            return _finish_info(
                path, manifest={}, payloads=[],
                reason="archive matches AI handoff/report/tool signatures and is not an executable patch package",
            )
        if legacy_candidates:
            detection = "patch_*.py" if any(PATCH_SCRIPT_RE.search(name) for name, _ in legacy_candidates) else "v4_helper_markers"
            # v4 runs patch_*.py preferentially; if none exist it runs every Python file.
            executable = [item for item in python_payloads if PATCH_SCRIPT_RE.search(item[0])] or python_payloads
            return _legacy_finish_info(
                path, payloads=executable, all_members=all_members,
                detection=detection,
            )
        if (
            python_payloads
            and _archive_name_allows_v4_fallback(path)
            and not _looks_like_handoff_or_tool_archive(path, member_names)
        ):
            # Exact v4 fallback behavior for a patch-named package: when no
            # patch_*.py exists, execute all Python files in sorted path order.
            # Handoff/report/tool archives are excluded before this fallback.
            return _legacy_finish_info(
                path, payloads=python_payloads, all_members=all_members,
                detection="v4_fallback_all_python",
            )
        return _finish_info(path, manifest={}, payloads=[], reason=f"missing root {MANIFEST_NAME} and no recognizable v4 Python patch")
    except Exception as exc:
        return _finish_info(path, manifest={}, payloads=[], reason=f"invalid or non-patch package: {exc}")


def identity_path(project_root: Path, configured: str = ".python_patch_tool_project.json") -> Path:
    rel = Path(str(configured).replace("\\", "/"))
    if rel.is_absolute() or ".." in rel.parts:
        raise IdentityError("project_identity.identity_file must be a safe relative path")
    return project_root / rel


def load_project_identity(project_root: Path, configured: str = ".python_patch_tool_project.json") -> dict[str, Any]:
    path = identity_path(project_root, configured)
    if not path.exists():
        return {"exists": False, "path": path, "key": "", "data": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise IdentityError(f"cannot read local project identity {path.name}: {exc}") from exc
    if not isinstance(data, dict):
        raise IdentityError(f"local project identity {path.name} must contain one JSON object")
    key = validate_project_key(data.get("project_key"), "project_key")
    return {"exists": True, "path": path, "key": key, "data": data}


def adopt_project_identity(project_root: Path, key: str, *, source_patch: str, configured: str = ".python_patch_tool_project.json") -> dict[str, Any]:
    normalized = validate_project_key(key)
    path = identity_path(project_root, configured)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": 1,
        "project_key": normalized,
        "local_only": True,
        "adopted_from_patch": source_patch.replace("\\", "/"),
        "created_at": now_iso(),
        "note": "Machine-local identity. Git/source is authoritative; patch history is not synchronized or required.",
    }
    temp = path.with_name(path.name + ".tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(path)
    return {"exists": True, "path": path, "key": normalized, "data": payload, "adopted": True}


def history_path(project_root: Path, configured: str = "patchs/reports/.patch_tool_local_history/successful.jsonl") -> Path:
    rel = Path(str(configured).replace("\\", "/"))
    if rel.is_absolute() or ".." in rel.parts:
        raise IdentityError("local_history.file must be a safe relative path")
    return project_root / rel


def load_successful_fingerprints(project_root: Path, configured: str) -> set[str]:
    path = history_path(project_root, configured)
    if not path.exists():
        return set()
    result: set[str] = set()
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            data = json.loads(raw)
        except Exception:
            continue
        if isinstance(data, dict) and data.get("status") == "PASS" and isinstance(data.get("fingerprint"), str):
            result.add(data["fingerprint"])
    return result


def append_success_history(project_root: Path, configured: str, entry: dict[str, Any]) -> Path:
    path = history_path(project_root, configured)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = dict(entry)
    payload.update({"schema_version": 1, "status": "PASS", "finished_at": payload.get("finished_at") or now_iso()})
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n")
    return path
