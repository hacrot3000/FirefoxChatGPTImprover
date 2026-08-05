#!/usr/bin/env python3
"""Probe and optionally E2E-test FirefoxChatImprover across Firefox binaries."""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
E2E_RUNNER = ROOT / "tools" / "run_firefox_e2e.py"
MANIFEST = ROOT / "extension" / "manifest.json"


def parse_version(text: str) -> tuple[int, ...]:
    match = re.search(r"(\d+(?:\.\d+){0,3})", text)
    return tuple(int(part) for part in match.group(1).split(".")) if match else ()


def version_text(binary: Path) -> str:
    result = subprocess.run([str(binary), "--version"], text=True, capture_output=True, check=False)
    output = ((result.stdout or "") + (result.stderr or "")).strip()
    if result.returncode != 0 or not output:
        raise RuntimeError(output or f"exit {result.returncode}")
    return output


def normalize_entry(raw: Any, index: int) -> dict[str, Any]:
    if isinstance(raw, str):
        raw = {"binary": raw}
    if not isinstance(raw, dict):
        raise ValueError(f"Matrix entry {index + 1} must be a string or object.")
    binary = str(raw.get("binary") or "").strip()
    if not binary:
        raise ValueError(f"Matrix entry {index + 1} has no binary path.")
    name = str(raw.get("name") or Path(binary).name or f"firefox-{index + 1}")
    return {
        "name": name,
        "binary": binary,
        "required": bool(raw.get("required", True)),
        "requireNative": bool(raw.get("requireNative", False)),
    }


