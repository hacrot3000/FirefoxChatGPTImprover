#!/usr/bin/env python3
"""Template for compact adaptive Python patches (mini-AI v5.16).

Use this Python form only when PATCH_TOOL_OPS.json cannot express the required logic.
For normal replace/insert/write/conditional patches, prefer the data-only payload to reduce tokens
and eliminate Python syntax failures. Add PATCH_TOOL_MANIFEST.json at the ZIP root.
"""

from pathlib import Path
import sys

PATCH_NAME = "example_patch"

PROJECT_ROOT = Path.cwd().resolve()
LIB_DIR = PROJECT_ROOT / "tools" / "_patch_lib"
sys.path.insert(0, str(LIB_DIR))

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
