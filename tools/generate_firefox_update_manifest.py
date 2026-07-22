#!/usr/bin/env python3
"""Generate a Firefox self-hosted update manifest from a signed XPI."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys
from urllib.parse import urlparse

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def validate_https(url: str, label: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError(f"{label} must be an absolute HTTPS URL")


def build_update_manifest(
    *, addon_id: str, version: str, xpi_url: str, sha256: str, strict_min_version: str | None = None
) -> dict:
    update: dict = {
        "version": version,
        "update_link": xpi_url,
        "update_hash": f"sha256:{sha256}",
    }
    if strict_min_version:
        update["applications"] = {"gecko": {"strict_min_version": strict_min_version}}
    return {"addons": {addon_id: {"updates": [update]}}}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--xpi", type=Path, required=True, help="Mozilla-signed XPI")
    parser.add_argument("--xpi-url", required=True, help="public HTTPS URL of that exact XPI")
    parser.add_argument("--update-url", required=True, help="public HTTPS URL where updates.json will be hosted")
    parser.add_argument("--output", type=Path, default=PROJECT_ROOT / "dist" / "update" / "updates.json")
    args = parser.parse_args(argv)

    xpi = args.xpi.expanduser().resolve()
    if not xpi.is_file() or xpi.suffix.lower() != ".xpi":
        raise ValueError(f"signed XPI not found: {xpi}")
    validate_https(args.xpi_url, "--xpi-url")
    validate_https(args.update_url, "--update-url")

    manifest_path = PROJECT_ROOT / "extension" / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    gecko = manifest["browser_specific_settings"]["gecko"]
    output = args.output.expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    data = build_update_manifest(
        addon_id=gecko["id"],
        version=manifest["version"],
        xpi_url=args.xpi_url,
        sha256=sha256_file(xpi),
        strict_min_version=gecko.get("strict_min_version"),
    )
    output.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    fragment = output.with_name("manifest-update-url-fragment.json")
    fragment.write_text(json.dumps({"browser_specific_settings": {"gecko": {"update_url": args.update_url}}}, indent=2) + "\n", encoding="utf-8")
    print(f"DONE: {output}")
    print(f"Manifest fragment: {fragment}")
    print("Review and add update_url to extension/manifest.json only after both HTTPS files are reachable.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, KeyError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
