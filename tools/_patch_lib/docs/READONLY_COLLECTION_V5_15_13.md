# Python Patch Tool v5.15.13 — readonly source discovery, investigation and packaging

> **HISTORICAL v5 DOCUMENT — NOT THE CURRENT PUBLIC WORKFLOW.** Python Patch Tool v6.7.9 supersedes any user-facing command, COLLECT-delivery, transaction or SANDBOX guidance below. Current normal operation is `./tools/run_python_patches.sh`; AI COLLECT requests are ZIP-only; public PATCH execution is in-place and SANDBOX/worktree execution is removed. See `AI_USAGE_CONTRACT.md`, `PORTABLE_USAGE.md` and `PYTHON_PATCH_STANDARD_PROMPT.md`.

## Purpose and safety boundary

The readonly collector exists for source discovery and evidence packaging. It never edits project source or Git state. It may write only investigation artifacts under `artifacts/patch_tool_code_collections/` (or another explicitly selected project-local output directory).

Direct collector commands bypass Patch Tool transaction/SANDBOX completely. Legacy readonly core verbs are forced to `transaction=off` unless the caller explicitly selects another transaction mode. This avoids expensive isolated worktree preparation on large repositories when the operation is read-only.

The collector output directory is excluded from future searches by default so repeated investigations do not recursively collect their own previous artifacts.

## Command families

### Content-driven collection

`collect search-pack` (aliases `select`, `search-files`) searches text, copies full matching files while preserving project-relative paths, writes context reports and a machine-readable manifest, and creates one ZIP.

Supported filters include regex/literal queries, `any`/`all`, include/exclude queries, multiple roots, path/name globs, extensions, case sensitivity, hidden files and context line counts.

### Multi-action requests

`collect request <file.json>` runs multiple readonly actions. Matched files from all actions are unioned and deduplicated before packaging while each action retains its own evidence/report section.

Supported action types:

- `content` / `search_files`
- `filename` / `find_files`
- `git_changed`
- `explicit`
- `symbol_graph`
- `dependency_closure`
- `investigate` / `auto_investigate`

### Symbol graph collection

`collect symbol-pack` (aliases `symbol`, `symbol-graph`) starts from explicit symbol names and collects exact text occurrences plus heuristic definitions, containing callers, direct project-local callees and local dependencies.

Provenance is explicit:

- occurrences: `resolution=text`
- definitions/callers/callees/dependencies: `resolution=heuristic`

The implementation intentionally does not require compiler databases, LSP, ctags or build environments.

### Dependency closure

`collect dependency-pack` (aliases `deps`, `dependencies`) starts from explicit seed files and recursively follows resolvable project-local includes/imports/requires to a bounded depth.

Currently recognized local forms include C/C++/Objective-C includes, JS/TS static/dynamic imports and require, Python imports, Nim import/include, Lua require and Rust mod declarations. External dependencies are reported unresolved rather than copied blindly.

## Automatic bounded investigation expansion (v5.15.13)

`collect investigate-pack` (aliases `investigate`, `auto-investigate`) combines content search, symbol graph and dependency closure into a bounded investigation loop.

### Seed sources

An investigation may start from:

- explicit symbols;
- content queries;
- simple identifier tokens extracted from content queries;
- containing function names around exact content hits.

Seed content matches are retained as exact text evidence.

### Expansion rounds

For each round the collector:

1. resolves the current frontier with `symbol_graph`;
2. collects matching source files and local dependencies;
3. discovers containing caller symbols;
4. discovers direct callees only when a project-local definition is found;
5. forms a bounded next frontier;
6. stops when no new symbols remain or a configured budget is reached.

The manifest records every round, frontier, discovered edge, new files and stop reason. Automatic expansion never treats heuristic edges as exact compiler-level truth.

### Default investigation budgets

- `max_rounds = 2`
- `max_symbols = 80`
- `max_new_symbols_per_round = 24`
- `max_investigation_files = 500`
- `max_occurrences = 1000`
- `max_callers = 250`
- `max_callees = 40`
- `max_dependency_files = 300`
- `max_dependency_edges = 3000`

These budgets are deliberately conservative for large repositories. They may be increased explicitly in CLI/JSON requests.

### Investigation stop reasons

The manifest may report:

- `frontier_exhausted`
- `no_new_symbols`
- `max_rounds`
- `max_symbols`
- `max_investigation_files`

A bounded stop is successful collection, not an error. The report explains which budget stopped expansion.

## JSON request schema

Top level:

