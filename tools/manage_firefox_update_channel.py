#!/usr/bin/env python3
"""Prepare, verify, enable or disable the Firefox self-hosted update channel.

The command refuses to enable an update_url until the hosted updates.json and
signed XPI are mutually consistent, unless --offline is supplied explicitly.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
from typing import Any
from urllib.parse import urlparse
from urllib.request import Request, urlopen
import zipfile

PROJECT_ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = PROJECT_ROOT / "extension" / "manifest.json"
DEFAULT_OUTPUT = PROJECT_ROOT / "dist" / "update"


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"JSON root must be an object: {path}")
    return value


def write_json_atomic(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
        temporary = Path(stream.name)
    temporary.replace(path)


def validate_https(url: str, label: str) -> str:
    parsed = urlparse(str(url or ""))
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError(f"{label} must be an absolute HTTPS URL")
    return parsed.geturl()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def signed_xpi(path: Path) -> bool:
    if not path.is_file() or path.suffix.lower() != ".xpi":
        return False
    try:
        with zipfile.ZipFile(path) as archive:
            names = {name.upper() for name in archive.namelist()}
    except zipfile.BadZipFile:
        return False
    return any(name.startswith("META-INF/") and name.endswith((".RSA", ".EC")) for name in names)


def manifest_identity(manifest: dict[str, Any]) -> tuple[str, str, str]:
    gecko = manifest.get("browser_specific_settings", {}).get("gecko", {})
    addon_id = str(gecko.get("id") or "") if isinstance(gecko, dict) else ""
    version = str(manifest.get("version") or "")
    strict_min = str(gecko.get("strict_min_version") or "") if isinstance(gecko, dict) else ""
    if not addon_id or not version or not strict_min:
        raise ValueError("manifest id, version and strict_min_version are required")
    return addon_id, version, strict_min


def build_updates_json(manifest: dict[str, Any], xpi_url: str, xpi_sha256: str) -> dict[str, Any]:
    addon_id, version, strict_min = manifest_identity(manifest)
    return {
        "addons": {
            addon_id: {
                "updates": [{
                    "version": version,
                    "update_link": validate_https(xpi_url, "xpi_url"),
                    "update_hash": f"sha256:{xpi_sha256}",
                    "applications": {"gecko": {"strict_min_version": strict_min}},
                }]
            }
        }
    }


def update_entry(data: dict[str, Any], addon_id: str) -> dict[str, Any]:
    updates = data.get("addons", {}).get(addon_id, {}).get("updates", [])
    if not isinstance(updates, list) or not updates or not isinstance(updates[0], dict):
        raise ValueError(f"updates.json has no update entry for {addon_id}")
    return updates[0]


def fetch_bytes(url: str, timeout: float = 20.0) -> bytes:
    request = Request(validate_https(url, "URL"), headers={"User-Agent": "FirefoxChatImprover-update-validator/1"})
    with urlopen(request, timeout=timeout) as response:
        return response.read()


def verify_hosted_channel(manifest: dict[str, Any], update_url: str) -> dict[str, Any]:
    addon_id, version, strict_min = manifest_identity(manifest)
    raw = fetch_bytes(update_url)
    hosted = json.loads(raw.decode("utf-8"))
    if not isinstance(hosted, dict):
        raise ValueError("Hosted updates.json root must be an object")
    entry = update_entry(hosted, addon_id)
    if str(entry.get("version")) != version:
        raise ValueError(f"Hosted update version {entry.get('version')!r} does not match manifest {version}")
    link = validate_https(str(entry.get("update_link") or ""), "hosted update_link")
    expected_hash = str(entry.get("update_hash") or "")
    if not expected_hash.startswith("sha256:"):
        raise ValueError("Hosted update_hash must use sha256")
    hosted_min = str(entry.get("applications", {}).get("gecko", {}).get("strict_min_version") or "")
    if hosted_min != strict_min:
        raise ValueError(f"Hosted strict_min_version {hosted_min!r} does not match manifest {strict_min!r}")
    actual_hash = hashlib.sha256(fetch_bytes(link)).hexdigest()
    if expected_hash != f"sha256:{actual_hash}":
        raise ValueError("Hosted XPI SHA-256 does not match updates.json")
    return {"addonId": addon_id, "version": version, "updateUrl": update_url, "xpiUrl": link, "sha256": actual_hash}


def set_update_url(manifest: dict[str, Any], update_url: str | None) -> dict[str, Any]:
    result = json.loads(json.dumps(manifest))
    gecko = result.setdefault("browser_specific_settings", {}).setdefault("gecko", {})
    if update_url:
        gecko["update_url"] = validate_https(update_url, "update_url")
    else:
        gecko.pop("update_url", None)
    return result


def command_prepare(args: argparse.Namespace) -> int:
    xpi = args.xpi.expanduser().resolve()
    if not signed_xpi(xpi):
        raise ValueError("The XPI is missing a Mozilla signature under META-INF")
    manifest = load_json(MANIFEST_PATH)
    output = args.output.expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    xpi_hash = sha256_file(xpi)
    updates = build_updates_json(manifest, args.xpi_url, xpi_hash)
    write_json_atomic(output / "updates.json", updates)
    shutil.copy2(xpi, output / xpi.name)
    write_json_atomic(output / "channel.json", {
        "schemaVersion": 1,
        "updateUrl": validate_https(args.update_url, "update_url"),
        "xpiUrl": validate_https(args.xpi_url, "xpi_url"),
        "xpiFilename": xpi.name,
        "sha256": xpi_hash,
        "manifestVersion": manifest["version"],
    })
    print(f"Prepared: {output / 'updates.json'}")
    print(f"Signed XPI copy: {output / xpi.name}")
    print(f"SHA-256: {xpi_hash}")
    return 0


def command_verify(args: argparse.Namespace) -> int:
    manifest = load_json(MANIFEST_PATH)
    result = verify_hosted_channel(manifest, validate_https(args.update_url, "update_url"))
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


def command_enable(args: argparse.Namespace) -> int:
    update_url = validate_https(args.update_url, "update_url")
    manifest = load_json(MANIFEST_PATH)
    if not args.offline:
        verify_hosted_channel(manifest, update_url)
    backup = MANIFEST_PATH.with_suffix(".json.update-channel.bak")
    shutil.copy2(MANIFEST_PATH, backup)
    write_json_atomic(MANIFEST_PATH, set_update_url(manifest, update_url))
    print(f"Enabled update_url: {update_url}")
    print(f"Backup: {backup}")
    return 0


def command_disable(_args: argparse.Namespace) -> int:
    manifest = load_json(MANIFEST_PATH)
    write_json_atomic(MANIFEST_PATH, set_update_url(manifest, None))
    print("Disabled self-hosted update_url.")
    return 0


def command_status(_args: argparse.Namespace) -> int:
    manifest = load_json(MANIFEST_PATH)
    addon_id, version, strict_min = manifest_identity(manifest)
    gecko = manifest["browser_specific_settings"]["gecko"]
    print(json.dumps({
        "addonId": addon_id,
        "version": version,
        "strictMinVersion": strict_min,
        "enabled": bool(gecko.get("update_url")),
        "updateUrl": gecko.get("update_url"),
    }, indent=2, ensure_ascii=False))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    prepare = sub.add_parser("prepare", help="build deployment files from a Mozilla-signed XPI")
    prepare.add_argument("--xpi", type=Path, required=True)
    prepare.add_argument("--xpi-url", required=True)
    prepare.add_argument("--update-url", required=True)
    prepare.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    prepare.set_defaults(func=command_prepare)
    verify = sub.add_parser("verify", help="verify hosted updates.json and its signed XPI")
    verify.add_argument("--update-url", required=True)
    verify.set_defaults(func=command_verify)
    enable = sub.add_parser("enable", help="enable update_url after online verification")
    enable.add_argument("--update-url", required=True)
    enable.add_argument("--offline", action="store_true", help="skip remote verification explicitly")
    enable.set_defaults(func=command_enable)
    disable = sub.add_parser("disable", help="remove update_url from the manifest")
    disable.set_defaults(func=command_disable)
    status = sub.add_parser("status", help="show current channel state")
    status.set_defaults(func=command_status)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, KeyError, json.JSONDecodeError, zipfile.BadZipFile) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
