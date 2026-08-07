#!/usr/bin/env python3
"""Trusted validation selection and compact failure-history support for Patch Tool v5."""
from __future__ import annotations

import datetime as dt
import fnmatch
import hashlib
import json
from pathlib import Path
import re
from typing import Any

TOOL_VERSION = "5.16.0"


def _now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).astimezone().isoformat(timespec="seconds")


def _slug(value: str) -> str:
    text = re.sub(r"[^A-Za-z0-9._-]+", "_", value.strip()).strip("._-") or "patch"
    return text[:96]


def _path_matches(path: str, patterns: list[str]) -> bool:
    normalized = path.replace("\\", "/").lstrip("./")
    for raw in patterns:
        pattern = str(raw).replace("\\", "/").lstrip("./")
        if fnmatch.fnmatchcase(normalized, pattern):
            return True
        # Let **/ also match zero directory levels, which users usually expect.
        if "**/" in pattern and fnmatch.fnmatchcase(normalized, pattern.replace("**/", "")):
            return True
    return False


def select_validation_profiles(validation_cfg: dict[str, Any], changed_paths: list[str]) -> dict[str, Any]:
    """Select trusted validation profiles using project-owned path rules."""
    requested = list(validation_cfg.get("selected_profiles", []))
    selection = validation_cfg.get("selection", {}) if isinstance(validation_cfg.get("selection", {}), dict) else {}
    mode = str(selection.get("mode", "off"))
    rules = selection.get("rules", []) if isinstance(selection.get("rules", []), list) else []
    fallback = list(selection.get("fallback_profiles", [])) if isinstance(selection.get("fallback_profiles", []), list) else []
    matched_rules: list[dict[str, Any]] = []
    auto_profiles: list[str] = []

    if mode != "off":
        for rule in rules:
            if not isinstance(rule, dict):
                continue
            include = list(rule.get("include", []))
            exclude = list(rule.get("exclude", []))
            matched_paths = [
                path for path in changed_paths
                if _path_matches(path, include) and not _path_matches(path, exclude)
            ]
            if not matched_paths:
                continue
            profiles = [str(name) for name in rule.get("profiles", [])]
            for name in profiles:
                if name not in auto_profiles:
                    auto_profiles.append(name)
            matched_rules.append({
                "name": str(rule.get("name", "unnamed rule")),
                "profiles": profiles,
                "matched_paths": matched_paths[:100],
                "matched_path_count": len(matched_paths),
            })
        if not auto_profiles and changed_paths:
            auto_profiles.extend(name for name in fallback if name not in auto_profiles)

    if mode == "replace":
        selected = list(auto_profiles)
    else:
        selected = list(requested)
        if mode == "append":
            for name in auto_profiles:
                if name not in selected:
                    selected.append(name)

    return {
        "schema_version": 1,
        "mode": mode,
        "changed_paths": sorted(set(changed_paths)),
        "requested_profiles": requested,
        "auto_profiles": auto_profiles,
        "selected_profiles": selected,
        "fallback_profiles": fallback,
        "matched_rules": matched_rules,
        "status": "DISABLED" if mode == "off" else ("MATCHED" if matched_rules else ("FALLBACK" if auto_profiles else "NO_MATCH")),
    }


def write_validation_selection(output_dir: Path, result: dict[str, Any]) -> None:
    (output_dir / "validation_selection.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    lines = [
        "# Validation impact selection",
        "",
        f"Status: **{result.get('status', 'UNKNOWN')}**",
        f"Mode: `{result.get('mode', 'off')}`",
        f"Changed paths considered: {len(result.get('changed_paths', []))}",
        f"Requested profiles: {', '.join(result.get('requested_profiles', [])) or 'none'}",
        f"Automatically selected: {', '.join(result.get('auto_profiles', [])) or 'none'}",
        f"Final profiles: {', '.join(result.get('selected_profiles', [])) or 'none'}",
        "",
    ]
    for index, rule in enumerate(result.get("matched_rules", []), 1):
        lines += [
            f"## {index}. {rule.get('name', 'unnamed rule')}",
            "",
            f"- Profiles: {', '.join(rule.get('profiles', [])) or 'none'}",
            f"- Matching paths: {rule.get('matched_path_count', 0)}",
        ]
        lines += [f"  - `{path}`" for path in rule.get("matched_paths", [])[:20]]
        lines.append("")
    if not result.get("matched_rules"):
        lines.append("No path rule matched the patch delta.")
    (output_dir / "validation_selection.md").write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def _normalized_message(value: str) -> str:
    text = re.sub(r"0x[0-9a-fA-F]+", "<hex>", value)
    text = re.sub(r"\b\d{4,}\b", "<n>", text)
    text = re.sub(r"\s+", " ", text).strip().lower()
    return text[:1200]


def _cause_record(item: dict[str, Any]) -> dict[str, Any]:
    record = {
        "code": str(item.get("code", "PTV-RUNNER-001")),
        "kind": str(item.get("kind", "unknown")),
        "file": str(item.get("file", "")),
        "line": int(item.get("line", 0) or 0),
        "message": str(item.get("message", ""))[:2000],
        "evidence": str(item.get("evidence", ""))[:2000],
    }
    stable = "|".join((record["code"], record["kind"], record["file"], _normalized_message(record["message"]), _normalized_message(record["evidence"])))
    record["fingerprint"] = hashlib.sha256(stable.encode("utf-8", "replace")).hexdigest()[:20]
    return record


