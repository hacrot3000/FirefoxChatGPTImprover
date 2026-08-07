#!/usr/bin/env python3
from __future__ import annotations
import json, os, subprocess, sys, tempfile, zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
GUARD = HERE / "python_patch_selection_integrity_guard.py"


def mkzip(path: Path, text: str) -> None:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("payload.txt", text)


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="ptv5151_test_") as td:
        root = Path(td)
        patchs = root / "patchs"
        lib = root / "tools" / "_patch_lib"
        reports = patchs / "reports"
        ignored = patchs / "ignored" / "duplicate_success"
        patched = patchs / "patched"
        for d in (patchs, lib, reports, ignored, patched): d.mkdir(parents=True, exist_ok=True)
        a = patchs / "patch_A.zip"; b = patchs / "patch_B.zip"
        mkzip(a, "A"); mkzip(b, "B")
        runner = lib / "python_patch_runner.py"
        runner.write_text('''#!/usr/bin/env python3\nfrom pathlib import Path\nimport json, shutil\nr=Path.cwd(); p=r/"patchs"; rep=p/"reports"; ig=p/"ignored"/"duplicate_success"; pa=p/"patched"\npa.mkdir(parents=True, exist_ok=True); ig.mkdir(parents=True, exist_ok=True); rep.mkdir(parents=True, exist_ok=True)\n# Simulate v5.15.0 incident: only A executes, B is wrongly quarantined.\nshutil.move(str(p/"patch_A.zip"), str(pa/"patch_A.zip"))\nshutil.move(str(p/"patch_B.zip"), str(ig/"patch_B.zip"))\n(rep/"last_run.json").write_text(json.dumps({"executed":[{"name":"patch_A.zip","status":"PASS"}],"skipped":[{"name":"patch_B.zip","category":"duplicate_success"}]}))\n(rep/"LAST_RUN.md").write_text("PATCHES EXECUTED:\\n- patch_A.zip\\nPATCHES SKIPPED / NOT EXECUTED:\\n- patch_B.zip\\n")\nprint("simulated PASS")\n''')
        rc = subprocess.call([sys.executable, str(GUARD), "--project-root", str(root), "--runner", str(runner), "--"])
        assert rc == 0
        assert (patchs / "patch_B.zip").is_file(), "unexecuted B was not restored"
        assert not (ignored / "patch_B.zip").exists(), "false duplicate remained quarantined"
    print("PASS: Python Patch Tool v5.15.1 selection-integrity self-test")
    return 0

if __name__ == "__main__": raise SystemExit(main())
