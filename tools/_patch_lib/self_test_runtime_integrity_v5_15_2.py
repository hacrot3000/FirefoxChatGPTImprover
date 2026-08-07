#!/usr/bin/env python3
from __future__ import annotations
import json, os, subprocess, sys, tempfile, textwrap, zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
GUARD = HERE / "python_patch_runtime_guard.py"


def mkzip(path: Path, text: str) -> None:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("payload.txt", text)


def run(cmd, *, cwd, env=None):
    return subprocess.run(cmd, cwd=cwd, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)


def test_selection_integrity() -> None:
    with tempfile.TemporaryDirectory(prefix="ptv5152_sel_") as td:
        root = Path(td); patchs = root/"patchs"; lib=root/"tools"/"_patch_lib"; reports=patchs/"reports"; ignored=patchs/"ignored"/"duplicate_success"; patched=patchs/"patched"
        for d in (patchs, lib, reports, ignored, patched): d.mkdir(parents=True, exist_ok=True)
        mkzip(patchs/"patch_A.zip", "A"); mkzip(patchs/"patch_B.zip", "B")
        runner=lib/"python_patch_runner.py"
        runner.write_text(textwrap.dedent('''\
            #!/usr/bin/env python3
            from pathlib import Path
            import json, shutil
            r=Path.cwd(); p=r/'patchs'; rep=p/'reports'; ig=p/'ignored'/'duplicate_success'; pa=p/'patched'
            pa.mkdir(parents=True,exist_ok=True); ig.mkdir(parents=True,exist_ok=True); rep.mkdir(parents=True,exist_ok=True)
            shutil.move(str(p/'patch_A.zip'), str(pa/'patch_A.zip'))
            shutil.move(str(p/'patch_B.zip'), str(ig/'patch_B.zip'))
            hist=rep/'.patch_tool_local_history'/'successful.jsonl'; hist.parent.mkdir(parents=True,exist_ok=True)
            hist.write_text(json.dumps({'package':'patch_A.zip','status':'PASS'})+'\\n'+json.dumps({'package':'patch_B.zip','status':'PASS'})+'\\n')
            (rep/'last_run.json').write_text(json.dumps({'executed':[{'name':'patch_A.zip','status':'PASS'}],'skipped':[{'name':'patch_B.zip','category':'duplicate_success'}]}))
            (rep/'LAST_RUN.md').write_text('PATCHES EXECUTED:\\n- patch_A.zip\\nPATCHES SKIPPED / NOT EXECUTED:\\n- patch_B.zip\\n')
        '''))
        res=run([sys.executable,str(GUARD),'--project-root',str(root),'--runner',str(runner),'--','--transaction','off'],cwd=root)
        assert res.returncode==0,res.stdout
        assert (patchs/'patch_B.zip').is_file(),res.stdout
        hist=(reports/'.patch_tool_local_history'/'successful.jsonl').read_text()
        assert 'patch_B.zip' not in hist, hist


def test_adaptive_sandbox() -> None:
    with tempfile.TemporaryDirectory(prefix="ptv5152_sbx_") as td:
        root=Path(td); lib=root/'tools'/'_patch_lib'; reports=root/'patchs'/'reports'; lib.mkdir(parents=True); reports.mkdir(parents=True)
        runner=lib/'python_patch_runner.py'
        runner.write_text(textwrap.dedent('''\
            #!/usr/bin/env python3
            import json, subprocess, sys
            from pathlib import Path
            r=Path.cwd(); rep=r/'patchs'/'reports'; rep.mkdir(parents=True,exist_ok=True)
            args=sys.argv[1:]
            mode=None
            for i,a in enumerate(args):
                if a=='--transaction' and i+1<len(args): mode=args[i+1]
                elif a.startswith('--transaction='): mode=a.split('=',1)[1]
            (rep/'seen_args.json').write_text(json.dumps(args))
            if mode!='off': subprocess.check_call([sys.executable,'-c','import time; time.sleep(0.35)','git','worktree','add','dummy'])
            (rep/'last_run.json').write_text(json.dumps({'executed':[]}))
            (rep/'LAST_RUN.md').write_text('PATCHES EXECUTED:\\nPATCHES SKIPPED / NOT EXECUTED:\\n')
        '''))
        env={**os.environ,'PTV_SANDBOX_SLOW_SECONDS':'0.10'}
        first=run([sys.executable,str(GUARD),'--project-root',str(root),'--runner',str(runner),'--'],cwd=root,env=env)
        assert first.returncode==0,first.stdout
        state=json.loads((reports/'.patch_tool_local_history'/'sandbox_performance.json').read_text())
        assert state.get('last_prepare_seconds',0)>=0.15,state
        second=run([sys.executable,str(GUARD),'--project-root',str(root),'--runner',str(runner),'--'],cwd=root,env=env)
        assert second.returncode==0,second.stdout
        args=json.loads((reports/'seen_args.json').read_text())
        assert '--transaction' in args and args[args.index('--transaction')+1]=='off', (args,second.stdout)
        assert 'RUNNING WITHOUT SANDBOX' in second.stdout, second.stdout
        # Explicit auto must override adaptive skip and probe again.
        third=run([sys.executable,str(GUARD),'--project-root',str(root),'--runner',str(runner),'--','--transaction','auto'],cwd=root,env=env)
        assert third.returncode==0,third.stdout
        args=json.loads((reports/'seen_args.json').read_text())
        assert args.count('--transaction')==1 and args[args.index('--transaction')+1]=='auto',args


def main() -> int:
    test_selection_integrity(); test_adaptive_sandbox()
    print('PASS: Python Patch Tool v5.15.2 selection integrity + adaptive sandbox self-test')
    return 0

if __name__=='__main__': raise SystemExit(main())
