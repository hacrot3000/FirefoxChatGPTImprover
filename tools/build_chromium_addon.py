#!/usr/bin/env python3
"""Build a Chrome/Edge-compatible Manifest V3 package from the shared source tree."""
from __future__ import annotations

import argparse
import base64
import binascii
import datetime as dt
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import zipfile
import zlib

PROJECT_ROOT = Path(__file__).resolve().parents[1]
EXTENSION_ROOT = PROJECT_ROOT / "extension"
KEY_PATH = EXTENSION_ROOT / "chromium" / "manifest_key.txt"
DEFAULT_RELEASES = PROJECT_ROOT / "releases" / "chromium"
BROWSERS = ("chromium", "chrome", "edge")
EXTENSION_COMMAND = "fci-open-side-panel"
FIREFOX_SIDEBAR_COMMAND = "_execute_sidebar_action"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_key() -> tuple[str, bytes]:
    key_text = "".join(KEY_PATH.read_text(encoding="utf-8").split())
    try:
        key_der = base64.b64decode(key_text, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError(f"invalid Chromium manifest key: {KEY_PATH}") from exc
    if len(key_der) < 128:
        raise ValueError("Chromium manifest key is unexpectedly short")
    return key_text, key_der


def extension_id_from_key(key_der: bytes) -> str:
    prefix = hashlib.sha256(key_der).hexdigest()[:32]
    return "".join(chr(ord("a") + int(character, 16)) for character in prefix)


def chromium_manifest(source: dict, key_text: str, browser_name: str) -> dict:
    permissions = [item for item in source.get("permissions", []) if item != "webRequestBlocking"]
    if "sidePanel" not in permissions:
        permissions.append("sidePanel")
    commands = dict(source.get("commands", {}))
    open_sidebar = commands.pop(FIREFOX_SIDEBAR_COMMAND, {})
    commands = {
        EXTENSION_COMMAND: {
            "suggested_key": open_sidebar.get("suggested_key", {
                "default": "Ctrl+Shift+Y",
                "mac": "Command+Shift+Y",
            }),
            "description": "Open ChatAI Assistant side panel",
        },
        **commands,
    }
    icons = {
        "16": "icons/chromium-icon-16.png",
        "32": "icons/chromium-icon-32.png",
        "48": "icons/chromium-icon-48.png",
        "128": "icons/chromium-icon-128.png",
    }
    action = dict(source.get("action", {}))
    action["default_title"] = "Open and activate ChatAI Assistant"
    action["default_icon"] = icons
    manifest = {
        "manifest_version": 3,
        "name": "ChatAI Assistant for Chrome and Edge",
        "version": source["version"],
        "description": "Per-tab ChatAI automation with prompt templates, managed downloads, command logs and Native Host actions.",
        "minimum_chrome_version": "116",
        "key": key_text,
        "permissions": permissions,
        "optional_host_permissions": source.get("optional_host_permissions", ["*://*/*"]),
        "action": action,
        "background": {"service_worker": "background/chromium_service_worker.js"},
        "side_panel": {"default_path": "sidebar/sidebar.html"},
        "icons": icons,
        "content_security_policy": source.get("content_security_policy", {
            "extension_pages": "script-src 'self'; object-src 'none';"
        }),
        "commands": commands,
    }
    # Kept only in release.json; Chrome and Edge use the same extension package.
    manifest["version_name"] = f"{source['version']} ({browser_name})"
    return manifest


def copy_source(destination: Path) -> None:
    def ignore(path: str, names: list[str]) -> set[str]:
        ignored = {name for name in names if name in {"__pycache__", ".DS_Store"} or name.endswith((".pyc", ".pyo"))}
        if Path(path).resolve() == EXTENSION_ROOT.resolve():
            ignored.add("chromium")
        return ignored

    shutil.copytree(EXTENSION_ROOT, destination, ignore=ignore)


def png_chunk(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)


def icon_pixel(size: int, x: int, y: int) -> tuple[int, int, int, int]:
    green = (35, 134, 54, 255)
    white = (255, 255, 255, 255)
    transparent = (0, 0, 0, 0)
    radius = max(2, round(size * 0.1875))
    dx = max(radius - x - 1, 0, x - (size - radius))
    dy = max(radius - y - 1, 0, y - (size - radius))
    if dx * dx + dy * dy > radius * radius:
        return transparent
    color = green
    left, right = round(size * 0.1875), round(size * 0.8125)
    top, bottom = round(size * 0.242), round(size * 0.633)
    tail_left, tail_right = round(size * 0.3125), round(size * 0.477)
    tail_bottom = round(size * 0.789)
    in_bubble = left <= x <= right and top <= y <= bottom
    in_tail = bottom <= y <= tail_bottom and tail_left <= x <= tail_right and x <= tail_right - (y - bottom)
    if in_bubble or in_tail:
        color = white
    dot_y = round(size * 0.438)
    dot_radius = max(1, round(size * 0.047))
    for center_x in (round(size * 0.375), round(size * 0.5), round(size * 0.625)):
        if (x - center_x) ** 2 + (y - dot_y) ** 2 <= dot_radius ** 2:
            color = green
    return color


def write_png(path: Path, size: int) -> None:
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            rows.extend(icon_pixel(size, x, y))
    payload = b"\x89PNG\r\n\x1a\n"
    payload += png_chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    payload += png_chunk(b"IDAT", zlib.compress(bytes(rows), 9))
    payload += png_chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)


