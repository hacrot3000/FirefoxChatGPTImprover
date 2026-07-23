#!/usr/bin/env python3
"""Optional standalone fallback watcher for FirefoxChatImprover managed downloads.

The integrated extension uses Native Messaging. This utility is for manual use when
someone wants to watch the FirefoxChatImprover staging directory and relocate files
without keeping Firefox connected to the Native Host.
"""
from __future__ import annotations

import argparse
import os
import shutil
import signal
import sys
import time
from pathlib import Path

STOP = False


def stop_handler(_signum: int, _frame: object) -> None:
    global STOP
    STOP = True


def unique_path(path: Path) -> Path:
    if not path.exists():
        return path
    stem, suffix = path.stem, path.suffix
    for index in range(2, 100000):
        candidate = path.with_name(f"{stem} ({index}){suffix}")
        if not candidate.exists():
            return candidate
    raise RuntimeError(f"Could not create a unique destination for {path.name}")


def destination_path(directory: Path, filename: str, conflict: str) -> Path:
    target = directory / filename
    if not target.exists():
        return target
    if conflict == "overwrite":
        if target.is_dir():
            raise RuntimeError(f"Destination is a directory: {target}")
        target.unlink()
        return target
    if conflict == "fail":
        raise FileExistsError(f"Destination already exists: {target}")
    return unique_path(target)


def stable_file(path: Path, observations: dict[Path, tuple[int, int]]) -> bool:
    try:
        size = path.stat().st_size
    except OSError:
        return False
    previous_size, count = observations.get(path, (-1, 0))
    count = count + 1 if size == previous_size else 0
    observations[path] = (size, count)
    return count >= 2


def main() -> int:
    downloads = Path(os.environ.get("XDG_DOWNLOAD_DIR", Path.home() / "Downloads")).expanduser()
    parser = argparse.ArgumentParser(description="Relocate completed FirefoxChatImprover staged downloads.")
    parser.add_argument("--source", type=Path, default=downloads / "FirefoxChatImprover")
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--conflict", choices=("uniquify", "overwrite", "fail"), default="uniquify")
    parser.add_argument("--poll-seconds", type=float, default=1.0)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()

    source = args.source.expanduser().resolve()
    destination = args.destination.expanduser()
    if not destination.is_absolute():
        parser.error("--destination must be an absolute path")
    destination.mkdir(parents=True, exist_ok=True)
    destination = destination.resolve()
    source.mkdir(parents=True, exist_ok=True)

    signal.signal(signal.SIGINT, stop_handler)
    signal.signal(signal.SIGTERM, stop_handler)
    observations: dict[Path, tuple[int, int]] = {}
    print(f"Watching: {source}", flush=True)
    print(f"Destination: {destination}", flush=True)

    while not STOP:
        moved = 0
        for path in sorted(source.rglob("*")):
            if not path.is_file() or path.name.endswith((".part", ".tmp", ".download")):
                continue
            if not stable_file(path, observations):
                continue
            try:
                target = destination_path(destination, path.name, args.conflict)
                shutil.move(str(path), str(target))
                observations.pop(path, None)
                moved += 1
                print(f"MOVED\t{path}\t{target}", flush=True)
            except Exception as exc:  # keep watcher alive for other files
                print(f"ERROR\t{path}\t{exc}", file=sys.stderr, flush=True)
        for directory in sorted((item for item in source.rglob("*") if item.is_dir()), reverse=True):
            try:
                directory.rmdir()
            except OSError:
                pass
        if args.once:
            return 0 if moved else 1
        time.sleep(max(0.1, args.poll_seconds))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
