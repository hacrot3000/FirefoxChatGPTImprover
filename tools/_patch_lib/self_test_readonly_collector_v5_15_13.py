#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import zipfile

HERE = Path(__file__).resolve().parent
COLLECTOR = HERE / "python_patch_readonly_collector.py"
GUARD = HERE / "python_patch_runtime_guard.py"
LAUNCHER = HERE.parent / "run_python_patches.sh"


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def test_investigation_relevance_trims_noise() -> None:
    collector = load_module(COLLECTOR, "ptv_collector_relevance_test")
    with tempfile.TemporaryDirectory(prefix="ptv51513_rel_") as td:
        root=Path(td)
        (root/'src').mkdir()
        (root/'src'/'main.c').write_text('int helper(void);\nint seed(void){ return helper(); }\nint caller(void){ return seed(); }\n')
        (root/'src'/'helper.c').write_text('int helper(void){ return 7; }\n')
        # This dependency-only file should rank below direct seed/definition evidence.
        (root/'src'/'noise.h').write_text('#define NOISE 1\n')
        (root/'src'/'helper.c').write_text('#include "noise.h"\nint helper(void){ return 7; }\n')
        req={"id":"rel","actions":[{"id":"inv","type":"investigate","paths":["src"],"symbol":"seed","max_rounds":1,"max_relevant_files":2,"min_relevance_score":20,"trim_low_relevance":True}],"keep_directory":True}
        out=collector.run_request(root,req)
        import zipfile,json
        with zipfile.ZipFile(out) as z:
            manifest=json.loads(z.read('rel/search_manifest.json'))
        details=manifest['actions'][0]['details']['relevance']
        assert details['candidate_files'] >= details['packed_relevant_files']
        assert details['packed_relevant_files'] <= 2
        ranking=details['ranking']
        assert ranking and ranking[0]['score'] >= ranking[-1]['score']


