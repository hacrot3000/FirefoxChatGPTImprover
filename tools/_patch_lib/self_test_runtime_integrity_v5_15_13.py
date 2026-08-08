#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import time
import zipfile

HERE = Path(__file__).resolve().parent
GUARD = HERE / "python_patch_runtime_guard.py"


def mkzip(path: Path, text: str) -> None:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("payload.txt", text)

def mkopszip(path: Path, target: str, *, content: str = "NEW") -> None:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("PATCH_TOOL_MANIFEST.json", json.dumps({"schema_version":1,"project":{"key":"test"},"patch":{"id":path.stem,"version":"v5.15.13","phase":"test","phase_under_test":"test","summary":"test","regression_scope":"test"}}))
        z.writestr("PATCH_TOOL_OPS.json", json.dumps({"schema_version":1,"patch_name":path.stem,"ops":[{"id":"w","kind":"write","file":target,"content":content,"create":True}]}))


def digest(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()

def identity(path: Path) -> dict:
    st = path.stat()
    return {
        "sha256": digest(path),
        "size": st.st_size,
        "dev": st.st_dev,
        "ino": st.st_ino,
        "mtime_ns": st.st_mtime_ns,
        "ctime_ns": st.st_ctime_ns,
    }


def evidence(path: Path) -> dict:
    if not path.is_file():
        return {"exists": False}
    st = path.stat()
    return {
        "exists": True,
        "sha256": digest(path),
        "size": st.st_size,
        "mtime_ns": st.st_mtime_ns,
    }


def run(cmd, *, cwd, env=None):
    return subprocess.run(cmd, cwd=cwd, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)


def base_dirs(root: Path):
    p = root / "patchs"
    lib = root / "tools" / "_patch_lib"
    rep = p / "reports"
    ig = p / "ignored" / "duplicate_success"
    pa = p / "patched"
    for d in (p, lib, rep, ig, pa):
        d.mkdir(parents=True, exist_ok=True)
    return p, lib, rep, ig, pa


def guard_cmd(root: Path, runner: Path, *args: str) -> list[str]:
    return [sys.executable, str(GUARD), "--project-root", str(root), "--runner", str(runner), "--", *args]


def test_current_run_evidence_overrides_stale_last_run() -> None:
    with tempfile.TemporaryDirectory(prefix="ptv51513_stale_") as td:
        root = Path(td); p, lib, rep, ig, pa = base_dirs(root)
        mkzip(p / "patch_A.zip", "A")
        mkzip(p / "patch_B.zip", "B")
        # Previous run says B executed. This must not leak into the current run.
        (rep / "last_run.json").write_text(json.dumps({"executed": [{"name": "patch_B.zip"}]}))
        (rep / "LAST_RUN.md").write_text("PATCHES EXECUTED:\n- patch_B.zip\nPATCHES SKIPPED / NOT EXECUTED:\n")
        runner = lib / "python_patch_runner.py"
        runner.write_text(textwrap.dedent("""\
            from pathlib import Path
            import json, shutil
            r=Path.cwd(); p=r/'patchs'; rep=p/'reports'; ig=p/'ignored'/'duplicate_success'; pa=p/'patched'
            shutil.move(str(p/'patch_A.zip'), str(pa/'patch_A.zip'))
            shutil.move(str(p/'patch_B.zip'), str(ig/'patch_B.zip'))
            h=rep/'.patch_tool_local_history'/'successful.jsonl'; h.parent.mkdir(parents=True,exist_ok=True)
            h.write_text(json.dumps({'package':'patch_A.zip','status':'PASS'})+'\\n'+json.dumps({'package':'patch_B.zip','status':'PASS'})+'\\n')
            (rep/'last_run.json').write_text(json.dumps({'executed':[{'name':'patch_A.zip','status':'PASS'}],'skipped':[{'name':'patch_B.zip','category':'duplicate_success'}]}))
            (rep/'LAST_RUN.md').write_text('PATCHES EXECUTED:\\n- patch_A.zip\\nPATCHES SKIPPED / NOT EXECUTED:\\n- patch_B.zip\\n')
        """))
        res = run(guard_cmd(root, runner, "--transaction", "off"), cwd=root)
        assert res.returncode == 0, res.stdout
        assert (p / "patch_B.zip").is_file(), res.stdout
        assert not (p / "patch_A.zip").exists(), res.stdout
        hist = (rep / ".patch_tool_local_history" / "successful.jsonl").read_text()
        assert "patch_A.zip" in hist and "patch_B.zip" not in hist, hist


def test_basename_only_history_does_not_attest_changed_content_and_rename_recovers() -> None:
    with tempfile.TemporaryDirectory(prefix="ptv51513_name_") as td:
        root = Path(td); p, lib, rep, ig, _pa = base_dirs(root)
        mkzip(p / "patch_B.zip", "NEW-CONTENT")
        hist = rep / ".patch_tool_local_history" / "successful.jsonl"
        hist.parent.mkdir(parents=True, exist_ok=True)
        hist.write_text(json.dumps({'package':'patch_B.zip','status':'PASS'})+'\n')  # weak old record, no digest
        runner = lib / "python_patch_runner.py"
        runner.write_text(textwrap.dedent("""\
            from pathlib import Path
            import json, shutil
            r=Path.cwd(); p=r/'patchs'; rep=p/'reports'; ig=p/'ignored'/'duplicate_success'
            shutil.move(str(p/'patch_B.zip'), str(ig/'renamed_by_core_patch_B.zip'))
            h=rep/'.patch_tool_local_history'/'successful.jsonl'
            with h.open('a') as f: f.write(json.dumps({'package':'patch_B.zip','status':'PASS'})+'\\n')
            (rep/'last_run.json').write_text(json.dumps({'executed':[],'skipped':[{'name':'patch_B.zip','category':'duplicate_success'}]}))
            (rep/'LAST_RUN.md').write_text('PATCHES EXECUTED:\\nPATCHES SKIPPED / NOT EXECUTED:\\n- patch_B.zip\\n')
        """))
        res = run(guard_cmd(root, runner, "--transaction", "off"), cwd=root)
        assert res.returncode == 0, res.stdout
        assert (p / "patch_B.zip").is_file(), res.stdout
        assert "basename-only historical success" in res.stdout, res.stdout
        lines = hist.read_text().splitlines()
        assert len(lines) == 1, lines  # old weak record kept, new false record removed


def test_strong_digest_history_keeps_true_duplicate_quarantined() -> None:
    with tempfile.TemporaryDirectory(prefix="ptv51513_digest_") as td:
        root = Path(td); p, lib, rep, ig, _pa = base_dirs(root)
        pkg = p / "patch_D.zip"; mkzip(pkg, "D"); dg = digest(pkg)
        hist = rep / ".patch_tool_local_history" / "successful.jsonl"
        hist.parent.mkdir(parents=True, exist_ok=True)
        hist.write_text(json.dumps({'package':'patch_D.zip','sha256':dg,'status':'PASS'})+'\n')
        runner = lib / "python_patch_runner.py"
        runner.write_text(textwrap.dedent("""\
            from pathlib import Path
            import json, shutil
            r=Path.cwd(); p=r/'patchs'; rep=p/'reports'; ig=p/'ignored'/'duplicate_success'
            shutil.move(str(p/'patch_D.zip'), str(ig/'patch_D.zip'))
            (rep/'last_run.json').write_text(json.dumps({'executed':[],'skipped':[{'name':'patch_D.zip','category':'duplicate_success'}]}))
            (rep/'LAST_RUN.md').write_text('PATCHES EXECUTED:\\nPATCHES SKIPPED / NOT EXECUTED:\\n- patch_D.zip\\n')
        """))
        res = run(guard_cmd(root, runner, "--transaction", "off"), cwd=root)
        assert res.returncode == 0, res.stdout
        assert not (p / "patch_D.zip").exists(), res.stdout
        assert (ig / "patch_D.zip").is_file(), res.stdout


def test_no_current_evidence_never_uses_stale_report() -> None:
    with tempfile.TemporaryDirectory(prefix="ptv51513_noevidence_") as td:
        root = Path(td); p, lib, rep, ig, _pa = base_dirs(root)
        mkzip(p / "patch_B.zip", "B")
        (rep / "last_run.json").write_text(json.dumps({'executed':[{'name':'patch_B.zip'}]}))
        (rep / "LAST_RUN.md").write_text('PATCHES EXECUTED:\n- patch_B.zip\nPATCHES SKIPPED / NOT EXECUTED:\n')
        runner = lib / "python_patch_runner.py"
        runner.write_text("from pathlib import Path\nimport shutil\nr=Path.cwd(); p=r/'patchs'; ig=p/'ignored'/'duplicate_success'; shutil.move(str(p/'patch_B.zip'), str(ig/'patch_B.zip'))\n")
        res = run(guard_cmd(root, runner, "--transaction", "off"), cwd=root)
        assert res.returncode == 0, res.stdout
        assert "No current-invocation last_run evidence" in res.stdout, res.stdout
        # Conservative: do not mutate queue/history without current execution evidence.
        assert (ig / "patch_B.zip").is_file(), res.stdout


def test_adaptive_reprobe_off_does_not_measure_patch_git_worktree() -> None:
    with tempfile.TemporaryDirectory(prefix="ptv51513_sbx_") as td:
        root = Path(td); _p, lib, rep, _ig, _pa = base_dirs(root)
        runner = lib / "python_patch_runner.py"
        runner.write_text(textwrap.dedent("""\
            import json, subprocess, sys
            from pathlib import Path
            r=Path.cwd(); rep=r/'patchs'/'reports'; args=sys.argv[1:]
            # Even with transaction off, simulate a patch's own unrelated git-worktree-looking child.
            subprocess.check_call([sys.executable,'-c','import time; time.sleep(.12)','git','worktree','add','patch-owned'])
            (rep/'last_run.json').write_text(json.dumps({'executed':[]}))
            (rep/'LAST_RUN.md').write_text('PATCHES EXECUTED:\\nPATCHES SKIPPED / NOT EXECUTED:\\n')
        """))
        env={**os.environ,"PTV_SANDBOX_SLOW_SECONDS":"0.05"}
        res = run(guard_cmd(root, runner, "--transaction", "off"), cwd=root, env=env)
        assert res.returncode == 0, res.stdout
        state = json.loads((rep/'.patch_tool_local_history'/'sandbox_performance.json').read_text())
        assert "last_prepare_seconds" not in state, state
        assert state['last_decision'] == 'explicit_off', state


def test_stale_active_marker_and_project_lock() -> None:
    with tempfile.TemporaryDirectory(prefix="ptv51513_lock_") as td:
        root = Path(td); _p, lib, rep, _ig, _pa = base_dirs(root)
        local=rep/'.patch_tool_local_history'; local.mkdir(parents=True,exist_ok=True)
        (local/'active_run.json').write_text(json.dumps({'pid':999999,'started_at':'old'}))
        runner = lib / "python_patch_runner.py"
        runner.write_text("import json,time\nfrom pathlib import Path\nr=Path.cwd(); rep=r/'patchs'/'reports'; (rep/'last_run.json').write_text(json.dumps({'executed':[]})); (rep/'LAST_RUN.md').write_text('PATCHES EXECUTED:\\nPATCHES SKIPPED / NOT EXECUTED:\\n'); time.sleep(.5)\n")
        cmd=guard_cmd(root, runner, "--transaction", "off")
        first=subprocess.Popen(cmd,cwd=root,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
        time.sleep(.15)
        second=run(cmd,cwd=root,env={**os.environ,'PTV_RUN_LOCK_WAIT_SECONDS':'0.1'})
        assert second.returncode==75, second.stdout
        first.wait(timeout=3); first_out=first.stdout.read() if first.stdout else ''
        assert first.returncode==0, first_out
        assert 'Recovered stale active-run marker' in first_out, first_out
        assert not (local/'active_run.json').exists()


def test_stale_invocation_journal_is_archived_without_auto_rerun() -> None:
    with tempfile.TemporaryDirectory(prefix="ptv51513_journal_") as td:
        root = Path(td); p, lib, rep, _ig, _pa = base_dirs(root)
        mkzip(p / "patch_A.zip", "A")
        local = rep / ".patch_tool_local_history"; local.mkdir(parents=True, exist_ok=True)
        (local / "guard_invocation.json").write_text(json.dumps({
            "schema": 1, "pid": 999999, "started_at": "old",
            "queue_before": {"patch_old.zip": {"sha256": "deadbeef"}}, "state": "running"
        }))
        runner = lib / "python_patch_runner.py"
        runner.write_text(textwrap.dedent("""\
            import json
            from pathlib import Path
            r=Path.cwd(); rep=r/'patchs'/'reports'
            (rep/'last_run.json').write_text(json.dumps({'executed':[]}))
            (rep/'LAST_RUN.md').write_text('PATCHES EXECUTED:\\nPATCHES SKIPPED / NOT EXECUTED:\\n')
        """))
        res = run(guard_cmd(root, runner, "--transaction", "off"), cwd=root)
        assert res.returncode == 0, res.stdout
        assert "no trustworthy post-core checkpoint" in res.stdout, res.stdout
        assert (local / "guard_last_invocation.json").is_file()
        assert not (local / "guard_invocation.json").exists()
        assert (p / "patch_A.zip").is_file(), res.stdout



def test_executed_fail_cannot_create_success_history() -> None:
    with tempfile.TemporaryDirectory(prefix="ptv51513_fail_ledger_") as td:
        root = Path(td); p, lib, rep, _ig, _pa = base_dirs(root)
        pkg = p / "patch_FAIL.zip"; mkzip(pkg, "FAIL-CONTENT")
        runner = lib / "python_patch_runner.py"
        runner.write_text(textwrap.dedent("""\
            from pathlib import Path
            import json
            r=Path.cwd(); p=r/'patchs'; rep=p/'reports'
            h=rep/'.patch_tool_local_history'/'successful.jsonl'; h.parent.mkdir(parents=True,exist_ok=True)
            h.write_text(json.dumps({'package':'patch_FAIL.zip','status':'PASS'})+'\\n')
            (rep/'last_run.json').write_text(json.dumps({'status':'FAIL','executed':[{'name':'patch_FAIL.zip','status':'FAIL'}]}))
            (rep/'LAST_RUN.md').write_text('STATUS: FAIL\\nPATCHES EXECUTED:\\n- [FAIL] patch_FAIL.zip\\nPATCHES SKIPPED / NOT EXECUTED:\\n')
            raise SystemExit(1)
        """))
        res = run(guard_cmd(root, runner, "--transaction", "off"), cwd=root)
        assert res.returncode == 1, res.stdout
        hist = rep / ".patch_tool_local_history" / "successful.jsonl"
        assert hist.read_text() == "", hist.read_text()
        assert (p / "patch_FAIL.zip").is_file(), res.stdout
        assert "Removed 1 newly-created false success-history" in res.stdout, res.stdout


def test_shared_digest_does_not_delete_real_pass_history() -> None:
    with tempfile.TemporaryDirectory(prefix="ptv51513_shared_digest_") as td:
        root = Path(td); p, lib, rep, ig, pa = base_dirs(root)
        # Copy the exact same ZIP bytes under two different package names.
        mkzip(p / "patch_A.zip", "SAME")
        (p / "patch_B.zip").write_bytes((p / "patch_A.zip").read_bytes())
        dg = digest(p / "patch_A.zip")
        runner = lib / "python_patch_runner.py"
        runner.write_text(textwrap.dedent(f"""\
            from pathlib import Path
            import json, shutil
            r=Path.cwd(); p=r/'patchs'; rep=p/'reports'; ig=p/'ignored'/'duplicate_success'; pa=p/'patched'
            shutil.move(str(p/'patch_A.zip'), str(pa/'patch_A.zip'))
            shutil.move(str(p/'patch_B.zip'), str(ig/'patch_B.zip'))
            h=rep/'.patch_tool_local_history'/'successful.jsonl'; h.parent.mkdir(parents=True,exist_ok=True)
            with h.open('a') as f:
                f.write(json.dumps({{'sha256':'{dg}','status':'PASS'}})+'\\n')
                f.write(json.dumps({{'package':'patch_B.zip','sha256':'{dg}','status':'PASS'}})+'\\n')
            (rep/'last_run.json').write_text(json.dumps({{'status':'PASS','executed':[{{'name':'patch_A.zip','status':'PASS'}}],'skipped':[{{'name':'patch_B.zip','category':'duplicate_success'}}]}}))
            (rep/'LAST_RUN.md').write_text('STATUS: PASS\\nPATCHES EXECUTED:\\n- [PASS] patch_A.zip\\nPATCHES SKIPPED / NOT EXECUTED:\\n- [SKIPPED:DUPLICATE_SUCCESS] patch_B.zip\\n')
        """))
        res = run(guard_cmd(root, runner, "--transaction", "off"), cwd=root)
        assert res.returncode == 0, res.stdout
        assert (p / "patch_B.zip").is_file(), res.stdout
        lines = (rep / ".patch_tool_local_history" / "successful.jsonl").read_text().splitlines()
        assert len(lines) == 1, lines
        kept = json.loads(lines[0])
        assert kept.get('sha256') == dg and 'package' not in kept, lines


def test_overall_pass_promotes_legacy_executed_unknown_to_pass() -> None:
    with tempfile.TemporaryDirectory(prefix="ptv51513_legacy_pass_") as td:
        root = Path(td); p, lib, rep, _ig, pa = base_dirs(root)
        mkzip(p / "patch_A.zip", "A")
        runner = lib / "python_patch_runner.py"
        runner.write_text(textwrap.dedent("""\
            from pathlib import Path
            import json, shutil
            r=Path.cwd(); p=r/'patchs'; rep=p/'reports'; pa=p/'patched'
            shutil.move(str(p/'patch_A.zip'), str(pa/'patch_A.zip'))
            h=rep/'.patch_tool_local_history'/'successful.jsonl'; h.parent.mkdir(parents=True,exist_ok=True)
            h.write_text(json.dumps({'package':'patch_A.zip','status':'PASS'})+'\\n')
            (rep/'last_run.json').write_text(json.dumps({'status':'PASS','executed':[{'name':'patch_A.zip'}]}))
            (rep/'LAST_RUN.md').write_text('STATUS: PASS\\nPATCHES EXECUTED:\\n- patch_A.zip\\nPATCHES SKIPPED / NOT EXECUTED:\\n')
        """))
        res = run(guard_cmd(root, runner, "--transaction", "off"), cwd=root)
        assert res.returncode == 0, res.stdout
        hist = (rep / ".patch_tool_local_history" / "successful.jsonl").read_text()
        assert "patch_A.zip" in hist, hist
        assert not (p / "patch_A.zip").exists(), res.stdout


def test_unselected_modified_same_inode_is_restored_with_new_bytes() -> None:
    with tempfile.TemporaryDirectory(prefix="ptv51513_mutated_queue_") as td:
        root = Path(td); p, lib, rep, ig, _pa = base_dirs(root)
        pkg = p / "patch_B.zip"; mkzip(pkg, "ORIGINAL")
        original = digest(pkg)
        runner = lib / "python_patch_runner.py"
        runner.write_text(textwrap.dedent("""\
            from pathlib import Path
            import json, shutil, zipfile
            r=Path.cwd(); p=r/'patchs'; rep=p/'reports'; ig=p/'ignored'/'duplicate_success'
            b=p/'patch_B.zip'
            # Simulate another actor updating the queued package while selector is open.
            tmp=p/'payload.tmp'
            with zipfile.ZipFile(tmp,'w',compression=zipfile.ZIP_DEFLATED) as z: z.writestr('payload.txt','UPDATED')
            # Preserve inode: overwrite bytes in place rather than os.replace.
            b.write_bytes(tmp.read_bytes()); tmp.unlink()
            shutil.move(str(b), str(ig/'patch_B.zip'))
            h=rep/'.patch_tool_local_history'/'successful.jsonl'; h.parent.mkdir(parents=True,exist_ok=True)
            h.write_text(json.dumps({'package':'patch_B.zip','status':'PASS'})+'\\n')
            (rep/'last_run.json').write_text(json.dumps({'status':'PASS','executed':[],'skipped':[{'name':'patch_B.zip','category':'duplicate_success'}]}))
            (rep/'LAST_RUN.md').write_text('STATUS: PASS\\nPATCHES EXECUTED:\\nPATCHES SKIPPED / NOT EXECUTED:\\n- [SKIPPED:DUPLICATE_SUCCESS] patch_B.zip\\n')
        """))
        res = run(guard_cmd(root, runner, "--transaction", "off"), cwd=root)
        assert res.returncode == 0, res.stdout
        restored = p / "patch_B.zip"
        assert restored.is_file(), res.stdout
        assert digest(restored) != original, (original, digest(restored), res.stdout)
        assert "changed content while the selection run was active" in res.stdout, res.stdout
        hist = rep/'.patch_tool_local_history'/'successful.jsonl'
        assert hist.read_text() == '', hist.read_text()


def test_stale_journal_with_own_last_run_restores_proven_unexecuted() -> None:
    with tempfile.TemporaryDirectory(prefix="ptv51513_stale_reconcile_") as td:
        root = Path(td); p, lib, rep, ig, pa = base_dirs(root)
        a = p / "patch_A.zip"; b = p / "patch_B.zip"
        mkzip(a, "A"); mkzip(b, "B")
        aid, bid = identity(a), identity(b)
        local = rep / '.patch_tool_local_history'; local.mkdir(parents=True, exist_ok=True)
        history = local / 'successful.jsonl'; history.write_text('')
        pre_json = {'exists': False}; pre_md = {'exists': False}
        run_start = time.time_ns()
        shutil = __import__('shutil')
        shutil.move(str(a), str(pa/'patch_A.zip'))
        shutil.move(str(b), str(ig/'patch_B.zip'))
        history.write_text(json.dumps({'package':'patch_A.zip','sha256':aid['sha256'],'status':'PASS'})+'\n'+json.dumps({'package':'patch_B.zip','sha256':bid['sha256'],'status':'PASS'})+'\n')
        (rep/'last_run.json').write_text(json.dumps({'status':'PASS','executed':[{'name':'patch_A.zip','status':'PASS'}],'skipped':[{'name':'patch_B.zip','category':'duplicate_success'}]}))
        (rep/'LAST_RUN.md').write_text('STATUS: PASS\nPATCHES EXECUTED:\n- [PASS] patch_A.zip\nPATCHES SKIPPED / NOT EXECUTED:\n- [SKIPPED:DUPLICATE_SUCCESS] patch_B.zip\n')
        post_history = history.read_bytes(); core_end = time.time_ns()
        (local/'guard_invocation.json').write_text(json.dumps({
            'schema': 1, 'guard_version':'5.15.13', 'pid':999999, 'started_at':'old',
            'run_start_wall_ns': run_start, 'core_completed_wall_ns': core_end,
            'queue_before': {'patch_A.zip':aid,'patch_B.zip':bid},
            'core_args': [], 'pre_evidence': {'last_run.json':pre_json,'LAST_RUN.md':pre_md},
            'post_evidence': {'last_run.json':evidence(rep/'last_run.json'),'LAST_RUN.md':evidence(rep/'LAST_RUN.md')},
            'pre_history_size':0, 'pre_history_sha256':hashlib.sha256(b'').hexdigest(),
            'post_history_size':len(post_history), 'post_history_sha256':hashlib.sha256(post_history).hexdigest(),
            'state':'core_completed', 'core_returncode':0
        }))
        runner = lib / 'python_patch_runner.py'
        runner.write_text(textwrap.dedent("""\
            import json
            from pathlib import Path
            r=Path.cwd(); rep=r/'patchs'/'reports'
            (rep/'last_run.json').write_text(json.dumps({'status':'PASS','executed':[]}))
            (rep/'LAST_RUN.md').write_text('STATUS: PASS\\nPATCHES EXECUTED:\\nPATCHES SKIPPED / NOT EXECUTED:\\n')
        """))
        res = run(guard_cmd(root, runner, '--transaction', 'off'), cwd=root)
        assert res.returncode == 0, res.stdout
        assert (p/'patch_B.zip').is_file(), res.stdout
        assert not (p/'patch_A.zip').exists(), res.stdout
        lines = history.read_text().splitlines()
        assert len(lines) == 1 and 'patch_A.zip' in lines[0] and 'patch_B.zip' not in lines[0], lines
        assert 'CRASH-RECOVERY' in res.stdout, res.stdout


def test_stale_journal_without_own_evidence_remains_ambiguous() -> None:
    with tempfile.TemporaryDirectory(prefix="ptv51513_stale_ambiguous_") as td:
        root = Path(td); p, lib, rep, ig, _pa = base_dirs(root)
        b = p/'patch_B.zip'; mkzip(b,'B'); bid=identity(b)
        local=rep/'.patch_tool_local_history'; local.mkdir(parents=True,exist_ok=True)
        __import__('shutil').move(str(b), str(ig/'patch_B.zip'))
        (local/'guard_invocation.json').write_text(json.dumps({
            'schema':1,'pid':999999,'started_at':'old','run_start_wall_ns':time.time_ns(),
            'queue_before':{'patch_B.zip':bid},'pre_evidence':{'last_run.json':{'exists':False},'LAST_RUN.md':{'exists':False}},
            'pre_history_size':0,'pre_history_sha256':hashlib.sha256(b'').hexdigest(),'state':'running'
        }))
        runner=lib/'python_patch_runner.py'
        runner.write_text(textwrap.dedent("""\
            import json
            from pathlib import Path
            r=Path.cwd(); rep=r/'patchs'/'reports'
            (rep/'last_run.json').write_text(json.dumps({'status':'PASS','executed':[]}))
            (rep/'LAST_RUN.md').write_text('STATUS: PASS\\nPATCHES EXECUTED:\\nPATCHES SKIPPED / NOT EXECUTED:\\n')
        """))
        # The new files above are written only by the *current* invocation, so stale recovery sees no prior evidence.
        # To model that, make runner create them after guard startup as it normally does.
        res=run(guard_cmd(root,runner,'--transaction','off'),cwd=root)
        assert res.returncode==0,res.stdout
        assert (ig/'patch_B.zip').is_file(),res.stdout
        assert not (p/'patch_B.zip').exists(),res.stdout
        assert 'no trustworthy post-core checkpoint' in res.stdout,res.stdout


def test_stale_partial_report_does_not_restore_unmentioned_package() -> None:
    with tempfile.TemporaryDirectory(prefix="ptv51513_partial_stale_") as td:
        root=Path(td); p,lib,rep,ig,pa=base_dirs(root)
        a=p/'patch_A.zip'; b=p/'patch_B.zip'; mkzip(a,'A'); mkzip(b,'B')
        aid,bid=identity(a),identity(b)
        local=rep/'.patch_tool_local_history'; local.mkdir(parents=True,exist_ok=True)
        history=local/'successful.jsonl'; history.write_text('')
        run_start=time.time_ns()
        __import__('shutil').move(str(a),str(pa/'patch_A.zip'))
        __import__('shutil').move(str(b),str(ig/'patch_B.zip'))
        (rep/'last_run.json').write_text(json.dumps({'status':'FAIL','executed':[{'name':'patch_A.zip','status':'FAIL'}]}))
        (rep/'LAST_RUN.md').write_text('STATUS: FAIL\nPATCHES EXECUTED:\n- [FAIL] patch_A.zip\nPATCHES SKIPPED / NOT EXECUTED:\n')
        post_history=history.read_bytes(); core_end=time.time_ns()
        (local/'guard_invocation.json').write_text(json.dumps({
            'schema':1,'pid':999999,'started_at':'old','run_start_wall_ns':run_start,'core_completed_wall_ns':core_end,
            'queue_before':{'patch_A.zip':aid,'patch_B.zip':bid},
            'pre_evidence':{'last_run.json':{'exists':False},'LAST_RUN.md':{'exists':False}},
            'post_evidence':{'last_run.json':evidence(rep/'last_run.json'),'LAST_RUN.md':evidence(rep/'LAST_RUN.md')},
            'pre_history_size':0,'pre_history_sha256':hashlib.sha256(b'').hexdigest(),
            'post_history_size':len(post_history),'post_history_sha256':hashlib.sha256(post_history).hexdigest(),
            'state':'core_completed','core_returncode':1
        }))
        runner=lib/'python_patch_runner.py'
        runner.write_text(textwrap.dedent("""\
            import json
            from pathlib import Path
            r=Path.cwd(); rep=r/'patchs'/'reports'
            (rep/'last_run.json').write_text(json.dumps({'status':'PASS','executed':[]}))
            (rep/'LAST_RUN.md').write_text('STATUS: PASS\\nPATCHES EXECUTED:\\nPATCHES SKIPPED / NOT EXECUTED:\\n')
        """))
        res=run(guard_cmd(root,runner,'--transaction','off'),cwd=root)
        assert res.returncode==0,res.stdout
        assert (ig/'patch_B.zip').is_file(),res.stdout
        assert not (p/'patch_B.zip').exists(),res.stdout


def test_stale_checkpoint_rejects_later_unrelated_last_run() -> None:
    with tempfile.TemporaryDirectory(prefix="ptv51513_checkpoint_mismatch_") as td:
        root=Path(td); p,lib,rep,ig,_pa=base_dirs(root)
        b=p/'patch_B.zip'; mkzip(b,'B'); bid=identity(b)
        local=rep/'.patch_tool_local_history'; local.mkdir(parents=True,exist_ok=True)
        history=local/'successful.jsonl'; history.write_text('')
        run_start=time.time_ns(); __import__('shutil').move(str(b),str(ig/'patch_B.zip'))
        (rep/'last_run.json').write_text(json.dumps({'status':'PASS','executed':[],'skipped':[{'name':'patch_B.zip','category':'duplicate_success'}]}))
        (rep/'LAST_RUN.md').write_text('STATUS: PASS\nPATCHES EXECUTED:\nPATCHES SKIPPED / NOT EXECUTED:\n- patch_B.zip\n')
        post_history=history.read_bytes(); core_end=time.time_ns()
        journal={
            'schema':1,'guard_version':'5.15.13','pid':999999,'started_at':'old','run_start_wall_ns':run_start,'core_completed_wall_ns':core_end,
            'queue_before':{'patch_B.zip':bid},'pre_evidence':{'last_run.json':{'exists':False},'LAST_RUN.md':{'exists':False}},
            'post_evidence':{'last_run.json':evidence(rep/'last_run.json'),'LAST_RUN.md':evidence(rep/'LAST_RUN.md')},
            'pre_history_size':0,'pre_history_sha256':hashlib.sha256(b'').hexdigest(),
            'post_history_size':len(post_history),'post_history_sha256':hashlib.sha256(post_history).hexdigest(),
            'state':'core_completed','core_returncode':0
        }
        (local/'guard_invocation.json').write_text(json.dumps(journal))
        # A later unrelated direct core run rewrites LAST_RUN before the next guarded launch.
        time.sleep(.01)
        (rep/'last_run.json').write_text(json.dumps({'status':'PASS','executed':[{'name':'patch_OTHER.zip','status':'PASS'}]}))
        (rep/'LAST_RUN.md').write_text('STATUS: PASS\nPATCHES EXECUTED:\n- [PASS] patch_OTHER.zip\nPATCHES SKIPPED / NOT EXECUTED:\n')
        runner=lib/'python_patch_runner.py'
        runner.write_text(textwrap.dedent("""\
            import json
            from pathlib import Path
            r=Path.cwd(); rep=r/'patchs'/'reports'
            (rep/'last_run.json').write_text(json.dumps({'status':'PASS','executed':[]}))
            (rep/'LAST_RUN.md').write_text('STATUS: PASS\\nPATCHES EXECUTED:\\nPATCHES SKIPPED / NOT EXECUTED:\\n')
        """))
        res=run(guard_cmd(root,runner,'--transaction','off'),cwd=root)
        assert res.returncode==0,res.stdout
        assert (ig/'patch_B.zip').is_file(),res.stdout
        assert not (p/'patch_B.zip').exists(),res.stdout
        assert 'no trustworthy post-core checkpoint' in res.stdout,res.stdout


def test_stale_history_cleanup_preserves_later_appends() -> None:
    with tempfile.TemporaryDirectory(prefix="ptv51513_history_segment_") as td:
        root=Path(td); p,lib,rep,ig,pa=base_dirs(root)
        a=p/'patch_A.zip'; b=p/'patch_B.zip'; mkzip(a,'A'); mkzip(b,'B')
        aid,bid=identity(a),identity(b)
        local=rep/'.patch_tool_local_history'; local.mkdir(parents=True,exist_ok=True)
        history=local/'successful.jsonl'; history.write_text('')
        run_start=time.time_ns(); __import__('shutil').move(str(a),str(pa/'patch_A.zip')); __import__('shutil').move(str(b),str(ig/'patch_B.zip'))
        stale_lines=(json.dumps({'package':'patch_A.zip','sha256':aid['sha256'],'status':'PASS'})+'\n'+json.dumps({'package':'patch_B.zip','sha256':bid['sha256'],'status':'PASS'})+'\n').encode()
        history.write_bytes(stale_lines)
        (rep/'last_run.json').write_text(json.dumps({'status':'PASS','executed':[{'name':'patch_A.zip','status':'PASS'}],'skipped':[{'name':'patch_B.zip','category':'duplicate_success'}]}))
        (rep/'LAST_RUN.md').write_text('STATUS: PASS\nPATCHES EXECUTED:\n- [PASS] patch_A.zip\nPATCHES SKIPPED / NOT EXECUTED:\n- patch_B.zip\n')
        core_end=time.time_ns()
        (local/'guard_invocation.json').write_text(json.dumps({
            'schema':1,'guard_version':'5.15.13','pid':999999,'started_at':'old','run_start_wall_ns':run_start,'core_completed_wall_ns':core_end,
            'queue_before':{'patch_A.zip':aid,'patch_B.zip':bid},'pre_evidence':{'last_run.json':{'exists':False},'LAST_RUN.md':{'exists':False}},
            'post_evidence':{'last_run.json':evidence(rep/'last_run.json'),'LAST_RUN.md':evidence(rep/'LAST_RUN.md')},
            'pre_history_size':0,'pre_history_sha256':hashlib.sha256(b'').hexdigest(),
            'post_history_size':len(stale_lines),'post_history_sha256':hashlib.sha256(stale_lines).hexdigest(),
            'state':'core_completed','core_returncode':0
        }))
        # Later activity appends C but does not alter the checkpointed LAST_RUN files.
        with history.open('a') as f: f.write(json.dumps({'package':'patch_C.zip','sha256':'c'*64,'status':'PASS'})+'\n')
        runner=lib/'python_patch_runner.py'
        runner.write_text(textwrap.dedent("""\
            import json
            from pathlib import Path
            r=Path.cwd(); rep=r/'patchs'/'reports'
            (rep/'last_run.json').write_text(json.dumps({'status':'PASS','executed':[]}))
            (rep/'LAST_RUN.md').write_text('STATUS: PASS\\nPATCHES EXECUTED:\\nPATCHES SKIPPED / NOT EXECUTED:\\n')
        """))
        res=run(guard_cmd(root,runner,'--transaction','off'),cwd=root)
        assert res.returncode==0,res.stdout
        lines=history.read_text().splitlines()
        assert any('patch_A.zip' in x for x in lines),lines
        assert not any('patch_B.zip' in x for x in lines),lines
        assert any('patch_C.zip' in x for x in lines),lines
        assert (p/'patch_B.zip').is_file(),res.stdout


def test_executed_fail_wrongly_moved_is_restored_to_queue() -> None:
    with tempfile.TemporaryDirectory(prefix="ptv51513_failed_queue_") as td:
        root = Path(td); p, lib, rep, ig, pa = base_dirs(root)
        pkg = p / "patch_FAIL_MOVED.zip"; mkzip(pkg, "FAIL-MOVED")
        runner = lib / "python_patch_runner.py"
        runner.write_text(textwrap.dedent("""\
            from pathlib import Path
            import json, shutil
            r=Path.cwd(); p=r/'patchs'; rep=p/'reports'; pa=p/'patched'
            shutil.move(str(p/'patch_FAIL_MOVED.zip'), str(pa/'patch_FAIL_MOVED.zip'))
            h=rep/'.patch_tool_local_history'/'successful.jsonl'; h.parent.mkdir(parents=True,exist_ok=True)
            h.write_text(json.dumps({'package':'patch_FAIL_MOVED.zip','status':'PASS'})+'\\n')
            (rep/'last_run.json').write_text(json.dumps({'status':'FAIL','executed':[{'name':'patch_FAIL_MOVED.zip','status':'FAIL'}]}))
            (rep/'LAST_RUN.md').write_text('STATUS: FAIL\\nPATCHES EXECUTED:\\n- [FAIL] patch_FAIL_MOVED.zip\\nPATCHES SKIPPED / NOT EXECUTED:\\n')
            raise SystemExit(1)
        """))
        res = run(guard_cmd(root, runner, "--transaction", "off"), cwd=root)
        assert res.returncode == 1, res.stdout
        assert (p / "patch_FAIL_MOVED.zip").is_file(), res.stdout
        assert not (pa / "patch_FAIL_MOVED.zip").exists(), res.stdout
        hist = rep / ".patch_tool_local_history" / "successful.jsonl"
        assert hist.read_text() == "", hist.read_text()
        assert "EXECUTED+FAIL" in res.stdout, res.stdout


def test_checkpointed_crash_restores_explicit_failed_package() -> None:
    with tempfile.TemporaryDirectory(prefix="ptv51513_stale_fail_") as td:
        root = Path(td); p, lib, rep, ig, pa = base_dirs(root)
        f = p / "patch_FAIL.zip"; mkzip(f, "FAIL")
        fid = identity(f)
        local = rep / ".patch_tool_local_history"; local.mkdir(parents=True, exist_ok=True)
        history = local / "successful.jsonl"; history.write_text("")
        run_start = time.time_ns()
        __import__('shutil').move(str(f), str(pa / "patch_FAIL.zip"))
        history.write_text(json.dumps({'package':'patch_FAIL.zip','sha256':fid['sha256'],'status':'PASS'})+'\n')
        (rep/'last_run.json').write_text(json.dumps({'status':'FAIL','executed':[{'name':'patch_FAIL.zip','status':'FAIL'}]}))
        (rep/'LAST_RUN.md').write_text('STATUS: FAIL\nPATCHES EXECUTED:\n- [FAIL] patch_FAIL.zip\nPATCHES SKIPPED / NOT EXECUTED:\n')
        post_history = history.read_bytes(); core_end = time.time_ns()
        (local/'guard_invocation.json').write_text(json.dumps({
            'schema':1,'guard_version':'5.15.13','pid':999999,'started_at':'old',
            'run_start_wall_ns':run_start,'core_completed_wall_ns':core_end,
            'queue_before':{'patch_FAIL.zip':fid},
            'pre_evidence':{'last_run.json':{'exists':False},'LAST_RUN.md':{'exists':False}},
            'post_evidence':{'last_run.json':evidence(rep/'last_run.json'),'LAST_RUN.md':evidence(rep/'LAST_RUN.md')},
            'pre_history_size':0,'pre_history_sha256':hashlib.sha256(b'').hexdigest(),
            'post_history_size':len(post_history),'post_history_sha256':hashlib.sha256(post_history).hexdigest(),
            'state':'core_completed','core_returncode':1
        }))
        runner = lib / "python_patch_runner.py"
        runner.write_text(textwrap.dedent("""\
            import json
            from pathlib import Path
            r=Path.cwd(); rep=r/'patchs'/'reports'
            (rep/'last_run.json').write_text(json.dumps({'status':'PASS','executed':[]}))
            (rep/'LAST_RUN.md').write_text('STATUS: PASS\\nPATCHES EXECUTED:\\nPATCHES SKIPPED / NOT EXECUTED:\\n')
        """))
        res = run(guard_cmd(root, runner, "--transaction", "off"), cwd=root)
        assert res.returncode == 0, res.stdout
        assert (p / "patch_FAIL.zip").is_file(), res.stdout
        assert not (pa / "patch_FAIL.zip").exists(), res.stdout
        assert history.read_text() == "", history.read_text()
        assert "EXECUTED+FAIL" in res.stdout, res.stdout


def test_scoped_data_only_small_patch_skips_full_sandbox() -> None:
    with tempfile.TemporaryDirectory(prefix="ptv51513_scoped_") as td:
        root=Path(td); p,lib,rep,ig,pa=base_dirs(root)
        target=root/'src'/'one.txt'; target.parent.mkdir(parents=True); target.write_text('OLD')
        mkopszip(p/'patch_small.zip','src/one.txt')
        runner=lib/'python_patch_runner.py'
        runner.write_text(textwrap.dedent("""\
            import json,sys
            from pathlib import Path
            r=Path.cwd(); rep=r/'patchs'/'reports'; args=sys.argv[1:]
            assert '--transaction' in args and args[args.index('--transaction')+1]=='off', args
            (r/'src'/'one.txt').write_text('NEW')
            (rep/'last_run.json').write_text(json.dumps({'status':'PASS','executed':[{'name':'patch_small.zip','status':'PASS'}]}))
            (rep/'LAST_RUN.md').write_text('STATUS: PASS\\nPATCHES EXECUTED:\\n- [PASS] patch_small.zip\\nPATCHES SKIPPED / NOT EXECUTED:\\n')
        """))
        res=run(guard_cmd(root,runner),cwd=root)
        assert res.returncode==0,res.stdout
        assert 'SCOPED FILE TRANSACTION: 1 exact target file(s)' in res.stdout,res.stdout
        assert target.read_text()=='NEW'
        state=json.loads((rep/'.patch_tool_local_history'/'sandbox_performance.json').read_text())
        assert state['last_decision']=='scoped_file_transaction',state


def test_scoped_failure_restores_only_target() -> None:
    with tempfile.TemporaryDirectory(prefix="ptv51513_scoped_fail_") as td:
        root=Path(td); p,lib,rep,ig,pa=base_dirs(root)
        target=root/'src'/'one.txt'; target.parent.mkdir(parents=True); target.write_text('OLD')
        other=root/'src'/'other.txt'; other.write_text('KEEP')
        mkopszip(p/'patch_small.zip','src/one.txt')
        runner=lib/'python_patch_runner.py'
        runner.write_text(textwrap.dedent("""\
            import json,sys
            from pathlib import Path
            r=Path.cwd(); rep=r/'patchs'/'reports'
            (r/'src'/'one.txt').write_text('BROKEN')
            (rep/'last_run.json').write_text(json.dumps({'status':'FAIL','executed':[{'name':'patch_small.zip','status':'FAIL'}]}))
            (rep/'LAST_RUN.md').write_text('STATUS: FAIL\\nPATCHES EXECUTED:\\n- [FAIL] patch_small.zip\\nPATCHES SKIPPED / NOT EXECUTED:\\n')
            raise SystemExit(1)
        """))
        res=run(guard_cmd(root,runner),cwd=root)
        assert res.returncode==1,res.stdout
        assert 'SCOPED ROLLBACK' in res.stdout,res.stdout
        assert target.read_text()=='OLD'
        assert other.read_text()=='KEEP'


def test_dynamic_python_patch_keeps_normal_sandbox_policy() -> None:
    with tempfile.TemporaryDirectory(prefix="ptv51513_dynamic_") as td:
        root=Path(td); p,lib,rep,ig,pa=base_dirs(root)
        (p/'patch_dynamic.py').write_text('print(1)')
        runner=lib/'python_patch_runner.py'
        runner.write_text(textwrap.dedent("""\
            import json,sys
            from pathlib import Path
            r=Path.cwd(); rep=r/'patchs'/'reports'; args=sys.argv[1:]
            # No scoped optimization should force transaction=off for unknown Python scope.
            assert not ('--transaction' in args and args[args.index('--transaction')+1]=='off'), args
            (rep/'last_run.json').write_text(json.dumps({'status':'PASS','executed':[]}))
            (rep/'LAST_RUN.md').write_text('STATUS: PASS\\nPATCHES EXECUTED:\\nPATCHES SKIPPED / NOT EXECUTED:\\n')
        """))
        res=run(guard_cmd(root,runner),cwd=root,env={**os.environ,'PTV_ADAPTIVE_SANDBOX':'0'})
        assert res.returncode==0,res.stdout
        assert 'SCOPED FILE TRANSACTION' not in res.stdout,res.stdout


def test_explicit_required_never_uses_scoped_transaction() -> None:
    with tempfile.TemporaryDirectory(prefix="ptv51513_required_") as td:
        root=Path(td); p,lib,rep,ig,pa=base_dirs(root)
        target=root/'src'/'one.txt'; target.parent.mkdir(parents=True); target.write_text('OLD')
        mkopszip(p/'patch_small.zip','src/one.txt')
        runner=lib/'python_patch_runner.py'
        runner.write_text(textwrap.dedent("""\
            import json,sys
            from pathlib import Path
            r=Path.cwd(); rep=r/'patchs'/'reports'; args=sys.argv[1:]
            assert '--transaction' in args and args[args.index('--transaction')+1]=='required', args
            (rep/'last_run.json').write_text(json.dumps({'status':'PASS','executed':[]}))
            (rep/'LAST_RUN.md').write_text('STATUS: PASS\\nPATCHES EXECUTED:\\nPATCHES SKIPPED / NOT EXECUTED:\\n')
        """))
        res=run(guard_cmd(root,runner,'--transaction','required'),cwd=root)
        assert res.returncode==0,res.stdout
        assert 'SCOPED FILE TRANSACTION' not in res.stdout,res.stdout


def test_scope_over_budget_falls_back_to_normal_policy() -> None:
    with tempfile.TemporaryDirectory(prefix="ptv51513_scope_budget_") as td:
        root=Path(td); p,lib,rep,ig,pa=base_dirs(root)
        ops=[]
        with zipfile.ZipFile(p/'patch_big.zip','w',compression=zipfile.ZIP_DEFLATED) as z:
            z.writestr('PATCH_TOOL_MANIFEST.json',json.dumps({'schema_version':1,'project':{'key':'test'},'patch':{'id':'big','version':'v5.15.13','phase':'test','phase_under_test':'test','summary':'test','regression_scope':'test'}}))
            for i in range(13): ops.append({'id':f'w{i}','kind':'write','file':f'src/f{i}.txt','content':'x','create':True})
            z.writestr('PATCH_TOOL_OPS.json',json.dumps({'schema_version':1,'patch_name':'big','ops':ops}))
        runner=lib/'python_patch_runner.py'
        runner.write_text(textwrap.dedent("""\
            import json,sys
            from pathlib import Path
            r=Path.cwd(); rep=r/'patchs'/'reports'; args=sys.argv[1:]
            assert not ('--transaction' in args and args[args.index('--transaction')+1]=='off'), args
            (rep/'last_run.json').write_text(json.dumps({'status':'PASS','executed':[]}))
            (rep/'LAST_RUN.md').write_text('STATUS: PASS\\nPATCHES EXECUTED:\\nPATCHES SKIPPED / NOT EXECUTED:\\n')
        """))
        res=run(guard_cmd(root,runner),cwd=root,env={**os.environ,'PTV_ADAPTIVE_SANDBOX':'0'})
        assert res.returncode==0,res.stdout
        assert 'SCOPED FILE TRANSACTION' not in res.stdout,res.stdout


def test_scoped_failure_removes_new_target_file() -> None:
    with tempfile.TemporaryDirectory(prefix="ptv51513_scoped_create_") as td:
        root=Path(td); p,lib,rep,ig,pa=base_dirs(root)
        mkopszip(p/'patch_create.zip','src/new.txt')
        runner=lib/'python_patch_runner.py'
        runner.write_text(textwrap.dedent("""\
            import json
            from pathlib import Path
            r=Path.cwd(); rep=r/'patchs'/'reports'; t=r/'src'/'new.txt'; t.parent.mkdir(parents=True,exist_ok=True); t.write_text('NEW')
            (rep/'last_run.json').write_text(json.dumps({'status':'FAIL','executed':[{'name':'patch_create.zip','status':'FAIL'}]}))
            (rep/'LAST_RUN.md').write_text('STATUS: FAIL\\nPATCHES EXECUTED:\\n- [FAIL] patch_create.zip\\nPATCHES SKIPPED / NOT EXECUTED:\\n')
            raise SystemExit(1)
        """))
        res=run(guard_cmd(root,runner),cwd=root)
        assert res.returncode==1,res.stdout
        assert not (root/'src'/'new.txt').exists(),res.stdout
        assert 'removed 1 newly-created target file(s)' in res.stdout,res.stdout


def test_scoped_failure_after_commit_does_not_revert_committed_source() -> None:
    with tempfile.TemporaryDirectory(prefix="ptv51513_scoped_commit_") as td:
        root=Path(td); p,lib,rep,ig,pa=base_dirs(root)
        subprocess.run(['git','init','-q'],cwd=root,check=True)
        subprocess.run(['git','config','user.email','test@example.com'],cwd=root,check=True)
        subprocess.run(['git','config','user.name','Test'],cwd=root,check=True)
        target=root/'src'/'one.txt'; target.parent.mkdir(parents=True); target.write_text('OLD')
        subprocess.run(['git','add','src/one.txt'],cwd=root,check=True); subprocess.run(['git','commit','-qm','base'],cwd=root,check=True)
        mkopszip(p/'patch_small.zip','src/one.txt')
        runner=lib/'python_patch_runner.py'
        runner.write_text(textwrap.dedent("""\
            import json,subprocess
            from pathlib import Path
            r=Path.cwd(); rep=r/'patchs'/'reports'; (r/'src'/'one.txt').write_text('COMMITTED')
            subprocess.run(['git','add','src/one.txt'],cwd=r,check=True); subprocess.run(['git','commit','-qm','patch'],cwd=r,check=True)
            (rep/'last_run.json').write_text(json.dumps({'status':'FAIL','executed':[{'name':'patch_small.zip','status':'FAIL'}]}))
            (rep/'LAST_RUN.md').write_text('STATUS: FAIL\\nPATCHES EXECUTED:\\n- [FAIL] patch_small.zip\\nPATCHES SKIPPED / NOT EXECUTED:\\n')
            raise SystemExit(1)
        """))
        res=run(guard_cmd(root,runner),cwd=root)
        assert res.returncode==1,res.stdout
        assert target.read_text()=='COMMITTED',res.stdout
        assert 'rollback skipped because Git HEAD changed' in res.stdout,res.stdout


def main() -> int:
    test_current_run_evidence_overrides_stale_last_run()
    test_basename_only_history_does_not_attest_changed_content_and_rename_recovers()
    test_strong_digest_history_keeps_true_duplicate_quarantined()
    test_no_current_evidence_never_uses_stale_report()
    test_adaptive_reprobe_off_does_not_measure_patch_git_worktree()
    test_stale_active_marker_and_project_lock()
    test_stale_invocation_journal_is_archived_without_auto_rerun()
    test_executed_fail_cannot_create_success_history()
    test_shared_digest_does_not_delete_real_pass_history()
    test_overall_pass_promotes_legacy_executed_unknown_to_pass()
    test_unselected_modified_same_inode_is_restored_with_new_bytes()
    test_stale_journal_with_own_last_run_restores_proven_unexecuted()
    test_stale_journal_without_own_evidence_remains_ambiguous()
    test_stale_partial_report_does_not_restore_unmentioned_package()
    test_stale_checkpoint_rejects_later_unrelated_last_run()
    test_stale_history_cleanup_preserves_later_appends()
    test_executed_fail_wrongly_moved_is_restored_to_queue()
    test_checkpointed_crash_restores_explicit_failed_package()
    test_scoped_data_only_small_patch_skips_full_sandbox()
    test_scoped_failure_restores_only_target()
    test_dynamic_python_patch_keeps_normal_sandbox_policy()
    test_explicit_required_never_uses_scoped_transaction()
    test_scope_over_budget_falls_back_to_normal_policy()
    test_scoped_failure_removes_new_target_file()
    test_scoped_failure_after_commit_does_not_revert_committed_source()
    print("PASS: Python Patch Tool v5.15.13 runtime integrity self-test")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