def deterministic_zip(source_dir: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(item for item in source_dir.rglob("*") if item.is_file()):
            relative = path.relative_to(source_dir).as_posix()
            info = zipfile.ZipInfo(relative, date_time=(2026, 8, 6, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (0o755 if path.suffix in {".sh", ".py"} else 0o644) << 16
            archive.writestr(info, path.read_bytes())


def validate_unpacked(unpacked: Path, expected_version: str, expected_id: str) -> None:
    manifest = json.loads((unpacked / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("version") != expected_version:
        raise ValueError("generated Chromium manifest has the wrong version")
    if manifest.get("background") != {"service_worker": "background/chromium_service_worker.js"}:
        raise ValueError("generated Chromium manifest does not use the service worker")
    if manifest.get("side_panel", {}).get("default_path") != "sidebar/sidebar.html":
        raise ValueError("generated Chromium manifest does not define the side panel")
    if "sidePanel" not in manifest.get("permissions", []) or "webRequestBlocking" in manifest.get("permissions", []):
        raise ValueError("generated Chromium permissions are invalid")
    if FIREFOX_SIDEBAR_COMMAND in manifest.get("commands", {}) or EXTENSION_COMMAND not in manifest.get("commands", {}):
        raise ValueError("generated Chromium command mapping is invalid")
    _key_text, key_der = load_key()
    if extension_id_from_key(key_der) != expected_id:
        raise ValueError("generated Chromium extension ID is unstable")
    for size in (16, 32, 48, 128):
        icon = unpacked / f"icons/chromium-icon-{size}.png"
        if not icon.read_bytes().startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError(f"invalid generated Chromium PNG icon: {icon.name}")
    if (unpacked / "chromium").exists():
        raise ValueError("build-only Chromium key files leaked into the extension package")


def run_tests() -> None:
    subprocess.run([str(PROJECT_ROOT / "tools" / "test_firefox_addon.sh")], cwd=PROJECT_ROOT, check=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", choices=BROWSERS, default="chromium")
    parser.add_argument("--releases-dir", type=Path, default=DEFAULT_RELEASES)
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--skip-tests", action="store_true")
    parser.add_argument("--print-extension-id", action="store_true")
    args = parser.parse_args(argv)

    key_text, key_der = load_key()
    extension_id = extension_id_from_key(key_der)
    if args.print_extension_id:
        print(extension_id)
        return 0

    source_manifest = json.loads((EXTENSION_ROOT / "manifest.json").read_text(encoding="utf-8"))
    version = str(source_manifest.get("version", ""))
    try:
        version_tuple = tuple(int(part) for part in version.split("."))
    except ValueError as exc:
        raise ValueError(f"Invalid extension version: {version or '<missing>'}") from exc
    if len(version_tuple) != 3 or version_tuple < (0, 39, 0):
        raise ValueError(f"Chromium build requires extension 0.39.0 or newer, found {version or '<missing>'}")
    if not args.skip_tests:
        run_tests()

    release_dir = args.releases_dir.expanduser().resolve() / args.browser / version
    if release_dir.exists() and any(release_dir.iterdir()):
        if not args.overwrite:
            raise ValueError(f"release exists: {release_dir}; pass --overwrite")
        shutil.rmtree(release_dir)
    release_dir.mkdir(parents=True, exist_ok=True)
    unpacked = release_dir / "unpacked"
    copy_source(unpacked)
    manifest = chromium_manifest(source_manifest, key_text, args.browser)
    (unpacked / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for size in (16, 32, 48, 128):
        write_png(unpacked / f"icons/chromium-icon-{size}.png", size)
    validate_unpacked(unpacked, version, extension_id)

    artifact = release_dir / f"chatai-assistant-{args.browser}-{version}.zip"
    deterministic_zip(unpacked, artifact)
    checksum = sha256_file(artifact)
    metadata = {
        "schemaVersion": 1,
        "target": args.browser,
        "name": manifest["name"],
        "version": version,
        "minimumChromeVersion": manifest["minimum_chrome_version"],
        "extensionId": extension_id,
        "builtAtUtc": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "artifact": {"filename": artifact.name, "sha256": checksum, "kind": "unpacked-compatible-source-archive"},
        "nativeHost": {
            "name": "com.duongtc.firefox_chat_assistant",
            "version": "0.13.0",
            "allowedOrigin": f"chrome-extension://{extension_id}/",
        },
    }
    (release_dir / "release.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (release_dir / "SHA256SUMS").write_text(f"{checksum}  {artifact.name}\n", encoding="utf-8")

    print(f"DONE: Chromium target={args.browser} version={version}")
    print(f"Extension ID : {extension_id}")
    print(f"Unpacked     : {unpacked}")
    print(f"Artifact     : {artifact}")
    print(f"SHA-256      : {checksum}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
