#!/usr/bin/env python3
"""End-to-end self-test for Python Patch Tool v5.16.0."""
from __future__ import annotations

import contextlib
import io
import json
import os
import signal
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import textwrap
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parent
TOOLS_ROOT = ROOT.parent
PACKAGE_ROOT = TOOLS_ROOT.parent
sys.path.insert(0, str(ROOT))
from python_patch_commands import (  # noqa: E402
    CommandPolicyError, normalize_manifest_request, normalize_policy, validate_command,
)
import python_patch_selector as patch_selector  # noqa: E402
from python_patch_selector import parse_selection_expression  # noqa: E402
from python_patch_runner import normalize_zero_argument_config  # noqa: E402
import python_patch_utils as patch_utils  # noqa: E402
INSTALLER = ROOT / "install_python_patch_tool_v5.py"
WRAPPER = TOOLS_ROOT / "run_python_patches.sh"
PYTHON = sys.executable


def run(command: list[str], cwd: Path, *, expect: int | None = 0, timeout: float = 90.0, input_text: str | None = None) -> subprocess.CompletedProcess[str]:
    process = subprocess.Popen(
        command, cwd=cwd, text=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    try:
        stdout, _ = process.communicate(input=input_text, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        try:
            os.killpg(process.pid, signal.SIGTERM)
            stdout, _ = process.communicate(timeout=3)
        except Exception:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except Exception:
                process.kill()
            stdout, _ = process.communicate()
        raise AssertionError(f"Command timed out after {timeout}s: {' '.join(command)}\n{stdout}") from exc
    result = subprocess.CompletedProcess(command, process.returncode, stdout, None)
    if expect is not None and result.returncode != expect:
        raise AssertionError(f"Command failed ({result.returncode}, expected {expect}): {' '.join(command)}\n{result.stdout}")
    return result


def git(root: Path, *args: str) -> str:
    return run(["git", *args], root).stdout.strip()


def manifest(patch_id: str, summary: str, *, validation: list[str] | None = None, git_cfg: dict | None = None) -> dict:
    data = {
        "schema_version": 1,
        "project": {"key": "patch-tool-self-test"},
        "patch": {
            "id": patch_id,
            "version": "v5.16.0",
            "phase": "Self-test / 1",
            "phase_under_test": patch_id,
            "summary": summary,
            "regression_scope": "Python Patch Tool v5.16 focused self-test.",
        },
        "git": git_cfg or {"add": "off", "commit": "off", "push": "off", "fail_on_error": True},
    }
    if validation is not None:
        data["validation"] = {"profiles": validation}
    return data


def make_zip(destination: Path, files: dict[str, str | bytes]) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    return destination


def json_text(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2) + "\n"


def newest(root: Path, pattern: str) -> Path:
    paths = sorted(root.glob(pattern), key=lambda p: p.stat().st_mtime_ns)
    if not paths:
        raise AssertionError(f"No report matched {pattern}")
    return paths[-1]


def zip_read(path: Path, name: str) -> str:
    with zipfile.ZipFile(path) as zf:
        return zf.read(name).decode("utf-8", "replace")


def zip_json(path: Path, name: str) -> dict:
    return json.loads(zip_read(path, name))


def assert_zip_ok(path: Path) -> None:
    with zipfile.ZipFile(path) as zf:
        bad = zf.testzip()
        if bad:
            raise AssertionError(f"Corrupt ZIP member {bad} in {path}")


def run_patch(project: Path, package: Path, *extra: str, expect_success: bool) -> subprocess.CompletedProcess[str]:
    result = run([str(project / "tools" / "run_python_patches.sh"), package.name, "--keep", *extra], project, expect=None)
    if expect_success and result.returncode != 0:
        raise AssertionError(result.stdout)
    if not expect_success and result.returncode == 0:
        raise AssertionError("Expected patch failure but command passed:\n" + result.stdout)
    return result


def main() -> int:
    required = [
        "python_patch_runner.py", "python_patch_utils.py", "python_patch_diagnostics.py",
        "python_patch_transaction.py", "python_patch_intelligence.py", "python_patch_identity.py",
        "python_patch_commands.py", "python_patch_selector.py", "python_patch_code_collector.py", "python_patch_decompile_extractor.py",
        "install_python_patch_tool_v5.py", "docs/PYTHON_PATCH_TOOL_FEATURE_STATUS.md",
        "docs/CODE_COLLECTION_GUIDE.md", "docs/PATCH_SELECTION_GUIDE.md", "docs/POST_PATCH_COMMANDS_GUIDE.md", "docs/LEGACY_V4_COMPATIBILITY.md", "docs/OUTPUT_FILES_GUIDE.md",
        "examples/CODE_COLLECTION_REQUEST.example.json", "examples/PATCH_TOOL_OPS.example.json",
        "SHA256SUMS",
    ]
    # The self-test may run inside a real project that already has source, runtime
    # directories and project-specific tools. Validate Patch Tool placement without
    # assuming the whole project root contains only release-package members.
    if TOOLS_ROOT.name != "tools" or ROOT.name != "_patch_lib":
        raise AssertionError(f"Unexpected portable layout: tools={TOOLS_ROOT}, lib={ROOT}")
    if not WRAPPER.is_file() or not INSTALLER.is_file():
        raise AssertionError("Missing portable wrapper or optional installer")
    if (ROOT / "run_python_patches.sh").exists():
        raise AssertionError("Public runner must not be nested inside tools/_patch_lib/")
    for name in required:
        if not (ROOT / name).is_file():
            raise AssertionError(f"Missing package library file: {name}")
    compile_files = [str(ROOT / name) for name in (
        "python_patch_runner.py", "python_patch_utils.py", "python_patch_diagnostics.py",
        "python_patch_transaction.py", "python_patch_intelligence.py", "python_patch_identity.py",
        "python_patch_commands.py", "python_patch_selector.py", "python_patch_code_collector.py", "python_patch_decompile_extractor.py",
        "install_python_patch_tool_v5.py",
    )]
    run([PYTHON, "-m", "py_compile", *compile_files], PACKAGE_ROOT)

    with tempfile.TemporaryDirectory(prefix="python_patch_tool_v513_selftest.") as temp:
        base = Path(temp)
        project = base / "project"
        project.mkdir()

        # Primary v5.16 workflow: extract/copy tools/ directly, then run immediately.
        shutil.copytree(TOOLS_ROOT, project / "tools")
        (project / "tools" / "run_python_patches.sh").chmod(0o755)
        help_run = run([str(project / "tools" / "run_python_patches.sh"), "help"], project)
        assert "Code research and collection" in help_run.stdout and "no installer required" in help_run.stdout
        layout_run = run([str(project / "tools" / "run_python_patches.sh"), "paths"], project)
        assert "tools/_patch_lib/" in layout_run.stdout
        idle_run = run([str(project / "tools" / "run_python_patches.sh")], project)
        assert "IDLE" in idle_run.stdout

        assert (project / "tools" / "run_python_patches.sh").is_file()
        assert not (project / "tools" / "_patch_lib" / "run_python_patches.sh").exists()
        for name in ("python_patch_runner.py", "python_patch_utils.py", "python_patch_diagnostics.py", "python_patch_transaction.py", "python_patch_intelligence.py", "python_patch_identity.py", "python_patch_commands.py", "python_patch_source_baseline.py", "python_patch_code_collector.py", "python_patch_decompile_extractor.py"):
            assert (project / "tools" / "_patch_lib" / name).is_file()
        assert (project / "tools" / "_patch_lib" / "docs" / "CODE_COLLECTION_GUIDE.md").is_file()
        assert (project / "tools" / "_patch_lib" / "examples" / "CODE_COLLECTION_REQUEST.example.json").is_file()
        loose_managed = ["python_patch_runner.py", "python_patch_utils.py", "python_patch_code_collector.py", "collect_code_for_ai.sh"]
        assert not any((project / "tools" / name).exists() for name in loose_managed)

        # Optional installer remains idempotent and creates the active config.
        install = run([PYTHON, str(project / "tools" / "_patch_lib" / "install_python_patch_tool_v5.py"), "--project-root", str(project)], project)
        assert "Package integrity: PASS" in install.stdout
        second = run([PYTHON, str(project / "tools" / "_patch_lib" / "install_python_patch_tool_v5.py"), "--project-root", str(project)], project)
        assert "KHÔNG CÓ THAY ĐỔI" in second.stdout

        assert (project / ".python_patch_tool.json").is_file()
        installed_config = json.loads((project / ".python_patch_tool.json").read_text(encoding="utf-8"))
        assert installed_config["automation"]["zero_argument"]["enabled"] is True
        assert installed_config["automation"]["zero_argument"]["selection"] == "prompt"
        assert installed_config["package_policy"]["allow_legacy_v4"] is True
        assert installed_config["reports"]["ai_handoff"]["split_compatibility_bundles"] is False
        # Most historical regression checks inspect standalone SUMMARY/CODE bundles.
        # Enable compatibility bundles for those checks while keeping the release default minimal.
        installed_config["reports"]["ai_handoff"]["split_compatibility_bundles"] = True
        installed_config["reports"]["ai_handoff"]["handoff_max_tokens"] = 100000
        installed_config["reports"]["ai_handoff"]["summary_max_tokens"] = 100000
        installed_config["reports"]["ai_handoff"]["code_max_tokens"] = 100000
        installed_config["reports"]["ai_handoff"]["per_text_file_max_tokens"] = 100000
        (project / ".python_patch_tool.json").write_text(json_text(installed_config), encoding="utf-8")
        v4_public_api = {
            "PatchFailure", "PatchStats", "PatchRunState", "find_project_root", "backup_path",
            "backup_file", "backup_file_once", "read_text", "write_text", "context_around_index",
            "context_around_pattern", "print_patch_error", "MatchSpan", "op_replace",
            "op_replace_any", "op_regex_replace", "op_insert", "op_append", "op_prepend",
            "op_write", "op_if", "op_first_success", "apply_ops", "print_summary",
            "zip_failed_files", "maybe_prompt_zip_failed_files", "run_patch",
            "replace_exact_once", "replace_ws_once", "replace_fuzzy_once",
            "insert_after_once", "insert_before_once", "write_file_if_changed",
            "finish_success", "finish_failure",
        }
        assert not sorted(name for name in v4_public_api if not hasattr(patch_utils, name))
        legacy_auto = normalize_zero_argument_config({"automation": {"zero_argument": {"selection": "all"}}})
        assert legacy_auto["selection"] == "prompt" and legacy_auto["automatic_selection_unconfirmed"] is True
        confirmed_auto = normalize_zero_argument_config({"automation": {"zero_argument": {"selection": "all", "non_interactive_confirmed": True}}})
        assert confirmed_auto["selection"] == "all" and confirmed_auto["automatic_selection_unconfirmed"] is False
        assert parse_selection_expression("1,3-4", 4) == {0, 2, 3}
        assert parse_selection_expression("a", 4) == {0, 1, 2, 3}
        selector_a = project / "patchs" / "selector_a.zip"
        selector_b = project / "patchs" / "selector_b.zip"
        selector_a.write_bytes(b"a")
        selector_b.write_bytes(b"b")
        selector_keys = iter(["SPACE", "DOWN", "SPACE", "ENTER"])
        original_read_key = patch_selector._read_key
        patch_selector._read_key = lambda: next(selector_keys)
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                selector_result = patch_selector._tty_select([selector_a, selector_b], project, set())
            assert [path.name for path in selector_result.selected] == ["selector_a.zip", "selector_b.zip"]
            assert selector_result.deleted == [] and not selector_result.cancelled
        finally:
            patch_selector._read_key = original_read_key
        selector_delete_keys = iter(["d", "y", "SPACE", "ENTER"])
        patch_selector._read_key = lambda: next(selector_delete_keys)
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                delete_result = patch_selector._tty_select([selector_a, selector_b], project, set())
            assert delete_result.deleted == ["patchs/selector_a.zip"]
            assert not selector_a.exists() and selector_b.exists()
            assert [path.name for path in delete_result.selected] == ["selector_b.zip"]
        finally:
            patch_selector._read_key = original_read_key
            selector_b.unlink(missing_ok=True)
        skipped_preview = [{
            "input": "patchs/already_passed.zip",
            "category": "duplicate_success",
            "reason": "same canonical patch payload already PASSed on this machine",
            "moved_to": "patchs/ignored/duplicate_success/already_passed.zip",
        }]
        preview_out = io.StringIO()
        with contextlib.redirect_stdout(preview_out):
            patch_selector._render_selector(["patchs/new_patch.zip"], 0, set(), skipped_before=skipped_preview)
        preview_text = preview_out.getvalue()
        assert "TỰ ĐỘNG BỎ QUA TRƯỚC KHI CHỌN (1)" in preview_text
        assert "SKIPPED:DUPLICATE - ALREADY PASS" in preview_text
        assert "patchs/already_passed.zip" in preview_text
        assert "patchs/ignored/duplicate_success/already_passed.zip" in preview_text
        assert installed_config["post_patch"]["allowed_basic_commands"] == ["ls", "tree", "pwd", "find"]
        git(project, "init", "-q")
        git(project, "config", "user.name", "Patch Tool Self Test")
        git(project, "config", "user.email", "patch-tool@example.invalid")
        (project / "src").mkdir()
        (project / "src" / "feature.c").write_text("int feature(void) {\n    old block\n}\n", encoding="utf-8")
        (project / "unrelated.txt").write_text("base\n", encoding="utf-8")
        git(project, "add", ".")
        git(project, "commit", "-qm", "Initial self-test repository")

        # v5.13 compatibility: execute real Patch Tool v4-style payloads without
        # requiring a v5 manifest/project key. These inputs remain explicitly
        # unscoped and never become a cross-machine patch-sequence constraint.
        active_cfg = json.loads((project / ".python_patch_tool.json").read_text(encoding="utf-8"))
        active_cfg.setdefault("package_policy", {})["require_manifest"] = True
        active_cfg["package_policy"]["require_standard_metadata"] = True
        active_cfg["package_policy"]["allow_legacy_v4"] = True
        (project / ".python_patch_tool.json").write_text(json_text(active_cfg), encoding="utf-8")

        legacy_standalone_target = project / "src" / "legacy_v4_standalone.txt"
        legacy_standalone_target.write_text("old\n", encoding="utf-8")
        legacy_standalone = project / "patchs" / "patch_legacy_v4_standalone.py"
        legacy_standalone.write_text(textwrap.dedent("""\
            #!/usr/bin/env python3
            from pathlib import Path
            import sys
            PROJECT_ROOT = Path.cwd().resolve()
            sys.path.insert(0, str(PROJECT_ROOT / "tools"))
            from python_patch_utils import run_patch
            OPS = [{"id": "legacy-standalone", "kind": "replace", "file": "src/legacy_v4_standalone.txt", "old": "old", "new": "new", "mode": "auto"}]
            if __name__ == "__main__":
                raise SystemExit(run_patch("legacy_v4_standalone", OPS))
        """), encoding="utf-8")
        legacy_standalone_run = run_patch(project, legacy_standalone, expect_success=True)
        assert "LEGACY_V4_COMPATIBILITY: TRUE" in legacy_standalone_run.stdout
        assert "PROJECT_SCOPE_VERIFIED: FALSE" in legacy_standalone_run.stdout
        assert legacy_standalone_target.read_text(encoding="utf-8") == "new\n"
        legacy_standalone.unlink()

        legacy_zip_target = project / "src" / "legacy_v4_zip.txt"
        legacy_zip_target.write_text("before\n", encoding="utf-8")
        legacy_zip_script = textwrap.dedent("""\
            #!/usr/bin/env python3
            from pathlib import Path
            import sys
            PROJECT_ROOT = Path.cwd().resolve()
            sys.path.insert(0, str(PROJECT_ROOT / "tools"))
            from python_patch_utils import run_patch
            OPS = [{"id": "legacy-zip", "kind": "replace", "file": "src/legacy_v4_zip.txt", "old": "before", "new": "after", "mode": "auto"}]
            if __name__ == "__main__":
                raise SystemExit(run_patch("legacy_v4_zip", OPS))
        """)
        legacy_zip_second = textwrap.dedent("""\
            from pathlib import Path
            import sys
            PROJECT_ROOT = Path.cwd().resolve()
            sys.path.insert(0, str(PROJECT_ROOT / "tools"))
            from python_patch_utils import run_patch
            OPS = [{"id": "legacy-zip-2", "kind": "replace", "file": "src/legacy_v4_zip.txt", "old": "after", "new": "after-two", "mode": "auto"}]
            if __name__ == "__main__":
                raise SystemExit(run_patch("legacy_v4_zip_2", OPS))
        """)
        legacy_zip = make_zip(project / "patchs" / "legacy_v4_nested_package.zip", {
            "phase_01/patch_legacy_v4_zip.py": legacy_zip_script,
            "phase_02/patch_legacy_v4_zip_second.py": legacy_zip_second,
            "resources/readme.txt": "v4 resource preserved for canonical fingerprint\n",
        })
        legacy_zip_run = run_patch(project, legacy_zip, expect_success=True)
        assert "Package format: legacy_v4" in legacy_zip_run.stdout
        assert legacy_zip_target.read_text(encoding="utf-8") == "after-two\n"
        legacy_zip_summary = zip_json(newest(project / "patchs" / "reports", "PTV_*_PASS_SUMMARY.zip"), "summary.json")
        assert legacy_zip_summary["package_format"] == "legacy_v4"
        assert legacy_zip_summary["legacy_v4_compatibility"]["enabled"] is True
        assert legacy_zip_summary["legacy_v4_compatibility"]["project_scope_verified"] is False
        legacy_zip.unlink()

        # v4 fallback rule: if no patch_*.py exists, execute all Python scripts.
        legacy_fallback_target = project / "src" / "legacy_v4_fallback.txt"
        legacy_fallback_target.write_text("alpha\n", encoding="utf-8")
        legacy_fallback_script = textwrap.dedent("""\
            from pathlib import Path
            import sys
            PROJECT_ROOT = Path.cwd().resolve()
            sys.path.insert(0, str(PROJECT_ROOT / "tools"))
            from python_patch_utils import run_patch
            PATCH_NAME = "legacy_v4_fallback"
            OPS = [{"kind": "replace", "file": "src/legacy_v4_fallback.txt", "old": "alpha", "new": "beta"}]
            if __name__ == "__main__":
                raise SystemExit(run_patch(PATCH_NAME, OPS))
        """)
        legacy_fallback_zip = make_zip(project / "patchs" / "legacy_v4_fallback_package.zip", {
            "steps/phase_one.py": legacy_fallback_script,
        })
        legacy_fallback_run = run_patch(project, legacy_fallback_zip, expect_success=True)
        assert "Compatibility: Patch Tool v4" in legacy_fallback_run.stdout
        assert legacy_fallback_target.read_text(encoding="utf-8") == "beta\n"
        legacy_fallback_zip.unlink()

        # Exact v4 fallback: a patch-named archive with no patch_*.py and no
        # helper imports still runs all Python files in sorted path order.
        plain_fallback_target = project / "src" / "legacy_v4_plain_fallback.txt"
        plain_fallback_target.write_text("plain-old\n", encoding="utf-8")
        plain_fallback_zip = make_zip(project / "patchs" / "patch_legacy_v4_plain_fallback.zip", {
            "steps/01_change.py": "from pathlib import Path\np=Path('src/legacy_v4_plain_fallback.txt')\np.write_text('plain-new\\n', encoding='utf-8')\n",
        })
        plain_fallback_run = run_patch(project, plain_fallback_zip, expect_success=True)
        assert "Package format: legacy_v4" in plain_fallback_run.stdout
        assert plain_fallback_target.read_text(encoding="utf-8") == "plain-new\n"
        plain_fallback_zip.unlink()

        # Legacy v4 tar.gz packages are also accepted.
        legacy_tar_target = project / "src" / "legacy_v4_tar.txt"
        legacy_tar_target.write_text("tar-old\n", encoding="utf-8")
        legacy_tar_script = textwrap.dedent("""\
            from pathlib import Path
            import sys
            PROJECT_ROOT = Path.cwd().resolve()
            sys.path.insert(0, str(PROJECT_ROOT / "tools"))
            from python_patch_utils import run_patch
            OPS = [{"kind": "replace", "file": "src/legacy_v4_tar.txt", "old": "tar-old", "new": "tar-new"}]
            raise SystemExit(run_patch("legacy_v4_tar", OPS))
        """)
        legacy_tar = project / "patchs" / "legacy_v4_package.tar.gz"
        tar_source = project / "legacy_tar_source"
        (tar_source / "nested").mkdir(parents=True)
        (tar_source / "nested" / "patch_legacy_v4_tar.py").write_text(legacy_tar_script, encoding="utf-8")
        with tarfile.open(legacy_tar, "w:gz") as tf:
            tf.add(tar_source / "nested" / "patch_legacy_v4_tar.py", arcname="nested/patch_legacy_v4_tar.py")
        shutil.rmtree(tar_source)
        legacy_tar_run = run_patch(project, legacy_tar, expect_success=True)
        assert "Package format: legacy_v4" in legacy_tar_run.stdout
        assert legacy_tar_target.read_text(encoding="utf-8") == "tar-new\n"
        legacy_tar.unlink()

        # A partially mutating v4 patch that later fails must be discarded by
        # the v5 transaction and still produce an AI handoff.
        legacy_fail_target = project / "src" / "legacy_v4_fail.txt"
        legacy_fail_target.write_text("safe\n", encoding="utf-8")
        legacy_fail_script = textwrap.dedent("""\
            from pathlib import Path
            import sys
            PROJECT_ROOT = Path.cwd().resolve()
            sys.path.insert(0, str(PROJECT_ROOT / "tools"))
            from python_patch_utils import run_patch
            OPS = [
                {"kind": "replace", "file": "src/legacy_v4_fail.txt", "old": "safe", "new": "temporary"},
                {"kind": "replace", "file": "src/legacy_v4_fail.txt", "old": "missing-anchor", "new": "never"},
            ]
            raise SystemExit(run_patch("legacy_v4_fail", OPS))
        """)
        legacy_fail_zip = make_zip(project / "patchs" / "legacy_v4_failure.zip", {
            "patch_legacy_v4_failure.py": legacy_fail_script,
        })
        legacy_fail_run = run_patch(project, legacy_fail_zip, expect_success=False)
        assert "LEGACY_V4_COMPATIBILITY: TRUE" in legacy_fail_run.stdout
        assert legacy_fail_target.read_text(encoding="utf-8") == "safe\n"
        assert newest(project / "patchs" / "reports", "PTV_*_FAIL_HANDOFF.zip").is_file()
        legacy_fail_zip.unlink()

        # A handoff/report ZIP containing incidental Python text must not be
        # misclassified as a legacy v4 patch without v4 helper markers.
        incidental_python = make_zip(project / "patchs" / "incidental_python_handoff.zip", {
            "START_HERE.md": "handoff only\n",
            "PATCH_PAYLOAD/patch_evidence_only.py": "from python_patch_utils import run_patch\n# evidence only; must never execute\n",
            "examples/example.py": "print('not a patch')\n",
        })
        incidental_run = run([str(project / "tools" / "run_python_patches.sh")], project, expect=0, input_text="a\n")
        assert "handoff/report/tool signatures" in incidental_run.stdout
        assert not incidental_python.exists()
        assert any((project / "patchs" / "ignored" / "non_patch").glob("incidental_python_handoff*.zip"))

        # v5.13 safe post-patch command policy.
        post_policy = normalize_policy(installed_config.get("post_patch", {}))
        allowed_request = normalize_manifest_request({"commands": [{"name": "List source", "argv": ["ls", "src"]}]}, post_policy)
        assert validate_command(allowed_request["commands"][0], project, post_policy)["kind"] == "basic_read_only"
        for forbidden in (
            {"name": "find exec", "argv": ["find", ".", "-exec", "echo", "{}", ";"]},
            {"name": "inline python", "argv": ["python3", "-c", "print(1)"]},
            {"name": "external git", "argv": ["git", "status"]},
        ):
            try:
                request = normalize_manifest_request({"commands": [forbidden]}, post_policy)
                validate_command(request["commands"][0], project, post_policy)
            except CommandPolicyError:
                pass
            else:
                raise AssertionError(f"Unsafe post command was accepted: {forbidden}")

        (project / "src" / "post_command.txt").write_text("base\n", encoding="utf-8")
        (project / "tools" / "append_post_command.py").write_text(
            "from pathlib import Path\n"
            "p=Path('src/post_command.txt')\n"
            "p.write_text(p.read_text(encoding='utf-8')+'command\\n', encoding='utf-8')\n",
            encoding="utf-8",
        )
        (project / "tools" / "write_nochange_marker.py").write_text(
            "from pathlib import Path\nPath('nochange_marker.txt').write_text('ran\\n', encoding='utf-8')\n",
            encoding="utf-8",
        )
        (project / "tools" / "write_force_marker.py").write_text(
            "from pathlib import Path\nPath('force_marker.txt').write_text('ran\\n', encoding='utf-8')\n",
            encoding="utf-8",
        )
        (project / "tools" / "write_command_only.py").write_text(
            "from pathlib import Path\nPath('command_only_result.txt').write_text('ran\\n', encoding='utf-8')\n",
            encoding="utf-8",
        )
        git(project, "add", "src/post_command.txt", "tools")
        git(project, "commit", "-qm", "Add post-command fixtures")

        changed_manifest = manifest("post_command_changed", "Run a safe command only after a real patch delta.")
        changed_manifest["post_patch"] = {"commands": [{
            "name": "Append post-command marker", "argv": ["python3", "tools/append_post_command.py"],
            "cwd": ".", "timeout_seconds": 30,
        }]}
        changed_package = make_zip(project / "patchs" / "post_command_changed.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text(changed_manifest),
            "PATCH_TOOL_OPS.json": json_text({"schema_version": 1, "patch_name": "post_command_changed", "ops": [{
                "kind": "replace", "file": "src/post_command.txt", "old": "base", "new": "patched"
            }]}),
        })
        changed_run = run_patch(project, changed_package, expect_success=True)
        assert "POST_COMMANDS: decision=CHANGED_PATHS status=PASS" in changed_run.stdout
        assert (project / "src" / "post_command.txt").read_text(encoding="utf-8") == "patched\ncommand\n"
        changed_package.unlink()

        noop_manifest = manifest("post_command_noop", "Skip command when a normal patch creates no delta.")
        noop_manifest["post_patch"] = {"commands": [{
            "name": "Must be skipped", "argv": ["python3", "tools/write_nochange_marker.py"]
        }]}
        noop_package = make_zip(project / "patchs" / "post_command_noop.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text(noop_manifest),
            "patch_noop.py": "print('no source changes')\n",
        })
        noop_run = run_patch(project, noop_package, expect_success=True)
        assert "decision=SKIPPED_NO_PATCH_CHANGES status=SKIPPED_NO_PATCH_CHANGES" in noop_run.stdout
        assert not (project / "nochange_marker.txt").exists()
        noop_package.unlink()

        force_manifest = manifest("post_command_force", "Allow one explicitly justified command after an idempotent patch.")
        force_manifest["post_patch"] = {
            "run_when_no_changes": True,
            "no_change_reason": "A focused diagnostic artifact must be refreshed even though the source patch is already applied.",
            "commands": [{"name": "Forced focused refresh", "argv": ["python3", "tools/write_force_marker.py"]}],
        }
        force_package = make_zip(project / "patchs" / "post_command_force.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text(force_manifest),
            "patch_noop.py": "print('already applied')\n",
        })
        force_run = run_patch(project, force_package, expect_success=True)
        assert "decision=NO_CHANGE_OVERRIDE status=PASS" in force_run.stdout
        assert (project / "force_marker.txt").is_file()
        force_package.unlink()

        command_only_manifest = manifest("command_only", "Run a project-local script without a source payload.")
        command_only_manifest["post_patch"] = {"commands": [{
            "name": "Command-only project script", "argv": ["python3", "tools/write_command_only.py"]
        }]}
        command_only_package = make_zip(project / "patchs" / "command_only.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text(command_only_manifest),
        })
        command_only_run = run_patch(project, command_only_package, expect_success=True)
        assert "decision=COMMAND_ONLY_PACKAGE status=PASS" in command_only_run.stdout
        assert (project / "command_only_result.txt").is_file()
        command_only_package.unlink()

        forbidden_manifest = manifest("post_command_forbidden", "Reject a non-allowlisted executable.")
        forbidden_manifest["post_patch"] = {"commands": [{"name": "Forbidden Git", "argv": ["git", "status"]}]}
        forbidden_package = make_zip(project / "patchs" / "post_command_forbidden.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text(forbidden_manifest),
        })
        forbidden_run = run_patch(project, forbidden_package, expect_success=False)
        assert "PTV-POST-COMMAND-POLICY-001" in forbidden_run.stdout
        forbidden_package.unlink()

        # Baseline generator must use the same symbol hashing rules as the runner.
        baseline_ops = project / "baseline_ops.json"
        baseline_ops.write_text(json_text({"schema_version": 1, "ops": [{
            "kind": "replace", "file": "src/feature.c", "anchor": "int feature(void)",
            "old": "old block", "new": "new block"
        }]}), encoding="utf-8")
        generated = run([str(project / "tools" / "run_python_patches.sh"), "baseline", "--ops", str(baseline_ops)], project)
        generated_json = json.loads(generated.stdout)
        baseline_entry = generated_json["source_baseline"]["files"][0]
        assert baseline_entry["file"] == "src/feature.c"
        assert len(baseline_entry["sha256"]) == 64 and len(baseline_entry["symbol_sha256"]) == 64
        assert baseline_entry["symbol"] == "feature"
        baseline_ops.unlink()

        reports = project / "patchs" / "reports"

        # General code collector: file/range, symbol, search, directory, redaction, and one ZIP.
        collector_source = project / "src" / "collector.c"
        collector_source.write_text(
            "#include <stdio.h>\n"
            "const char *api_key = \"super-secret-value-12345\";\n"
            "int alpha(int value) {\n    return value + 1;\n}\n"
            "int beta(void) {\n    return alpha(4);\n}\n", encoding="utf-8")
        (project / "notes.txt").write_text("collector notes\n", encoding="utf-8")
        collector_request = {
            "id": "collector_selftest", "title": "Collector self-test",
            "actions": [
                {"type": "overview", "path": ".", "tree_depth": 3},
                {"type": "ls", "path": "src"},
                {"type": "tree", "path": ".", "max_depth": 3},
                {"type": "find", "paths": ["src"], "patterns": ["*.c"]},
                {"type": "file", "path": "src/collector.c", "start_line": 1, "end_line": 4},
                {"type": "head", "path": "src/collector.c", "lines": 3},
                {"type": "tail", "path": "src/collector.c", "lines": 3},
                {"type": "symbol", "path": "src/collector.c", "symbol": "alpha"},
                {"type": "search", "query": "alpha", "paths": ["src"], "context_lines": 2},
                {"type": "references", "symbol": "alpha", "paths": ["src"]},
                {"type": "callgraph", "path": "src/collector.c", "symbol": "beta", "paths": ["src"]},
                {"type": "dependencies", "path": "src"},
                {"type": "directory", "path": "src", "include": ["**/*.c"]},
                {"type": "pack", "paths": ["notes.txt", "src"]},
                {"type": "git", "sections": ["status", "branch", "log", "diff_stat"]}
            ]
        }
        (project / "CODE_COLLECTION_REQUEST.json").write_text(json_text(collector_request), encoding="utf-8")
        collector_run = run([str(project / "tools" / "run_python_patches.sh"), "collect"], project, expect=0)
        collector_result = json.loads(collector_run.stdout)
        collector_zip = project / collector_result["archive"]
        assert_zip_ok(collector_zip)
        with zipfile.ZipFile(collector_zip) as zf:
            names = zf.namelist()
            assert "START_HERE.md" in names and "manifest.json" in names
            combined = "\n".join(zf.read(name).decode("utf-8", "replace") for name in names if name.endswith((".txt", ".md", ".json", ".c")))
            assert "super-secret-value-12345" not in combined
            assert "<REDACTED>" in combined
        collector_manifest = zip_json(collector_zip, "manifest.json")
        assert collector_manifest["entry_count"] >= 15
        assert collector_manifest["security"]["relative_paths_only"] is True

        # Large decompile adapter derived from the uploaded GM52 extractor.
        decompile = project / "docs" / "mini_decompile.c"
        decompile.parent.mkdir(exist_ok=True)
        decompile.write_text(
            "//----- (0x1000) ----------------------------------------------------\n"
            "int Demo::first()\n{\n  return 1;\n}\n"
            "//----- (0x1010) ----------------------------------------------------\n"
            "int Demo::second()\n{\n  return Demo::first();\n}\n", encoding="utf-8")
        decompile_run = run([str(project / "tools" / "run_python_patches.sh"), "collect", "decompile", "docs/mini_decompile.c", "--name", "Demo::first", "--match", "exact", "--references"], project, expect=0)
        decompile_result = json.loads(decompile_run.stdout)
        assert_zip_ok(project / decompile_result["archive"] )

        # Data-only PASS, Git path isolation, and three bundles.
        (project / "unrelated.txt").write_text("base\nunrelated staged\n", encoding="utf-8")
        git(project, "add", "unrelated.txt")
        ops_pass = make_zip(project / "patchs" / "patch_v53_ops_pass.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text(manifest(
                "ops_pass", "Apply data-only patch.",
                git_cfg={"add": "changed", "commit": "auto", "commit_message": "Apply v5.9 data-only self-test", "push": "off", "fail_on_error": True},
            )),
            "PATCH_TOOL_OPS.json": json_text({
                "schema_version": 1, "patch_name": "ops_pass", "ops": [
                    {"kind": "replace", "file": "src/feature.c", "old": "old block", "new": "new block", "mode": "auto"}
                ],
            }),
        })
        result = run_patch(project, ops_pass, "--no-validation", expect_success=True)
        assert "[PRIMARY - UPLOAD] HANDOFF.zip" in result.stdout
        assert "[OPTIONAL] SUMMARY.zip" in result.stdout and "[OPTIONAL] CODE.zip" in result.stdout
        assert "[DEBUG ONLY] DETAIL.zip" in result.stdout and "[ALIAS] REPORT ZIP" in result.stdout
        assert "NORMAL ACTION: Upload only" in result.stdout
        assert f"PROJECT ROOT: {project.resolve()}" in result.stdout
        assert (project / "src" / "feature.c").read_text() == "int feature(void) {\n    new block\n}\n"
        assert "unrelated.txt" in git(project, "diff", "--cached", "--name-only")
        assert git(project, "show", "--pretty=", "--name-only", "HEAD").strip() == "src/feature.c"
        summary_zip = newest(reports, "PTV_*_PASS_SUMMARY.zip")
        code_zip = newest(reports, "PTV_*_PASS_CODE.zip")
        detail_zip = newest(reports, "PTV_*_PASS_DETAIL.zip")
        handoff_zip = newest(reports, "PTV_*_PASS_HANDOFF.zip")
        for path in (summary_zip, code_zip, detail_zip, handoff_zip):
            assert_zip_ok(path)
        summary = zip_json(summary_zip, "summary.json")
        assert summary["status"] == "PASS" and summary["scripts"][0]["payload_type"] == "ops_json"
        assert summary["diagnostics_summary"]["errors"] == 0
        assert summary["transaction"]["status"] == "APPLIED"
        assert summary["transaction"]["applied_paths"] == ["src/feature.c"]
        assert summary["idempotency"]["status"] == "PASS"
        assert summary["idempotency"]["changed_paths"] == []
        with zipfile.ZipFile(handoff_zip) as zf:
            assert "START_HERE.md" in zf.namelist() and "AI_SUMMARY/root_causes.md" in zf.namelist()

        # A Python patch that writes then crashes must only dirty the sandbox.
        partial_target = project / "src" / "partial.c"
        partial_target.write_text("int partial(void) { return 1; }\n", encoding="utf-8")
        git(project, "add", "src/partial.c")
        git(project, "commit", "-qm", "Add partial target")
        partial_zip = make_zip(project / "patchs" / "patch_v54_partial_fail.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text(manifest("partial_fail", "Verify sandbox discard after partial patch failure.")),
            "patch_partial.py": "from pathlib import Path\np=Path('src/partial.c')\np.write_text('int partial(void) { return 99; }\\n')\nraise RuntimeError('simulated failure after write')\n",
        })
        run_patch(project, partial_zip, "--no-validation", expect_success=False)
        assert partial_target.read_text(encoding="utf-8") == "int partial(void) { return 1; }\n"
        partial_summary = zip_json(newest(reports, "PTV_*_FAIL_SUMMARY.zip"), "summary.json")
        assert partial_summary["transaction"]["status"] == "PATCH_FAILED_SANDBOX_DISCARDED"
        assert "src/partial.c" in partial_summary["transaction"]["delta_paths"]

        # Validation failure must discard the verified sandbox candidate and leave real source unchanged.
        config = json.loads((project / ".python_patch_tool.json").read_text())
        config["validation"]["profiles"]["always_fail"] = [{
            "name": "Intentional validation failure", "command": [PYTHON, "-c", "print(\"Authorization: Bearer TOP-SECRET-VALIDATION-TOKEN\"); print(\"src/validation.c:1:1: error: intentional failure\"); raise SystemExit(9)"],
            "cwd": ".", "timeout_seconds": 30,
        }]
        (project / ".python_patch_tool.json").write_text(json_text(config), encoding="utf-8")
        validation_target = project / "src" / "validation.c"
        validation_target.write_text("int validation(void) { return 1; }\n", encoding="utf-8")
        git(project, "add", ".python_patch_tool.json", "src/validation.c")
        git(project, "commit", "-qm", "Add validation transaction test")
        validation_zip = make_zip(project / "patchs" / "patch_v54_validation_fail.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text(manifest("validation_fail", "Discard sandbox when validation fails.", validation=["always_fail"])),
            "PATCH_TOOL_OPS.json": json_text({"schema_version": 1, "patch_name": "validation_fail", "ops": [{
                "kind": "replace", "file": "src/validation.c", "old": "return 1", "new": "return 2"
            }]}),
        })
        run_patch(project, validation_zip, expect_success=False)
        assert "return 1" in validation_target.read_text(encoding="utf-8")
        validation_summary_zip = newest(reports, "PTV_*_FAIL_SUMMARY.zip")
        validation_summary = zip_json(validation_summary_zip, "summary.json")
        assert validation_summary["transaction"]["status"] == "VALIDATION_FAILED_SANDBOX_DISCARDED"
        assert validation_summary["security_redaction"]["redacted_value_count"] >= 1
        assert validation_summary["diagnostic_quality"]["status"] in {"COMPLETE", "PARTIAL"}
        with zipfile.ZipFile(validation_summary_zip) as zf:
            assert "environment_fingerprint.json" in zf.namelist()
            assert "diagnostic_quality.json" in zf.namelist()
            assert "security_redaction.json" in zf.namelist()
            combined = "\n".join(zf.read(name).decode("utf-8", "replace") for name in zf.namelist() if name.endswith((".log", ".txt", ".md", ".json")))
            assert "TOP-SECRET-VALIDATION-TOKEN" not in combined

        # Full idempotency mode must reject a Python payload that changes files on every run.
        idempotent_target = project / "src" / "idempotency.txt"
        idempotent_target.write_text("base\n", encoding="utf-8")
        git(project, "add", "src/idempotency.txt")
        git(project, "commit", "-qm", "Add idempotency target")
        non_idempotent_zip = make_zip(project / "patchs" / "patch_v54_non_idempotent.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text(manifest("non_idempotent", "Reject non-idempotent Python patch.")),
            "patch_non_idempotent.py": "from pathlib import Path\np=Path('src/idempotency.txt')\np.write_text(p.read_text() + 'again\\n')\n",
        })
        run_patch(project, non_idempotent_zip, "--no-validation", "--idempotency", "all", expect_success=False)
        assert idempotent_target.read_text(encoding="utf-8") == "base\n"
        idempotency_summary = zip_json(newest(reports, "PTV_*_FAIL_SUMMARY.zip"), "summary.json")
        assert idempotency_summary["idempotency"]["status"] == "FAIL"
        assert idempotency_summary["transaction"]["status"] == "IDEMPOTENCY_FAILED_SANDBOX_DISCARDED"

        # Apply journal must roll back earlier paths when a later copy fails.
        rollback_repo = base / "rollback_repo"
        rollback_repo.mkdir()
        git(rollback_repo, "init", "-q")
        git(rollback_repo, "config", "user.name", "Patch Tool Rollback Test")
        git(rollback_repo, "config", "user.email", "rollback@example.invalid")
        (rollback_repo / "a.txt").write_text("a-before\n", encoding="utf-8")
        (rollback_repo / "b.txt").write_text("b-before\n", encoding="utf-8")
        git(rollback_repo, "add", ".")
        git(rollback_repo, "commit", "-qm", "Initial rollback repository")
        sys.path.insert(0, str(ROOT))
        import python_patch_transaction as txmod
        tx_report = rollback_repo / "tx-report"
        tx = txmod.SandboxTransaction(
            real_root=rollback_repo,
            temp_root=rollback_repo / "patchs" / ".patch_runner_tmp",
            report_dir=tx_report,
            config={"overlay_paths": [], "exclude_paths": ["patchs/**", ".git/**"], "max_apply_paths": 20},
            log=lambda *_args, **_kwargs: None,
        )
        sandbox = tx.start()
        (sandbox / "a.txt").write_text("a-after\n", encoding="utf-8")
        (sandbox / "b.txt").write_text("b-after\n", encoding="utf-8")
        original_copy = txmod._copy_entry
        def fail_second_copy(source: Path, target: Path) -> None:
            if source == sandbox / "b.txt" and target == rollback_repo / "b.txt":
                raise OSError("simulated second-path apply failure")
            original_copy(source, target)
        txmod._copy_entry = fail_second_copy
        try:
            try:
                tx.apply_delta(["a.txt", "b.txt"])
                raise AssertionError("Expected transaction apply failure")
            except txmod.TransactionError:
                pass
        finally:
            txmod._copy_entry = original_copy
            tx.cleanup()
        assert (rollback_repo / "a.txt").read_text(encoding="utf-8") == "a-before\n"
        assert (rollback_repo / "b.txt").read_text(encoding="utf-8") == "b-before\n"
        assert tx.result["status"] == "APPLY_FAILED_ROLLED_BACK"
        assert tx.result["rollback"] == "SUCCESS"

        # Concurrent real-worktree edits must block delta application without overwriting them.
        git(rollback_repo, "add", ".")
        git(rollback_repo, "commit", "-qm", "Reset after rollback test")
        conflict_report = rollback_repo / "conflict-report"
        conflict_tx = txmod.SandboxTransaction(
            real_root=rollback_repo,
            temp_root=rollback_repo / "patchs" / ".patch_runner_tmp",
            report_dir=conflict_report,
            config={"overlay_paths": [], "exclude_paths": ["patchs/**", ".git/**"], "max_apply_paths": 20},
            log=lambda *_args, **_kwargs: None,
        )
        conflict_sandbox = conflict_tx.start()
        (conflict_sandbox / "a.txt").write_text("sandbox-change\n", encoding="utf-8")
        (rollback_repo / "a.txt").write_text("external-change\n", encoding="utf-8")
        try:
            conflict_tx.apply_delta(["a.txt"])
            raise AssertionError("Expected concurrent transaction conflict")
        except txmod.TransactionError:
            pass
        finally:
            conflict_tx.cleanup()
        assert (rollback_repo / "a.txt").read_text(encoding="utf-8") == "external-change\n"
        assert conflict_tx.result["status"] == "APPLY_CONFLICT"

        # A child that inherits stdout after its leader exits must be terminated with the process group.
        orphan_zip = make_zip(project / "patchs" / "patch_v54_process_tree.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text(manifest("process_tree", "Verify process-tree cleanup.")),
            "patch_process_tree.py": "import subprocess, sys\nsubprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'])\nprint('leader exits now')\n",
        })
        orphan_result = run_patch(project, orphan_zip, "--no-validation", "--idempotency", "off", expect_success=True)
        assert "process_tree=CLEAN" in orphan_result.stdout
        orphan_summary = zip_json(newest(reports, "PTV_*_PASS_SUMMARY.zip"), "summary.json")
        process_log = orphan_summary["scripts"][0]["log"]
        assert process_log["process_tree_status"] == "CLEAN"
        assert process_log["termination_events"]

        # Preflight must not execute code.
        marker = project / "preflight_executed.txt"
        preflight_zip = make_zip(project / "patchs" / "patch_v53_preflight.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text(manifest("preflight", "Verify preflight isolation.")),
            "patch_preflight.py": f"from pathlib import Path\nPath({str(marker)!r}).write_text('bad')\n",
        })
        run_patch(project, preflight_zip, "--preflight-only", "--no-validation", expect_success=True)
        assert not marker.exists()
        newest(reports, "PTV_*_PREFLIGHT_PASS_SUMMARY.zip")

        # Syntax error must include caret, suggestion, and patch source.
        syntax_zip = make_zip(project / "patchs" / "patch_v53_syntax.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text(manifest("syntax", "Verify syntax diagnostics.")),
            "patch_syntax.py": "def broken()\n    print('x')\n",
        })
        run_patch(project, syntax_zip, "--no-validation", expect_success=False)
        syntax_summary = newest(reports, "PTV_*_FAIL_SUMMARY.zip")
        syntax_code = newest(reports, "PTV_*_FAIL_CODE.zip")
        diagnostics_md = zip_read(syntax_summary, "diagnostics.md")
        assert "expected ':'" in diagnostics_md and "^" in diagnostics_md and "Add ':'" in diagnostics_md
        with zipfile.ZipFile(syntax_code) as zf:
            assert "package_source/patch_syntax.py" in zf.namelist()

        # Stale anchor must include current source and nearest block analysis.
        (project / "src" / "anchor.c").write_text(
            "static int current_shape(void) {\n    int value = 42;\n    return value + 1;\n}\n", encoding="utf-8"
        )
        stale_zip = make_zip(project / "patchs" / "patch_v53_stale.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text(manifest("stale", "Verify stale anchor handoff.")),
            "PATCH_TOOL_OPS.json": json_text({
                "schema_version": 1, "patch_name": "stale", "ops": [{
                    "id": "stale", "kind": "replace", "file": "src/anchor.c",
                    "anchor": "static int current_shape(void)",
                    "old": "    int value = 10;\n    return value;",
                    "new": "    int value = 11;\n    return value;", "mode": "auto",
                }],
            }),
        })
        run_patch(project, stale_zip, "--no-validation", expect_success=False)
        stale_code = newest(reports, "PTV_*_FAIL_CODE.zip")
        stale_text = zip_read(stale_code, "code_context/STALE_ANCHOR_ANALYSIS.md")
        assert "Similarity" in stale_text and "int value = 42" in stale_text
        with zipfile.ZipFile(stale_code) as zf:
            assert "code_context/files/src/anchor.c" in zf.namelist()

        # Noisy C build: compact output, complete raw log, compiler location.
        fake = project / "fake"
        fake.mkdir(exist_ok=True)
        ninja = fake / "ninja"
        ninja.write_text(textwrap.dedent("""\
            #!/usr/bin/env bash
            for i in $(seq 1 1000); do echo "[$i/1000] Building C object component_$i.o"; done
            echo "src/feature.c:2:3: error: simulated compiler failure"
            echo "ninja: build stopped: subcommand failed."
            exit 1
        """), encoding="utf-8")
        ninja.chmod(0o755)
        config = json.loads((project / ".python_patch_tool.json").read_text())
        config["validation"]["profiles"]["noisy_c"] = [{
            "name": "Noisy C build", "command": ["./fake/ninja"], "cwd": ".", "timeout_seconds": 30,
        }]
        (project / ".python_patch_tool.json").write_text(json_text(config), encoding="utf-8")
        noisy_zip = make_zip(project / "patchs" / "patch_v53_noisy.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text(manifest("noisy", "Verify compact C build logs.", validation=["noisy_c"])),
            "PATCH_TOOL_OPS.json": json_text({"schema_version": 1, "patch_name": "noisy", "ops": []}),
        })
        noisy_result = run_patch(project, noisy_zip, expect_success=False)
        assert "simulated compiler failure" in noisy_result.stdout
        assert len(noisy_result.stdout.splitlines()) < 240
        noisy_summary = newest(reports, "PTV_*_FAIL_SUMMARY.zip")
        noisy_detail = newest(reports, "PTV_*_FAIL_DETAIL.zip")
        noisy_data = zip_json(noisy_summary, "summary.json")
        assert noisy_data["log_filter"]["raw_lines"] >= 1000
        assert noisy_data["log_filter"]["reduction_ratio"] > 0.85
        assert any(item.get("kind") == "compiler" and item.get("file") == "src/feature.c" for item in json.loads(zip_read(noisy_summary, "diagnostics.json")))
        with zipfile.ZipFile(noisy_detail) as zf:
            raw_names = [name for name in zf.namelist() if name.startswith("logs/validation_") and name.endswith(".raw.log")]
            assert raw_names and len(zf.read(raw_names[0]).splitlines()) >= 1000

        # Source drift must stop execution before mutation and create a compact handoff.
        drift_target = project / "src" / "drift.c"
        drift_target.write_text("int drifted(void) { return 2; }\n", encoding="utf-8")
        drift_zip = make_zip(project / "patchs" / "patch_v53_drift.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text({
                **manifest("source_drift", "Reject stale source baseline."),
                "source_baseline": {"generated_from": "self-test-old", "files": [{
                    "file": "src/drift.c", "sha256": "0" * 64, "symbol": "drifted", "symbol_sha256": "1" * 64, "line_hint": 1
                }]},
            }),
            "PATCH_TOOL_OPS.json": json_text({"schema_version": 1, "patch_name": "drift", "ops": [{
                "kind": "replace", "file": "src/drift.c", "old": "return 2", "new": "return 3"
            }]}),
        })
        run_patch(project, drift_zip, "--no-validation", expect_success=False)
        assert "return 2" in drift_target.read_text()
        drift_handoff = newest(reports, "PTV_*_FAIL_HANDOFF.zip")
        with zipfile.ZipFile(drift_handoff) as zf:
            assert "AI_SUMMARY/source_drift.md" in zf.namelist()
            assert "PTV-SOURCE-DRIFT-001" in zf.read("AI_SUMMARY/root_causes.md").decode()

        # A changed file may proceed when the required symbol hash still matches.
        sys.path.insert(0, str(ROOT))
        from python_patch_diagnostics import extract_symbol_context
        stable_target = project / "src" / "stable.c"
        stable_target.write_text("/* unrelated file drift */\nint stable_symbol(void) {\n    return 7;\n}\n", encoding="utf-8")
        symbol = extract_symbol_context(stable_target, symbol_hint="stable_symbol", line_hint=2)
        assert symbol
        stable_zip = make_zip(project / "patchs" / "patch_v53_symbol_match.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text({
                **manifest("symbol_match", "Allow unrelated file drift when symbol matches."),
                "source_baseline": {"files": [{
                    "file": "src/stable.c", "sha256": "f" * 64, "symbol": "stable_symbol",
                    "symbol_sha256": symbol["sha256"], "line_hint": 2
                }]},
            }),
            "PATCH_TOOL_OPS.json": json_text({"schema_version": 1, "patch_name": "symbol_match", "ops": []}),
        })
        run_patch(project, stable_zip, "--no-validation", expect_success=True)
        stable_summary = zip_json(newest(reports, "PTV_*_PASS_SUMMARY.zip"), "summary.json")
        assert stable_summary["source_drift"]["status"] == "PASS"
        assert stable_summary["source_drift"]["entries"][0]["status"] == "FILE_DRIFT_SYMBOL_MATCH"

        # Root cause clustering must prefer the compiler location over wrapper failures.
        noisy_roots = zip_json(noisy_summary, "root_causes.json")
        assert noisy_roots["root_causes"][0]["code"] == "PTV-BUILD-C-001"
        assert noisy_roots["secondary_or_suppressed_count"] >= 1
        noisy_handoff = newest(reports, "PTV_*_FAIL_HANDOFF.zip")
        with zipfile.ZipFile(noisy_handoff) as zf:
            assert any(name.startswith("CODE_CONTEXT/") and name.endswith(".symbol.txt") for name in zf.namelist())

        # Hard process exit must still create all FAIL bundles.
        crash_zip = make_zip(project / "patchs" / "patch_v53_crash.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text(manifest("crash", "Verify hard process crash isolation.")),
            "patch_crash.py": "import os\nos._exit(7)\n",
        })
        run_patch(project, crash_zip, "--no-validation", expect_success=False)
        for pattern in (
            "PTV_*_FAIL_SUMMARY.zip",
            "PTV_*_FAIL_CODE.zip",
            "PTV_*_FAIL_DETAIL.zip",
        ):
            assert_zip_ok(newest(reports, pattern))

        # Archive traversal is rejected but still receives a compact handoff.
        traversal = project / "patchs" / "patch_v53_traversal.zip"
        with zipfile.ZipFile(traversal, "w") as zf:
            zf.writestr("../escape.py", "raise SystemExit(0)\n")
        run_patch(project, traversal, "--allow-missing-manifest", "--allow-incomplete-metadata", "--no-validation", expect_success=False)
        assert not (project.parent / "escape.py").exists()
        newest(reports, "PTV_*_FAIL_SUMMARY.zip")

        # Secret-like source must not be copied automatically.
        with zipfile.ZipFile(stale_code) as zf:
            assert not any(name.endswith("/.env") or name.endswith("id_rsa") for name in zf.namelist())

        # Validation impact selection must derive trusted profiles from the actual sandbox delta.
        auto_dir = project / "src" / "auto"
        auto_dir.mkdir(parents=True, exist_ok=True)
        auto_target = auto_dir / "feature.c"
        auto_target.write_text("int auto_feature(void) { return 1; }\n", encoding="utf-8")
        config = json.loads((project / ".python_patch_tool.json").read_text())
        config["validation"]["profiles"]["auto_c_check"] = [{
            "name": "Focused C delta check",
            "command": [PYTHON, "-c", "from pathlib import Path; assert 'return 2' in Path('src/auto/feature.c').read_text(); print('AUTO_VALIDATION_OK')"],
            "cwd": ".", "timeout_seconds": 30,
        }]
        config["validation"]["selection"]["mode"] = "append"
        config["validation"]["selection"]["rules"].append({
            "name": "Focused C source", "include": ["src/auto/*.c"], "exclude": [], "profiles": ["auto_c_check"]
        })
        (project / ".python_patch_tool.json").write_text(json_text(config), encoding="utf-8")
        git(project, "add", ".python_patch_tool.json", "src/auto/feature.c")
        git(project, "commit", "-qm", "Add v5.9 validation selection fixtures")
        auto_zip = make_zip(project / "patchs" / "patch_v55_auto_validation.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text(manifest("auto_validation", "Select validation from changed C path.")),
            "PATCH_TOOL_OPS.json": json_text({"schema_version": 1, "patch_name": "auto_validation", "ops": [{
                "kind": "replace", "file": "src/auto/feature.c", "old": "return 1", "new": "return 2"
            }]}),
        })
        auto_result = run_patch(project, auto_zip, expect_success=True)
        assert "Validation impact selection:" in auto_result.stdout and "auto_c_check" in auto_result.stdout
        auto_summary_zip = newest(reports, "PTV_*_PASS_SUMMARY.zip")
        auto_summary = zip_json(auto_summary_zip, "summary.json")
        assert auto_summary["validation_selection"]["status"] == "MATCHED"
        assert auto_summary["validation_selection"]["auto_profiles"] == ["auto_c_check"]
        assert auto_summary["validation"]["selected_profiles"] == ["auto_c_check"]
        assert auto_summary["validation"]["status"] == "PASS"
        assert "AUTO_VALIDATION_OK" in zip_read(auto_summary_zip, "important_log.txt")

        # A failed trusted validation may run one explicitly safe diagnostic command, but FAIL remains FAIL.
        diag_target = project / "src" / "diag.c"
        diag_target.write_text("int diag(void) { return 1; }\n", encoding="utf-8")
        config = json.loads((project / ".python_patch_tool.json").read_text())
        config["validation"]["profiles"]["diag_fail"] = [{
            "name": "Primary diagnostic failure",
            "command": [PYTHON, "-c", "print('src/diag.c:1:3: error: primary validation failure'); raise SystemExit(7)"],
            "cwd": ".", "timeout_seconds": 30,
            "diagnostic_rerun": {
                "enabled": True, "safe": True, "name": "Expanded diagnostic evidence",
                "command": [PYTHON, "-c", "print('src/diag.c:1:3: note: expanded diagnostic rerun evidence'); raise SystemExit(8)"],
                "timeout_seconds": 30
            }
        }]
        config["validation"]["selection"]["rules"].append({
            "name": "Diagnostic fixture", "include": ["src/diag.c"], "exclude": [], "profiles": ["diag_fail"]
        })
        (project / ".python_patch_tool.json").write_text(json_text(config), encoding="utf-8")
        git(project, "add", ".python_patch_tool.json", "src/diag.c")
        git(project, "commit", "-qm", "Add v5.9 diagnostic rerun fixtures")
        diag_zip = make_zip(project / "patchs" / "patch_v55_diag_rerun.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text(manifest("diag_rerun", "Capture safe diagnostic rerun evidence.")),
            "PATCH_TOOL_OPS.json": json_text({"schema_version": 1, "patch_name": "diag_rerun", "ops": [{
                "kind": "replace", "file": "src/diag.c", "old": "return 1", "new": "return 2"
            }]}),
        })
        diag_result = run_patch(project, diag_zip, expect_success=False)
        assert "DIAGNOSTIC RERUN" in diag_result.stdout
        assert "return 1" in diag_target.read_text(encoding="utf-8")
        diag_summary_zip = newest(reports, "PTV_*_FAIL_SUMMARY.zip")
        diag_detail_zip = newest(reports, "PTV_*_FAIL_DETAIL.zip")
        diag_summary = zip_json(diag_summary_zip, "summary.json")
        assert diag_summary["validation"]["diagnostic_reruns_attempted"] == 1
        rerun = diag_summary["validation"]["commands"][0]["diagnostic_rerun"]
        assert rerun["attempted"] is True and rerun["status"] == "FAIL"
        assert diag_summary["status"] == "FAIL"
        with zipfile.ZipFile(diag_detail_zip) as zf:
            rerun_logs = [name for name in zf.namelist() if "diagnostic_rerun" in name and name.endswith(".raw.log")]
            assert rerun_logs and "expanded diagnostic rerun evidence" in zf.read(rerun_logs[0]).decode()

        # Failure history must report first, changed, then resolved failures without resending old raw logs.
        history_target = project / "src" / "history.c"
        history_target.write_text("int history(void) { return 1; }\n", encoding="utf-8")
        git(project, "add", "src/history.c")
        git(project, "commit", "-qm", "Add failure history fixture")
        history_one = make_zip(project / "patchs" / "patch_v55_history_one.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text(manifest("history_case", "Record first compact failure.")),
            "PATCH_TOOL_OPS.json": json_text({"schema_version": 1, "patch_name": "history_one", "ops": [{
                "kind": "replace", "file": "src/history.c", "old": "missing first anchor", "new": "PATCH_HISTORY_NEW_ONE_8F2A"
            }]}),
        })
        run_patch(project, history_one, "--no-validation", expect_success=False)
        history_one_summary = zip_json(newest(reports, "PTV_*_FAIL_SUMMARY.zip"), "summary.json")
        assert history_one_summary["failure_delta"]["status"] == "FIRST_FAILURE"

        history_two = make_zip(project / "patchs" / "patch_v55_history_two.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text(manifest("history_case", "Record changed compact failure.")),
            "PATCH_TOOL_OPS.json": json_text({"schema_version": 1, "patch_name": "history_two", "ops": [{
                "kind": "replace", "file": "src/history.c", "old": "missing second anchor", "new": "PATCH_HISTORY_NEW_TWO_4C91"
            }]}),
        })
        run_patch(project, history_two, "--no-validation", expect_success=False)
        history_two_summary_zip = newest(reports, "PTV_*_FAIL_SUMMARY.zip")
        history_two_summary = zip_json(history_two_summary_zip, "summary.json")
        assert history_two_summary["failure_delta"]["status"] == "FAILURE_CHANGED", history_two_summary["failure_delta"]
        assert history_two_summary["failure_delta"]["new_causes"]
        assert history_two_summary["failure_delta"]["resolved_causes"]

        history_preflight = make_zip(project / "patchs" / "patch_v55_history_preflight.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text(manifest("history_case", "Preflight must not resolve apply failure history.")),
            "PATCH_TOOL_OPS.json": json_text({"schema_version": 1, "patch_name": "history_preflight", "ops": []}),
        })
        run_patch(project, history_preflight, "--preflight-only", "--no-validation", expect_success=True)
        history_preflight_summary = zip_json(newest(reports, "PTV_*_PREFLIGHT_PASS_SUMMARY.zip"), "summary.json")
        assert history_preflight_summary["failure_delta"]["status"] == "PREFLIGHT_ONLY"

        history_pass = make_zip(project / "patchs" / "patch_v55_history_pass.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text(manifest("history_case", "Resolve previous compact failure.")),
            "PATCH_TOOL_OPS.json": json_text({"schema_version": 1, "patch_name": "history_pass", "ops": []}),
        })
        run_patch(project, history_pass, "--no-validation", expect_success=True)
        history_pass_summary = zip_json(newest(reports, "PTV_*_PASS_SUMMARY.zip"), "summary.json")
        assert history_pass_summary["failure_delta"]["status"] == "PREVIOUS_FAILURE_RESOLVED"
        history_handoff = newest(reports, "PTV_*_PASS_HANDOFF.zip")
        with zipfile.ZipFile(history_handoff) as zf:
            for name in (
                "AI_SUMMARY/failure_delta.md", "AI_SUMMARY/failure_delta.json",
                "AI_SUMMARY/validation_selection.md", "AI_SUMMARY/validation_selection.json",
            ):
                assert name in zf.namelist()

        # Zero-argument mode is the primary workflow: interactive one/many/all selection,
        # natural order, automatic PASS movement, and durable last-run state.
        for waiting in list((project / "patchs").iterdir()):
            if waiting.is_file() and waiting.name.lower().endswith((".py", ".zip", ".tar.gz", ".tgz")):
                waiting.unlink()
        delete_patch = make_zip(project / "patchs" / "patch_phase1_delete_from_menu.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text(manifest("delete_from_menu", "Delete this package from the interactive selector.")),
            "PATCH_TOOL_OPS.json": json_text({"schema_version": 1, "patch_name": "delete_from_menu", "ops": [{
                "kind": "write", "file": "src/deleted_patch_must_not_run.txt", "content": "never\n"
            }]}),
        })
        after_delete_patch = make_zip(project / "patchs" / "patch_phase2_run_after_delete.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text(manifest("run_after_delete", "Run after deleting another queued package.")),
            "PATCH_TOOL_OPS.json": json_text({"schema_version": 1, "patch_name": "run_after_delete", "ops": [{
                "kind": "write", "file": "src/after_delete_ran.txt", "content": "yes\n"
            }]}),
        })
        delete_run = run([str(project / "tools" / "run_python_patches.sh")], project, expect=0, input_text="d 1\ny\n1\n")
        assert not delete_patch.exists() and not (project / "src" / "deleted_patch_must_not_run.txt").exists()
        assert not after_delete_patch.exists() and (project / "src" / "after_delete_ran.txt").read_text(encoding="utf-8") == "yes\n"
        delete_state = json.loads((reports / "last_run.json").read_text(encoding="utf-8"))
        assert any(item.get("category") == "user_deleted" and item.get("input", "").endswith(delete_patch.name) for item in delete_state["skipped"])
        assert "PATCHES EXECUTED:" in delete_run.stdout and "patch_phase2_run_after_delete.zip" in delete_run.stdout
        assert "[DELETED:USER_DELETED]" in delete_run.stdout

        cancel_patch = make_zip(project / "patchs" / "patch_cancel_selection.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text(manifest("cancel_selection", "Remain queued when the user cancels selection.")),
            "PATCH_TOOL_OPS.json": json_text({"schema_version": 1, "patch_name": "cancel_selection", "ops": [{
                "kind": "write", "file": "src/cancel_must_not_run.txt", "content": "never\n"
            }]}),
        })
        cancel_run = run([str(project / "tools" / "run_python_patches.sh")], project, expect=0, input_text="q\n")
        assert "CANCELLED: no patch was executed." in cancel_run.stdout
        assert cancel_patch.is_file() and not (project / "src" / "cancel_must_not_run.txt").exists()
        cancel_state = json.loads((reports / "last_run.json").read_text(encoding="utf-8"))
        assert cancel_state["status"] == "CANCELLED" and cancel_state["remaining_count"] == 1
        assert cancel_state["skipped"][0]["category"] == "user_cancelled"
        cancel_patch.unlink()
        zero_target = project / "src" / "zero_order.txt"
        zero_target.write_text("start\n", encoding="utf-8")
        git(project, "add", "src/zero_order.txt")
        git(project, "commit", "-qm", "Add zero-argument queue fixture")
        zero_phase10 = make_zip(project / "patchs" / "patch_phase10_zero_auto.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text(manifest("zero_phase10", "Run second natural-order package.")),
            "PATCH_TOOL_OPS.json": json_text({"schema_version": 1, "patch_name": "zero_phase10", "ops": [{
                "kind": "replace", "file": "src/zero_order.txt", "old": "start\n2", "new": "start\n2\n10"
            }]}),
        })
        zero_phase2 = make_zip(project / "patchs" / "patch_phase2_zero_auto.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text(manifest("zero_phase2", "Run first natural-order package.")),
            "PATCH_TOOL_OPS.json": json_text({"schema_version": 1, "patch_name": "zero_phase2", "ops": [{
                "kind": "replace", "file": "src/zero_order.txt", "old": "start", "new": "start\n2"
            }]}),
        })
        zero_unselected = make_zip(project / "patchs" / "patch_phase20_zero_unselected.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text(manifest("zero_unselected", "Remain queued when not selected.")),
            "PATCH_TOOL_OPS.json": json_text({"schema_version": 1, "patch_name": "zero_unselected", "ops": [{
                "kind": "write", "file": "src/zero_unselected.txt", "content": "must remain pending\n"
            }]}),
        })
        zero_run = run([str(project / "tools" / "run_python_patches.sh")], project, expect=0, input_text="1,2\n")
        assert "ZERO-ARGUMENT SELECTION" in zero_run.stdout
        assert "RUN PLAN: selected=2" in zero_run.stdout
        assert "Available patch files/packages" in zero_run.stdout
        assert zero_target.read_text(encoding="utf-8") == "start\n2\n10\n"
        assert not zero_phase2.exists() and not zero_phase10.exists()
        assert zero_unselected.is_file() and not (project / "src" / "zero_unselected.txt").exists()
        assert (project / "patchs" / "patched" / zero_phase2.name).is_file()
        assert (project / "patchs" / "patched" / zero_phase10.name).is_file()
        last_run = json.loads((reports / "last_run.json").read_text(encoding="utf-8"))
        assert last_run["status"] == "PASS" and last_run["processed_count"] == 2
        assert any(item.get("category") == "user_not_selected" and item.get("input", "").endswith(zero_unselected.name) for item in last_run["skipped"])
        zero_unselected.unlink()
        assert (reports / "LAST_RUN.md").is_file()
        last_run_text = (reports / "LAST_RUN.md").read_text(encoding="utf-8")
        assert "## Output file guide" in last_run_text
        assert "*_HANDOFF.zip" in last_run_text and "Upload this file first" in last_run_text
        assert str(project.resolve()) in last_run_text
        idle_run = run([str(project / "tools" / "run_python_patches.sh")], project, expect=0)
        assert "AUTO STATUS: IDLE" in idle_run.stdout and "Choose a patch" not in idle_run.stdout
        idle_state = json.loads((reports / "last_run.json").read_text(encoding="utf-8"))
        assert idle_state["status"] == "IDLE"

        # Zero-argument failure must remain non-interactive, keep the failed input, and stop before later packages.
        zero_fail = make_zip(project / "patchs" / "patch_phase1_zero_fail.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text(manifest("zero_fail", "Keep failed package for AI correction.")),
            "PATCH_TOOL_OPS.json": json_text({"schema_version": 1, "patch_name": "zero_fail", "ops": [{
                "kind": "replace", "file": "src/zero_order.txt", "old": "anchor that does not exist", "new": "never"
            }]}),
        })
        zero_pending = make_zip(project / "patchs" / "patch_phase2_zero_pending.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text(manifest("zero_pending", "Must remain pending after prior failure.")),
            "PATCH_TOOL_OPS.json": json_text({"schema_version": 1, "patch_name": "zero_pending", "ops": [{
                "kind": "write", "file": "src/zero_pending.txt", "content": "should not run\n"
            }]}),
        })
        failed_zero_run = run([str(project / "tools" / "run_python_patches.sh")], project, expect=None, input_text="a\n")
        assert failed_zero_run.returncode != 0
        assert "AUTO STOP:" in failed_zero_run.stdout and "Available patch files/packages" in failed_zero_run.stdout
        assert zero_fail.is_file() and zero_pending.is_file()
        assert not (project / "src" / "zero_pending.txt").exists()
        failed_state = json.loads((reports / "last_run.json").read_text(encoding="utf-8"))
        assert failed_state["status"] == "FAIL" and failed_state["processed_count"] == 1
        assert failed_state["remaining_count"] == 1
        assert failed_state["results"][0]["ai_handoff"]

        # v5.9 multi-machine/local-history rules and queue hygiene.
        for waiting in list((project / "patchs").iterdir()):
            if waiting.is_file() and waiting.name.lower().endswith((".py", ".zip", ".tar.gz", ".tgz")):
                waiting.unlink()

        identity_file = project / ".python_patch_tool_project.json"
        assert identity_file.is_file()
        identity_data = json.loads(identity_file.read_text(encoding="utf-8"))
        assert identity_data["project_key"] == "patch-tool-self-test" and identity_data["local_only"] is True

        hygiene_target = project / "src" / "hygiene.txt"
        hygiene_target.write_text("base\n", encoding="utf-8")
        git(project, "add", "src/hygiene.txt")
        git(project, "commit", "-qm", "Add v5.9 queue hygiene fixture")
        canonical_files = {
            "PATCH_TOOL_MANIFEST.json": json_text(manifest("v58_local_history", "Record one successful local package.")),
            "PATCH_TOOL_OPS.json": json_text({"schema_version": 1, "patch_name": "v58_local_history", "ops": [{
                "kind": "replace", "file": "src/hygiene.txt", "old": "base", "new": "base\napplied"
            }]}),
        }
        canonical_patch = make_zip(project / "patchs" / "patch_phase1_v58_local_history.zip", canonical_files)
        first_local = run([str(project / "tools" / "run_python_patches.sh")], project, expect=0, input_text="a\n")
        assert "PROJECT KEY: patch-tool-self-test" in first_local.stdout
        assert hygiene_target.read_text(encoding="utf-8") == "base\napplied\n"
        local_history = project / "patchs" / "reports" / ".patch_tool_local_history" / "successful.jsonl"
        assert local_history.is_file() and "v58_local_history" in local_history.read_text(encoding="utf-8")

        # Repacked/renamed canonical payload is skipped on this machine only.
        duplicate_patch = make_zip(project / "patchs" / "renamed_duplicate_payload.zip", canonical_files)
        duplicate_run = run([str(project / "tools" / "run_python_patches.sh")], project, expect=0)
        assert "same canonical patch payload already PASSed on this machine" in duplicate_run.stdout
        assert not duplicate_patch.exists()
        assert any((project / "patchs" / "ignored" / "duplicate_success").glob("renamed_duplicate_payload*.zip"))
        duplicate_state = json.loads((reports / "last_run.json").read_text(encoding="utf-8"))
        assert duplicate_state["history_scope"] == "LOCAL_MACHINE_ONLY"
        assert duplicate_state["history_is_not_sequence_constraint"] is True
        assert duplicate_state["skipped"][0]["category"] == "duplicate_success"

        # When a duplicate and a fresh package coexist, the duplicate must remain
        # visible inside the selector as an auto-skipped item instead of appearing
        # to vanish after queue hygiene.
        selector_duplicate = make_zip(project / "patchs" / "duplicate_visible_in_selector.zip", canonical_files)
        selector_fresh = make_zip(project / "patchs" / "fresh_visible_in_selector.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text(manifest("fresh_visible_in_selector", "Fresh package kept selectable beside a duplicate.")),
            "PATCH_TOOL_OPS.json": json_text({"schema_version": 1, "patch_name": "fresh_visible_in_selector", "ops": [{
                "kind": "write", "file": "src/fresh_visible.txt", "content": "fresh\n"
            }]})
        })
        selector_preview = run([str(project / "tools" / "run_python_patches.sh")], project, expect=0, input_text="q\n")
        assert "TỰ ĐỘNG BỎ QUA TRƯỚC KHI CHỌN (1)" in selector_preview.stdout
        assert "SKIPPED:DUPLICATE - ALREADY PASS" in selector_preview.stdout
        assert "duplicate_visible_in_selector.zip" in selector_preview.stdout
        assert "fresh_visible_in_selector.zip" in selector_preview.stdout
        assert not selector_duplicate.exists()
        assert selector_fresh.exists()
        selector_fresh.unlink()

        # A handoff/report ZIP in patchs is not executed and is removed from the queue.
        handoff_mistake = make_zip(project / "patchs" / "mistaken_AI_HANDOFF.zip", {
            "START_HERE.md": "This is a handoff, not a patch.\n",
            "AI_SUMMARY/summary.txt": "FAIL evidence only\n",
        })
        handoff_run = run([str(project / "tools" / "run_python_patches.sh")], project, expect=0)
        assert "handoff/report/tool signatures" in handoff_run.stdout
        assert not handoff_mistake.exists()
        assert any((project / "patchs" / "ignored" / "non_patch").glob("mistaken_AI_HANDOFF*.zip"))

        # Foreign-project patch is warning-only and never mutates this repository.
        foreign_manifest = manifest("foreign_patch", "Must be skipped for a different project.")
        foreign_manifest["project"]["key"] = "another-project"
        foreign_patch = make_zip(project / "patchs" / "patch_foreign_project.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text(foreign_manifest),
            "PATCH_TOOL_OPS.json": json_text({"schema_version": 1, "patch_name": "foreign", "ops": [{
                "kind": "write", "file": "src/foreign.txt", "content": "must not exist\n"
            }]}),
        })
        foreign_run = run([str(project / "tools" / "run_python_patches.sh")], project, expect=0)
        assert "does not match local project" in foreign_run.stdout
        assert not foreign_patch.exists() and not (project / "src" / "foreign.txt").exists()
        assert any((project / "patchs" / "ignored" / "foreign_project").glob("patch_foreign_project*.zip"))

        # Simulated second machine: no identity/history, source is copied through Git, first valid patch supplies identity.
        machine2 = base / "machine2"
        machine2.mkdir()
        install2 = run([PYTHON, str(INSTALLER), "--project-root", str(machine2)], ROOT)
        assert "Package integrity: PASS" in install2.stdout
        git(machine2, "init", "-q")
        git(machine2, "config", "user.name", "Patch Tool Machine 2")
        git(machine2, "config", "user.email", "machine2@example.invalid")
        (machine2 / "src").mkdir()
        (machine2 / "src" / "machine.txt").write_text("m2\n", encoding="utf-8")
        git(machine2, "add", ".")
        git(machine2, "commit", "-qm", "Machine 2 baseline")
        assert not (machine2 / ".python_patch_tool_project.json").exists()
        m2_foreign_manifest = manifest("machine2_foreign", "Must not decide identity when not selected.")
        m2_foreign_manifest["project"]["key"] = "wrong-machine2-project"
        m2_foreign = make_zip(machine2 / "patchs" / "patch_phase1_machine2_foreign.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text(m2_foreign_manifest),
            "PATCH_TOOL_OPS.json": json_text({"schema_version": 1, "patch_name": "machine2_foreign", "ops": [{
                "kind": "write", "file": "src/wrong_machine2.txt", "content": "must not run\n"
            }]}),
        })
        m2_manifest = manifest("machine2_first", "Adopt identity from first selected patch on this machine.")
        m2_patch = make_zip(machine2 / "patchs" / "patch_phase2_machine2_first.zip", {
            "PATCH_TOOL_MANIFEST.json": json_text(m2_manifest),
            "PATCH_TOOL_OPS.json": json_text({"schema_version": 1, "patch_name": "machine2_first", "ops": [{
                "kind": "replace", "file": "src/machine.txt", "old": "m2", "new": "m2-applied"
            }]}),
        })
        m2_run = run([str(machine2 / "tools" / "run_python_patches.sh")], machine2, expect=0, input_text="2\n")
        assert "PROJECT IDENTITY ADOPTED: patch-tool-self-test" in m2_run.stdout
        assert not (machine2 / "src" / "wrong_machine2.txt").exists()
        assert not m2_foreign.exists()
        assert any((machine2 / "patchs" / "ignored" / "foreign_project").glob("patch_phase1_machine2_foreign*.zip"))
        m2_identity = json.loads((machine2 / ".python_patch_tool_project.json").read_text(encoding="utf-8"))
        assert m2_identity["project_key"] == "patch-tool-self-test"
        m2_last = json.loads((machine2 / "patchs" / "reports" / "last_run.json").read_text(encoding="utf-8"))
        assert m2_last["history_is_not_sequence_constraint"] is True
        assert str(machine2.resolve()) not in json.dumps(m2_last, ensure_ascii=False)

        # Upgrade layout migration removes only known loose managed files and keeps unrelated tools.
        legacy_tool = project / "tools" / "python_patch_runner.py"
        legacy_tool.write_text("legacy managed runner\n", encoding="utf-8")
        unrelated_tool = project / "tools" / "project_specific_tool.py"
        unrelated_tool.write_text("print('keep me')\n", encoding="utf-8")
        migration = run([PYTHON, str(INSTALLER), "--project-root", str(project)], ROOT)
        assert "legacy files migrated: 1" in migration.stdout
        assert not legacy_tool.exists() and unrelated_tool.is_file()
        assert list((project / "patchs" / "backup" / "tools" / "python_patch_runner.py").glob("*.bak"))

        print("Python Patch Tool v5.16.0 portable self-test: PASS")
        print("Validated: package hashes, installer/idempotency, data-only patches, Git isolation,")
        print("preflight isolation, syntax hints, stale-anchor context, smart C-build filtering,")
        print("raw-log preservation, structured diagnostics, crash isolation, traversal rejection,")
        print("four-bundle integrity, source drift, symbol context, root-cause clustering, secret-file exclusion,")
        print("transaction discard/apply/rollback/conflict, idempotency rejection, process-tree cleanup,")
        print("validation impact selection, safe diagnostic rerun, compact failure delta/history, interactive multi-select zero-argument workflow,")
        print("multi-machine local-history semantics, project identity adoption, duplicate suppression, queue hygiene,\n        secure log redaction, environment fingerprinting, diagnostic quality, and generalized code collection, safe change-gated post-patch commands, and Patch Tool v4 compatibility.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"SELF-TEST FAIL: {exc}", file=sys.stderr)
        raise