```json
{
  "id": "investigation-id",
  "title": "Optional title",
  "output_dir": "artifacts/patch_tool_code_collections",
  "keep_directory": true,
  "exclude_globs": [],
  "limits": {
    "max_file_bytes": 8388608,
    "max_total_bytes": 268435456,
    "max_files": 5000,
    "max_report_bytes": 16777216
  },
  "actions": []
}
```

### Content action fields

- `paths`
- `query` / `queries`
- `regex`
- `case_sensitive`
- `match_mode`: `any` or `all`
- `exclude_queries`
- `include_globs` / `exclude_globs`
- `name_globs`
- `extensions`
- `context_lines`
- `hidden`
- `collect_matching_files`

### Symbol graph fields

- `symbols` / `symbol`
- `paths`
- common glob/extension filters
- `context_lines`
- `include_references`
- `include_callers`
- `include_callees`
- `include_dependencies`
- `dependency_depth`
- `max_occurrences`
- `max_callers`
- `max_callees`
- `max_dependency_files`
- `max_dependency_edges`

### Dependency closure fields

- `files` / `seed_files`
- `paths`
- `depth`
- common filters
- `max_seed_files`
- `allow_many_seeds`
- `max_dependency_files`
- `max_dependency_edges`

### Automatic investigation fields

All common content/symbol filters are supported plus:

- `symbols` / `symbol`
- `query` / `queries`
- `seed_query_identifiers` (default true)
- `max_rounds`
- `max_symbols`
- `max_new_symbols_per_round`
- `max_investigation_files`
- `include_callers`
- `include_callees`
- `include_dependencies`
- `dependency_depth`
- symbol/dependency budgets listed above

## Output structure

Every collection ZIP contains one top-level directory named after the request ID with:

- `files/`: full source files, preserving project-relative paths;
- `matches/`: per-action reports;
- `search_report.txt`: human-readable aggregate evidence;
- `search_manifest.json`: machine-readable files, hashes, action details, graph provenance and limits;
- `request.normalized.json`: normalized request that produced the artifact.

A file matched by many actions is copied only once.

## Large repository behavior and limits

The collector prefers ripgrep for file discovery/content narrowing when available and falls back to Python traversal/search. Default exclusions include `.git`, `node_modules`, Patch Tool reports, collector artifacts, Python cache files and common generated collector output.

Package limits protect against unbounded archive size. Files skipped because of size/count/total-byte limits are listed in the manifest.

Dependency closure refuses an unexpectedly broad implicit seed set unless `allow_many_seeds=true` is explicit.

Automatic investigation uses bounded rounds and symbol/file budgets so a broad symbol cannot recursively collect the whole repository by accident.

## Git changed action

`git_changed` can collect current modified/added/untracked/renamed files and then apply standard path filters. Deleted files are reported but cannot be packed because no current filesystem content exists.

## Readonly SANDBOX policy

Direct commands that bypass SANDBOX:

- `collect request`
- `collect search-pack` / `select` / `search-files`
- `collect symbol-pack` / `symbol` / `symbol-graph`
- `collect dependency-pack` / `deps` / `dependencies`
- `collect investigate-pack` / `investigate` / `auto-investigate`

They print `READONLY CODE COLLECTION — SANDBOX SKIPPED` and do not enter the transaction worktree layer.

Legacy readonly core verbs (`collect`, `research`, `inspect`, `query`, `overview`) are automatically supplied `--transaction off` when no transaction mode was explicitly requested.

## Interpretation rules for AI/humans

- Treat text occurrences and copied source as primary evidence.
- Treat graph/call/dependency resolution marked `heuristic` as investigation guidance, not compiler proof.
- Use unresolved dependency lists to decide whether another targeted collection is needed.
- Prefer raising budgets or adding explicit seeds over removing all safety limits.
- Do not infer that a file excluded by limits has no relationship to the investigation; consult `skipped_by_limits` and stop reasons.

## Included examples and self-test

Machine-usable request examples are installed under `tools/_patch_lib/examples/`. The complete collector regression is `tools/_patch_lib/self_test_readonly_collector_v5_15_13.py`.


## Investigation relevance ranking (v5.15.13)

`investigate` now ranks candidate files by evidence strength and graph distance before packing. Exact seed-content files are mandatory and never trimmed. Definitions, references, callers, callees and dependency edges receive progressively lower scores, with a penalty for later expansion rounds. Default packaging limits are `max_relevant_files=200` and `min_relevance_score=20`; set `trim_low_relevance=false` when a complete bounded graph is required. The manifest records the ranking, reasons, score and every dropped low-priority file. Scoring changes packaging priority only; it never changes provenance from heuristic to exact.