def main() -> int:
    collector = load_module(COLLECTOR, "ptv_collector_test")
    guard = load_module(GUARD, "ptv_guard_test")

    with tempfile.TemporaryDirectory(prefix="ptv51513_collect_") as td:
        root = Path(td)
        (root / "tools/_patch_lib").mkdir(parents=True)
        shutil.copy2(LAUNCHER, root / "tools/run_python_patches.sh")
        shutil.copy2(COLLECTOR, root / "tools/_patch_lib/python_patch_readonly_collector.py")
        (root / "tools/run_python_patches.sh").chmod(0o755)

        files = {
            "projects/m3-client/Client/assets/a/server.lua": "function GetServerUrl() return GetRealServerUrl() end\nlocalVersionCode = 123\nshowVerCode = true\n",
            "projects/m3-client/Client/assets/a/save.lua": "saveServerId(3)\ndefaultServerId_ = 3\nupdateSelectServerIdByRoleInfo()\n",
            "projects/m3-server/other/list.nim": "let serverList = @[]\nlet serverOpenTime = 10\nlet recommend = true\n",
            "projects/m3-server/jdqs_center/cache.nim": "var userPlayerCache = initTable[int, string]()\nlet lastLoginTime = 0\n",
            "projects/m3-server/other/nope.nim": "echo \"nothing\"\n",
            "src/both.txt": "alpha\nbeta\n",
            "src/alpha.txt": "alpha\n",
            "src/generated/server_gen.py": "needle\n",
            "src/logic/server_main.py": "needle\n",
            "graph/util.h": "#pragma once\nint resolveUrl(int id);\n",
            "graph/url.c": "#include \"util.h\"\nint resolveUrl(int id) { return id + 1; }\nint GetServerUrl(int id) { return resolveUrl(id); }\n",
            "graph/main.c": "#include \"util.h\"\nint chooseServer(int id) { return GetServerUrl(id); }\nint startApp(void) { return chooseServer(1); }\n",
            "pyapp/__init__.py": "",
            "pyapp/main.py": "from .service import load_server\nprint(load_server())\n",
            "pyapp/service.py": "from .model import SERVER\ndef load_server():\n    return SERVER\n",
            "pyapp/model.py": "SERVER = 'alpha'\n",
        }
        for rel, text in files.items():
            p = root / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text, encoding="utf-8")

        before = {rel: (root / rel).read_bytes() for rel in files}

        # Direct launcher dispatch: no private core exists, so success proves the readonly
        # collector does not enter normal Patch Tool execution or SANDBOX setup.
        proc = subprocess.run([
            str(root / "tools/run_python_patches.sh"), "collect", "search-pack",
            "--id", "single", "--path", "src", "--query", "needle", "--literal", "--context", "2",
        ], cwd=root, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=True)
        assert "READONLY CODE COLLECTION — SANDBOX SKIPPED" in proc.stdout
        single_zip = root / "artifacts/patch_tool_code_collections/single.zip"
        assert single_zip.is_file()
        with zipfile.ZipFile(single_zip) as zf:
            names = set(zf.namelist())
            assert "single/files/src/logic/server_main.py" in names
            assert "single/files/src/generated/server_gen.py" in names

        # Collector output is excluded from future searches; no recursive self-matching.
        subprocess.run([
            str(root / "tools/run_python_patches.sh"), "collect", "search-pack",
            "--id", "no-artifact-recursion", "--path", ".", "--query", "needle", "--literal",
        ], cwd=root, check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        with zipfile.ZipFile(root / "artifacts/patch_tool_code_collections/no-artifact-recursion.zip") as zf:
            manifest = json.loads(zf.read("no-artifact-recursion/search_manifest.json"))
            assert manifest["union_matched_files"] == 2, manifest
            assert all(not a["files"][0].startswith("artifacts/") for a in manifest["actions"] if a["files"]), manifest

        # Multi-action equivalent to the user's manual M3 rg/copy/report/zip workflow.
        request = {
            "id": "server-select-bug-stage3",
            "actions": [
                {"id": "client", "type": "search_files", "paths": ["projects/m3-client/Client/assets"],
                 "query": "GetServerUrl|GetRealServerUrl|localVersionCode|showVerCode|saveServerId", "regex": True, "context_lines": 12},
                {"id": "persist", "type": "content", "paths": ["projects/m3-client/Client/assets"],
                 "query": r"saveServerId\(|defaultServerId_|updateSelectServerIdByRoleInfo\(", "regex": True, "context_lines": 10},
                {"id": "server-list", "type": "content", "paths": ["projects/m3-server"],
                 "query": "serverList|serverOpenTime|recommend", "regex": True, "context_lines": 8},
                {"id": "cache", "type": "content", "paths": ["projects/m3-server/jdqs_center"],
                 "query": "userPlayerCache|lastLoginTime", "regex": True, "context_lines": 12},
                {"id": "all-terms", "type": "content", "paths": ["src"], "queries": ["alpha", "beta"],
                 "regex": False, "match_mode": "all", "collect_matching_files": False},
                {"id": "filename", "type": "filename", "paths": ["src"], "patterns": ["server_*.py"],
                 "exclude_globs": ["**/generated/**"]},
            ],
        }
        (root / "request.json").write_text(json.dumps(request), encoding="utf-8")
        subprocess.run([str(root / "tools/run_python_patches.sh"), "collect", "request", "request.json"], cwd=root, check=True)
        zpath = root / "artifacts/patch_tool_code_collections/server-select-bug-stage3.zip"
        with zipfile.ZipFile(zpath) as zf:
            names = set(zf.namelist())
            expected = {
                "server-select-bug-stage3/files/projects/m3-client/Client/assets/a/server.lua",
                "server-select-bug-stage3/files/projects/m3-client/Client/assets/a/save.lua",
                "server-select-bug-stage3/files/projects/m3-server/other/list.nim",
                "server-select-bug-stage3/files/projects/m3-server/jdqs_center/cache.nim",
                "server-select-bug-stage3/files/src/logic/server_main.py",
            }
            assert expected <= names
            # report-only all-terms action must not pack both.txt by itself
            assert "server-select-bug-stage3/files/src/both.txt" not in names
            report = zf.read("server-select-bug-stage3/search_report.txt").decode()
            assert "projects/m3-client/Client/assets/a/server.lua:1-3" in report
            manifest = json.loads(zf.read("server-select-bug-stage3/search_manifest.json"))
            assert manifest["sandbox"] == "skipped_readonly"
            assert manifest["union_matched_files"] == 5

        # Symbol graph: text evidence + heuristic definitions/callers/callees/dependencies.
        proc = subprocess.run([
            str(root / "tools/run_python_patches.sh"), "collect", "symbol-pack",
            "--id", "symbol-graph", "--path", "graph", "--symbol", "GetServerUrl",
            "--context", "2", "--dependency-depth", "1",
        ], cwd=root, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=True)
        assert "SANDBOX SKIPPED" in proc.stdout
        with zipfile.ZipFile(root / "artifacts/patch_tool_code_collections/symbol-graph.zip") as zf:
            names = set(zf.namelist())
            assert "symbol-graph/files/graph/url.c" in names
            assert "symbol-graph/files/graph/main.c" in names
            assert "symbol-graph/files/graph/util.h" in names
            manifest = json.loads(zf.read("symbol-graph/search_manifest.json"))
            action = manifest["actions"][0]
            details = action["details"]
            g = details["symbols"]["GetServerUrl"]
            assert any(x["path"] == "graph/url.c" and x["kind"] == "definition" for x in g["definitions"]), g
            assert any(x.get("owner") == "chooseServer" for x in g["callers"]), g
            assert any(c["name"] == "resolveUrl" and c["definitions"] for c in g["callees"]), g
            assert any(e.get("to") == "graph/util.h" for e in details["dependency_edges"]), details
            report = zf.read("symbol-graph/search_report.txt").decode()
            assert "ANALYSIS DETAILS (JSON)" in report
            assert '"resolution": "heuristic"' in report

        # Automatic bounded investigation: seed GetServerUrl -> chooseServer/resolveUrl -> startApp.
        proc = subprocess.run([
            str(root / "tools/run_python_patches.sh"), "collect", "investigate-pack",
            "--id", "auto-investigation", "--path", "graph", "--symbol", "GetServerUrl",
            "--rounds", "2", "--context", "2", "--dependency-depth", "1",
        ], cwd=root, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=True)
        assert "SANDBOX SKIPPED" in proc.stdout
        with zipfile.ZipFile(root / "artifacts/patch_tool_code_collections/auto-investigation.zip") as zf:
            names = set(zf.namelist())
            assert "auto-investigation/files/graph/url.c" in names
            assert "auto-investigation/files/graph/main.c" in names
            assert "auto-investigation/files/graph/util.h" in names
            manifest = json.loads(zf.read("auto-investigation/search_manifest.json"))
            action = manifest["actions"][0]
            details = action["details"]
            assert action["type"] == "auto_investigation", action
            assert "GetServerUrl" in details["seed_symbols"], details
            assert "chooseServer" in details["expanded_symbols"], details
            # Round 2 should expand chooseServer and discover its caller startApp.
            discovered = [d for r in details["rounds"] for d in r.get("discovered", [])]
            assert any(d.get("symbol") == "startApp" and d.get("via") == "caller" for d in discovered), discovered
            assert details["stop_reason"] in {"max_rounds", "no_new_symbols", "frontier_exhausted"}
            report = zf.read("auto-investigation/search_report.txt").decode()
            assert '"mode": "bounded_auto_investigation"' in report

        # Query-only investigation seeds simple identifiers and containing functions.
        req_auto = {
            "id": "query-investigation",
            "actions": [{
                "type": "investigate", "paths": ["graph"], "query": "GetServerUrl|resolveUrl",
                "regex": True, "max_rounds": 1, "max_symbols": 8, "max_investigation_files": 20,
            }],
        }
        collector.run_request(root, req_auto)
        with zipfile.ZipFile(root / "artifacts/patch_tool_code_collections/query-investigation.zip") as zf:
            manifest = json.loads(zf.read("query-investigation/search_manifest.json"))
            details = manifest["actions"][0]["details"]
            assert "GetServerUrl" in details["seed_symbols"], details
            assert "resolveUrl" in details["seed_symbols"], details
            assert len(details["expanded_symbols"]) <= 8, details

        # Recursive dependency closure: Python relative imports two levels deep.
        proc = subprocess.run([
            str(root / "tools/run_python_patches.sh"), "collect", "dependency-pack",
            "--id", "py-deps", "--file", "pyapp/main.py", "--path", "pyapp", "--depth", "2",
        ], cwd=root, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=True)
        assert "SANDBOX SKIPPED" in proc.stdout
        with zipfile.ZipFile(root / "artifacts/patch_tool_code_collections/py-deps.zip") as zf:
            names = set(zf.namelist())
            assert "py-deps/files/pyapp/main.py" in names
            assert "py-deps/files/pyapp/service.py" in names
            assert "py-deps/files/pyapp/model.py" in names
            manifest = json.loads(zf.read("py-deps/search_manifest.json"))
            edges = manifest["actions"][0]["details"]["dependency_edges"]
            assert any(e.get("from") == "pyapp/main.py" and e.get("to") == "pyapp/service.py" for e in edges), edges
            assert any(e.get("from") == "pyapp/service.py" and e.get("to") == "pyapp/model.py" for e in edges), edges

        # Git-changed action.
        subprocess.run(["git", "init", "-q"], cwd=root, check=True)
        subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=root, check=True)
        subprocess.run(["git", "config", "user.name", "Test"], cwd=root, check=True)
        subprocess.run(["git", "add", "src/alpha.txt"], cwd=root, check=True)
        subprocess.run(["git", "commit", "-qm", "base"], cwd=root, check=True)
        (root / "src/alpha.txt").write_text("alpha changed\n", encoding="utf-8")
        (root / "src/untracked.txt").write_text("new\n", encoding="utf-8")
        req2 = {"id": "git-changed", "actions": [{"type": "git_changed", "status": ["modified", "untracked"], "include_globs": ["src/**"]}]}
        collector.run_request(root, req2)
        with zipfile.ZipFile(root / "artifacts/patch_tool_code_collections/git-changed.zip") as zf:
            names = set(zf.namelist())
            assert "git-changed/files/src/alpha.txt" in names
            assert "git-changed/files/src/untracked.txt" in names

        # Source bytes remain untouched except files deliberately changed above for Git test.
        for rel, raw in before.items():
            if rel == "src/alpha.txt":
                continue
            assert (root / rel).read_bytes() == raw, rel

        # Legacy core readonly verbs get transaction=off automatically and therefore do
        # not start adaptive SANDBOX measurement.
        args, decision, _ = guard.adaptive_transaction_args(root, ["collect", "search", "needle"], root / "sandbox_state.json")
        assert decision == "readonly_no_sandbox"
        assert args[-2:] == ["--transaction", "off"]
        explicit, decision2, _ = guard.adaptive_transaction_args(root, ["collect", "search", "needle", "--transaction", "required"], root / "sandbox_state.json")
        assert decision2 == "explicit_required"
        assert explicit[-2:] == ["--transaction", "required"]

    test_investigation_relevance_trims_noise()
    print("PASS: Python Patch Tool v5.15.13 readonly collector self-test")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