def _safe_read_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def build_failure_delta(
    *,
    reports_dir: Path,
    output_dir: Path,
    patch_key: str,
    status: str,
    mode: str,
    root_causes: dict[str, Any],
    validation: dict[str, Any],
    error: str,
    finished_at: str,
) -> dict[str, Any]:
    """Compare this run with the last compact failure for the same patch id."""
    history_dir = reports_dir / ".patch_tool_history"
    history_dir.mkdir(parents=True, exist_ok=True)
    key_hash = hashlib.sha256(patch_key.encode("utf-8", "replace")).hexdigest()[:12]
    history_path = history_dir / f"{_slug(patch_key)}_{key_hash}.json"
    state = _safe_read_json(history_path)
    previous = state.get("last_failure") if isinstance(state.get("last_failure"), dict) else None
    current_causes = [_cause_record(item) for item in root_causes.get("root_causes", []) if isinstance(item, dict)]
    current_map = {item["fingerprint"]: item for item in current_causes}
    previous_causes = previous.get("root_causes", []) if previous else []
    previous_map = {
        str(item.get("fingerprint", "")): item
        for item in previous_causes if isinstance(item, dict) and item.get("fingerprint")
    }
    new_ids = sorted(set(current_map) - set(previous_map))
    resolved_ids = sorted(set(previous_map) - set(current_map))
    retained_ids = sorted(set(previous_map) & set(current_map))
    previous_was_resolved = bool(previous and previous.get("resolved_at"))

    if mode != "APPLY":
        delta_status = "PREFLIGHT_ONLY"
    elif status == "FAIL":
        if not previous:
            delta_status = "FIRST_FAILURE"
        elif previous_was_resolved:
            delta_status = "FAILURE_AFTER_RESOLUTION"
        elif not new_ids and not resolved_ids:
            delta_status = "SAME_FAILURE"
        else:
            delta_status = "FAILURE_CHANGED"
    else:
        if previous and not previous_was_resolved:
            delta_status = "PREVIOUS_FAILURE_RESOLVED"
        elif previous:
            delta_status = "NO_ACTIVE_FAILURE"
        else:
            delta_status = "NO_PREVIOUS_FAILURE"

    result = {
        "schema_version": 1,
        "patch_key": patch_key,
        "status": delta_status,
        "current_run_status": status,
        "current_mode": mode,
        "previous_failure_at": previous.get("at", "") if previous else "",
        "previous_failure_resolved_at": previous.get("resolved_at", "") if previous else "",
        "new_causes": [current_map[key] for key in new_ids],
        "resolved_causes": [previous_map[key] for key in resolved_ids],
        "retained_causes": [current_map[key] for key in retained_ids],
        "current_root_causes": current_causes,
        "previous_root_causes": previous_causes,
        "validation_profiles": list(validation.get("selected_profiles", [])),
        "error": str(error)[:2000],
    }

    last_failure = previous
    if mode != "APPLY":
        last_failure = previous
    elif status == "FAIL":
        last_failure = {
            "at": finished_at,
            "resolved_at": "",
            "root_causes": current_causes,
            "validation_profiles": list(validation.get("selected_profiles", [])),
            "error": str(error)[:2000],
        }
    elif previous and not previous_was_resolved:
        last_failure = dict(previous)
        last_failure["resolved_at"] = finished_at

    new_state = {
        "schema_version": 1,
        "patch_key": patch_key,
        "updated_at": _now_iso(),
        "last_run": {
            "at": finished_at,
            "status": status,
            "mode": mode,
            "delta_status": delta_status,
            "root_causes": current_causes,
        },
        "last_failure": last_failure,
    }
    temp = history_path.with_suffix(".json.tmp")
    temp.write_text(json.dumps(new_state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(history_path)

    (output_dir / "failure_delta.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    lines = [
        "# Failure delta",
        "",
        f"Status: **{delta_status}**",
        f"Patch key: `{patch_key}`",
        f"Current run: **{status}** (`{mode}`)",
        f"Previous failure: `{result['previous_failure_at'] or 'none'}`",
        "",
        f"New causes: {len(result['new_causes'])}",
        f"Resolved causes: {len(result['resolved_causes'])}",
        f"Retained causes: {len(result['retained_causes'])}",
        "",
    ]
    for title, values in (("New", result["new_causes"]), ("Resolved", result["resolved_causes"]), ("Retained", result["retained_causes"])):
        if not values:
            continue
        lines += [f"## {title} root causes", ""]
        for item in values:
            location = item.get("file", "")
            if item.get("line"):
                location += f":{item['line']}"
            lines.append(f"- `{item.get('code')}` at `{location or '<unknown>'}` — {item.get('message', '')}")
        lines.append("")
    if delta_status == "PREFLIGHT_ONLY":
        lines.append("Preflight did not execute the patch and therefore did not resolve or replace stored apply-failure history.")
    elif delta_status == "SAME_FAILURE":
        lines.append("The primary failure is unchanged. Avoid resending unchanged raw logs; update the patch using current code context.")
    elif delta_status == "FAILURE_CHANGED":
        lines.append("Some previous causes were removed and new causes appeared. Focus the next AI turn on the new causes first.")
    elif delta_status == "PREVIOUS_FAILURE_RESOLVED":
        lines.append("The last recorded failure was resolved by this run.")
    (output_dir / "failure_delta.md").write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    return result
