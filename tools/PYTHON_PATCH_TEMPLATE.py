#!/usr/bin/env python3
"""Template for compact adaptive Python patches (mini-AI v3).

Copy this file to patchs/patch_<name>.py, set PATCH_NAME, then fill OPS.
Keep shared helpers in tools/python_patch_utils.py, not in patchs/.
"""

from pathlib import Path
import sys

PATCH_NAME = "example_patch"

PROJECT_ROOT = Path.cwd().resolve()
TOOLS_DIR = PROJECT_ROOT / "tools"
sys.path.insert(0, str(TOOLS_DIR))

from python_patch_utils import run_patch


OPS = [
    # Exact/auto replacement. mode="auto" tries exact -> variants -> whitespace -> fuzzy.
    # {
    #     "id": "change-example-block",
    #     "kind": "replace",
    #     "file": "relative/path/to/file.c",
    #     "anchor": "unique nearby function/comment",
    #     "old": """old block""",
    #     "new": """new block""",
    #     "mode": "auto",
    #     "on_error": "stop",  # stop | skip | ignore
    # },

    # If/then/else example:
    # {
    #     "id": "local-shape-dependent-change",
    #     "kind": "if",
    #     "condition": {
    #         "file": "relative/path/to/file.c",
    #         "contains": "local code shape A",
    #     },
    #     "then": [
    #         {"kind": "replace", "file": "relative/path/to/file.c", "old": "A", "new": "A'"},
    #     ],
    #     "else": [
    #         {"kind": "replace", "file": "relative/path/to/file.c", "old": "B", "new": "B'", "on_error": "skip"},
    #     ],
    # },
]


if __name__ == "__main__":
    raise SystemExit(run_patch(PATCH_NAME, OPS))