def load_config(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    entries = data.get("firefox") if isinstance(data, dict) else data
    if not isinstance(entries, list):
        raise ValueError("Matrix config must be a list or an object with a firefox list.")
    return [normalize_entry(item, index) for index, item in enumerate(entries)]


def cli_entries(values: list[str]) -> list[dict[str, Any]]:
    entries = []
    for index, value in enumerate(values):
        if "=" in value:
            name, binary = value.split("=", 1)
        else:
            name, binary = Path(value).name, value
        entries.append(normalize_entry({"name": name, "binary": binary}, index))
    return entries


def discover_entries() -> list[dict[str, Any]]:
    names = [
        ("stable", "firefox"),
        ("esr", "firefox-esr"),
        ("developer", "firefox-developer-edition"),
        ("nightly", "firefox-nightly"),
    ]
    entries = []
    seen: set[str] = set()
    for label, command in names:
        path = shutil.which(command)
        if not path:
            continue
        resolved = str(Path(path).resolve())
        if resolved in seen:
            continue
        seen.add(resolved)
        entries.append({"name": label, "binary": resolved, "required": False, "requireNative": False})
    return entries


def markdown_report(report: dict[str, Any]) -> str:
    lines = [
        "# FirefoxChatImprover Firefox compatibility matrix",
        "",
        f"Add-on version: **{report.get('addonVersion')}**  ",
        f"Manifest minimum: **Firefox {report.get('strictMinVersion')}**",
        "",
        "| Name | Binary | Firefox version | Probe | E2E | Native | Notes |",
        "|---|---|---|---|---|---|---|",
    ]
    for item in report.get("entries", []):
        notes = str(item.get("error") or item.get("notes") or "").replace("|", "\\|").replace("\n", " ")
        lines.append(
            "| {name} | `{binary}` | {version} | {probe} | {e2e} | {native} | {notes} |".format(
                name=item.get("name", ""),
                binary=item.get("binary", ""),
                version=item.get("versionText", "—"),
                probe=item.get("probeStatus", "—"),
                e2e=item.get("e2eStatus", "not-run"),
                native=item.get("nativeStatus", "not-run"),
                notes=notes,
            )
        )
    lines += ["", f"Overall: **{'PASS' if report.get('ok') else 'FAIL'}**", ""]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a Firefox binary compatibility matrix.")
    parser.add_argument("--config", help="JSON matrix config path.")
    parser.add_argument("--firefox", action="append", default=[], metavar="[NAME=]PATH")
    parser.add_argument("--discover", action="store_true", help="Add common Firefox binaries from PATH.")
    parser.add_argument("--probe-only", action="store_true", help="Read versions only; do not run E2E.")
    parser.add_argument("--web-ext", help="web-ext path forwarded to the E2E runner.")
    parser.add_argument("--timeout", type=int, default=90)
    parser.add_argument("--json-report", default="test-results/firefox-version-matrix.json")
    parser.add_argument("--markdown-report", default="test-results/firefox-version-matrix.md")
    parser.add_argument("--allow-empty", action="store_true", help="Return success when no Firefox binary is found.")
    args = parser.parse_args()

    entries: list[dict[str, Any]] = []
    if args.config:
        entries.extend(load_config(Path(args.config).expanduser().resolve()))
    entries.extend(cli_entries(args.firefox))
    if args.discover or not entries:
        entries.extend(discover_entries())

    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for entry in entries:
        key = str(Path(entry["binary"]).expanduser())
        if key in seen:
            continue
        seen.add(key)
        deduped.append(entry)
    entries = deduped

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    addon_version = str(manifest.get("version") or "")
    minimum_text = str(manifest.get("browser_specific_settings", {}).get("gecko", {}).get("strict_min_version", "0"))
    minimum = parse_version(minimum_text)
    results: list[dict[str, Any]] = []
    overall_ok = True

    if not entries and not args.allow_empty:
        print("FAIL: no Firefox binaries were configured or discovered.", file=sys.stderr)
        return 1

    report_dir = Path(args.json_report).expanduser().resolve().parent
    report_dir.mkdir(parents=True, exist_ok=True)

    for index, entry in enumerate(entries):
        item = dict(entry)
        binary = Path(entry["binary"]).expanduser().resolve()
        item["binary"] = str(binary)
        item["probeStatus"] = "fail"
        item["e2eStatus"] = "not-run"
        item["nativeStatus"] = "not-run"
        if not binary.is_file() or not os.access(binary, os.X_OK):
            item["error"] = "binary missing or not executable"
            if entry["required"]:
                overall_ok = False
            else:
                item["probeStatus"] = "skip"
            results.append(item)
            continue
        try:
            text = version_text(binary)
            parsed = parse_version(text)
            item["versionText"] = text
            item["parsedVersion"] = list(parsed)
            if parsed and minimum and parsed < minimum:
                raise RuntimeError(f"below manifest minimum {minimum_text}")
            item["probeStatus"] = "pass"
        except Exception as error:
            item["error"] = str(error)
            if entry["required"]:
                overall_ok = False
            results.append(item)
            continue

        if not args.probe_only:
            e2e_json = report_dir / f"firefox-e2e-{index + 1}-{re.sub(r'[^a-zA-Z0-9_.-]+', '-', entry['name'])}.json"
            command = [
                sys.executable,
                str(E2E_RUNNER),
                "--firefox",
                str(binary),
                "--timeout",
                str(args.timeout),
                "--json-report",
                str(e2e_json),
            ]
            if args.web_ext:
                command.extend(["--web-ext", args.web_ext])
            if entry.get("requireNative"):
                command.append("--require-native")
            run = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, check=False)
            item["e2eOutput"] = ((run.stdout or "") + (run.stderr or "")).strip()
            if e2e_json.is_file():
                e2e = json.loads(e2e_json.read_text(encoding="utf-8"))
                item["e2eReport"] = e2e
                item["e2eStatus"] = "pass" if e2e.get("ok") else "fail"
                item["nativeStatus"] = "pass" if e2e.get("nativeAvailable") else "skip"
            else:
                item["e2eStatus"] = "fail"
            if run.returncode != 0 or item["e2eStatus"] != "pass":
                overall_ok = False
                item["error"] = item.get("error") or f"E2E exited {run.returncode}"
        results.append(item)

    report = {
        "ok": overall_ok,
        "addonVersion": addon_version,
        "strictMinVersion": minimum_text,
        "probeOnly": bool(args.probe_only),
        "entries": results,
    }
    json_path = Path(args.json_report).expanduser().resolve()
    markdown_path = Path(args.markdown_report).expanduser().resolve()
    json_path.parent.mkdir(parents=True, exist_ok=True)
    markdown_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    markdown_path.write_text(markdown_report(report), encoding="utf-8")

    for item in results:
        print(
            f"{item.get('name')}: probe={item.get('probeStatus')} e2e={item.get('e2eStatus')} "
            f"native={item.get('nativeStatus')} version={item.get('versionText', '—')}"
        )
        if item.get("error"):
            print(f"  {item['error']}")
    print(f"{'PASS' if overall_ok else 'FAIL'}: Firefox version matrix -> {json_path}")
    return 0 if overall_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
