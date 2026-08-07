# Python Patch Tool — Feature Status

Updated for: **v5.16.0**  
Required in every release package: **YES**  
Priority rule: complete the current group to 100% before starting the next group, except shared infrastructure.

## Fixed development order

| Order | Group | Current status | Development state |
|---:|---|---:|---|
| 1 | Diagnostics and AI log collection | **100%** | Complete; regression maintenance only |
| 2 | Code search and collection tools | **100%** | Complete in v5.9; regression maintenance only |
| 3 | Token reduction and AI handoff | **100%** | **Complete in v5.16**; regression maintenance only |
| 4 | Multi-machine/project support | **95%** | Frozen except shared fixes |
| 5 | Intelligent validation | **85%** | Frozen except shared fixes |
| 6 | Other improvements | **72%** | Deferred except explicit user-requested safety work |

Priority: **P0** mandatory/safety critical, **P1** important, **P2** useful, **P3** long-term.

## Feature inventory

| # | Feature | Short description | Status | Priority |
|---:|---|---|---|---|
| 1 | Zero-argument patch workflow | `./tools/run_python_patches.sh` cleans the queue, asks for a selection, then processes the chosen packages | Complete | P0 |
| 2 | Single public entry point | Patch running, collection and baseline utilities share one launcher | **Complete in v5.9** | P0 |
| 3 | Organized `_patch_lib` layout | Only the launcher remains in `tools/`; modules/docs/examples move under `_patch_lib/` | **Complete in v5.9** | P0 |
| 4 | Portable release layout | Release ZIP contains final `tools/run_python_patches.sh` and `tools/_patch_lib/` paths | **Complete in v5.11** | P0 |
| 5 | Automatic queue ordering | Natural numeric ordering and stop-on-first-failure | Complete | P0 |
| 6 | PASS/FAIL input handling | PASS moves to `patched`; FAIL and pending packages remain | Complete | P0 |
| 7 | Git add isolation | Stage only paths changed by the package | Complete | P0 |
| 8 | Patch-aware commit/push | Manifest/project policy controls commit and push | Complete | P0 |
| 9 | Manifest and ZIP standard | One standardized patch ZIP with stable summary metadata | Complete | P0 |
| 10 | Data-only patches | `PATCH_TOOL_OPS.json` reduces generated code and syntax risk | Complete | P1 |
| 11 | Syntax preflight | Detect syntax errors before mutation | Complete | P0 |
| 12 | Process isolation and tree cleanup | Separate process groups, timeout, termination and survivor reporting | Complete | P0 |
| 13 | Transaction sandbox | Patch and validation run away from the real worktree | Complete | P0 |
| 14 | Rollback/apply conflict protection | Verified delta only; restore paths when apply fails | Complete | P0 |
| 15 | Idempotency check | A second sandbox run must create no additional changes | Complete | P0 |
| 16 | Source drift detection | Compare file/symbol baseline before applying a patch | Complete | P0 |
| 17 | Stale-anchor diagnostics | Export current code and nearest matching blocks | Complete | P0 |
| 18 | Syntax suggestions | File, line, column, caret and targeted hints | Complete | P1 |
| 19 | Structured diagnostics | Normalize compiler/build/runtime errors | Complete | P1 |
| 20 | Root-cause clustering | Keep primary causes and suppress cascaded failures | Complete | P1 |
| 21 | Smart console filtering | Reduce noisy C/C++, ESP-IDF, Docker, Gradle, Node, Rust, Python, Go, .NET, Bazel and Maven output | Complete | P1 |
| 22 | Raw evidence preservation | Retain detailed redacted logs in DETAIL ZIP | Complete | P0 |
| 23 | Advanced secret redaction | Remove tokens, credentials, cookies, authorization and private keys before persistence | Complete | P0 |
| 24 | Environment fingerprint | Minimal reproducibility information without environment dumps | Complete | P1 |
| 25 | Diagnostic quality report | Record compression, truncation, redaction and context completeness | Complete | P1 |
| 26 | AI summary/code/detail bundles | Separate compact and deep evidence | Complete | P1 |
| 27 | Unified AI handoff | One default ZIP for AI analysis | Complete | P0 |
| 28 | Failure delta/history | Compare the current failure with the last local result | Complete | P1 |
| 29 | `ls` collector | Safe bounded directory listing | **Complete in v5.9** | P0 |
| 30 | `tree` collector | Safe bounded tree without requiring system `tree` | **Complete in v5.9** | P0 |
| 31 | Project overview collector | ls, tree, file-type statistics, build files and Git summary | **Complete in v5.9** | P0 |
| 32 | Research collector | Project overview plus bounded search evidence | **Complete in v5.9** | P0 |
| 33 | Find/glob collector | Find paths by glob and optionally collect matching files | **Complete in v5.9** | P0 |
| 34 | File/range collector | Complete file or selected line range | Complete | P0 |
| 35 | Head/tail collector | First or last N lines of a file/log | **Complete in v5.9** | P1 |
| 36 | Symbol collector | Extract a function/class/struct-like block | Complete | P0 |
| 37 | Search collector | Text/regex search with bounded context | Complete | P0 |
| 38 | Reference collector | Find symbol references across selected paths | **Complete in v5.9** | P0 |
| 39 | Callgraph context | Root symbol, caller references and heuristic callee candidates | **Complete in v5.9** | P1 |
| 40 | Dependency collector | Extract C/C++ includes and common language imports/use/mod dependencies | **Complete in v5.9** | P1 |
| 41 | Directory collector | Collect source groups by include/exclude rules | Complete | P0 |
| 42 | Multi-path pack collector | Combine selected files/directories into one portable AI ZIP | **Complete in v5.9** | P0 |
| 43 | Safe Git context collector | Fixed status/log/diff sections; no arbitrary shell execution | **Complete in v5.9** | P1 |
| 44 | Large decompile collector | GM52-derived SQLite index, address/name/regex, neighbors and references | Complete | P0 |
| 45 | JSON multi-action request | One request can combine all collector types into one ZIP | Complete | P0 |
| 46 | Collector path/security policy | Relative paths, traversal prevention, secret exclusion and policy-capped limits | Complete | P0 |
| 47 | Semantic-safe source blocks | Keep source/patch blocks whole-or-omit; compact Markdown/logs on logical section/line boundaries | **Complete in v5.16** | P1 |
| 48 | Explicit token budgets | Hard HANDOFF/SUMMARY/CODE token ceilings with deterministic evidence priority; DETAIL remains intentionally complete | **Complete in v5.16** | P1 |
| 49 | Bundle deduplication | SHA-256 deduplication inside each AI-facing bundle; compatibility bundles remain intentionally separate | **Complete in v5.16** | P2 |
| 50 | Source-aware handoff selection | PASS uses compact proof; FAIL adds focused payload/source evidence with omission audit | **Complete in v5.16** | P1 |
| 51 | Multi-machine history policy | Local history never becomes a phase/dependency constraint | Complete | P0 |
| 52 | Project identity key | Adopt on a new machine; skip foreign-project patches | Complete | P0 |
| 53 | Local duplicate detection | Skip identical successful payloads on the same machine | Complete | P0 |
| 54 | Non-patch ZIP filtering | Quarantine handoff/report/foreign archives without queue failure | Complete | P0 |
| 55 | Relative-path reporting | Portable paths in manifest, reports and handoff | Complete | P0 |
| 56 | Project-key migration | Controlled identity change without misclassifying old patches | Not started | P1 |
| 57 | Validation profiles | Trusted project commands selected by name | Complete | P0 |
| 58 | Delta-based validation selection | Choose profiles from actual sandbox changes | Complete | P1 |
| 59 | Safe diagnostic rerun | One bounded rerun; blocks flash/OTA/deploy/push/release | Complete | P1 |
| 60 | Validation levels | Standard Level 1 syntax through Level 5 deployment/device | Not started | P2 |
| 61 | Push quality gate | Require stronger validation for push than commit | Not started | P1 |
| 62 | Interrupted-run recovery | Detect and clean abandoned sandbox/process state | About 50% | P1 |
| 63 | Disk-space preflight | Verify space for sandbox/build/report before mutation | Not started | P1 |
| 64 | Resource limits | CPU/RAM/log limits for pathological commands | About 30% | P1 |
| 65 | Signed patch manifest | Optional authenticity verification | Not started | P3 |
| 66 | Reproducible package bytes | Deterministic ZIP metadata and byte-identical output | Not started | P3 |
| 67 | Declarative post-patch commands | Manifest requests argv commands without shell strings | **Complete in v5.10** | P0 |
| 68 | Change-gated command execution | Normal patch commands run only when payload creates a real delta | **Complete in v5.10** | P0 |
| 69 | Command-only package | Accept a manifest-only package when its sole purpose is a safe project-local command | **Complete in v5.10** | P0 |
| 70 | Restricted no-change override | Explicit reason, project policy and command-count limit for exceptional no-delta runs | **Complete in v5.10** | P1 |
| 71 | Basic command allowlist | Only bounded `ls`, `tree`, `pwd`, `find`; dangerous actions rejected | **Complete in v5.10** | P0 |
| 72 | Project-local script boundary | Relative scripts must resolve inside the transaction worktree | **Complete in v5.10** | P0 |
| 73 | Inline/shell execution rejection | Block shell strings, `python -c/-m`, `bash -c`, `node -e`, encoded PowerShell and external binaries | **Complete in v5.10** | P0 |
| 74 | Command timeout/process supervision | Reuse bounded logs, timeout and process-tree cleanup | **Complete in v5.10** | P0 |
| 75 | Command-aware delta and validation | Recompute changed paths after commands before validation/apply/Git | **Complete in v5.10** | P0 |
| 76 | Command argument secret guard | Reject credential-like manifest arguments and redact reported argv | **Complete in v5.10** | P0 |
| 77 | Idempotency-before-command ordering | Verify payload before one-time command side effects; do not replay commands | **Complete in v5.10** | P1 |
| 78 | Extract-and-run installation | Unzip directly at project root and run without installer | **Complete in v5.11** | P0 |
| 79 | Correct public-runner placement | `run_python_patches.sh` exists only at `tools/`, never inside `_patch_lib/` | **Complete in v5.11** | P0 |
| 80 | Portable direct upgrade | Extract a newer package over the project while preserving active config | **Complete in v5.11** | P0 |
| 81 | Optional controlled installer | Backup/migration/config helper remains private under `_patch_lib/` | **Complete in v5.11** | P1 |
| 82 | Portable-layout regression test | Fresh extraction, executable mode, immediate IDLE run and v5.10 overlay upgrade | **Complete in v5.11** | P0 |
| 83 | Interactive patch selection default | Zero-argument mode asks instead of silently running all packages | **Complete in v5.12** | P0 |
| 84 | TTY checkbox multi-select | Arrow navigation, Space toggle, all/none, confirm and cancel | **Complete in v5.12** | P0 |
| 85 | Line-mode multi-select fallback | Accept single numbers, lists, ranges, all/none and quit without TTY | **Complete in v5.12** | P0 |
| 86 | Repeated explicit `--patch` | Select several named/numbered packages non-interactively | **Complete in v5.12** | P1 |
| 87 | Unselected-package preservation | Keep unselected patches in queue and record `user_not_selected` | **Complete in v5.12** | P0 |
| 88 | Selection-aware identity adoption | New machine adopts project key from first actually selected patch | **Complete in v5.12** | P0 |
| 89 | Explicit non-interactive automation | `--all` or config `selection=all` remains available for CI | **Complete in v5.12** | P0 |
| 90 | Legacy v4 standalone patch execution | Run recognized `patch_*.py` and helper-based standalone files through v5 supervision | **Complete in v5.13** | P0 |
| 91 | Legacy v4 archive execution | Run ZIP/TAR.GZ/TGZ packages with nested scripts and original all-Python fallback | **Complete in v5.13** | P0 |
| 92 | v4 helper API compatibility | Preserve the public v4 `python_patch_utils` API and CLI flags | **Complete in v5.13** | P0 |
| 93 | Strict-policy legacy exception | Allow positively recognized v4 input under v5 ZIP/manifest/metadata requirements | **Complete in v5.13** | P0 |
| 94 | Unscoped legacy project safety | Never adopt/compare project identity from a keyless v4 package; report scope unverified | **Complete in v5.13** | P0 |
| 95 | Mixed v4/v5 selected queue | Allow v4 packages while adopting identity from first selected keyed v5 package | **Complete in v5.13** | P0 |
| 96 | Legacy-vs-handoff discrimination | Reject incidental Python files/ZIPs without v4 filename or helper markers | **Complete in v5.13** | P0 |
| 97 | Legacy report metadata | Include package format, compatibility state and scope-verification state in AI bundles | **Complete in v5.13** | P1 |

| 98 | Absolute critical console paths | Print project root, handoff, report and LAST_RUN paths as absolute local paths | **Complete in v5.14** | P0 |
| 99 | Output-file role guide | Explain the meaning and normal use of every generated ZIP | **Complete in v5.14** | P0 |
| 100 | Primary handoff highlighting | Mark AI_HANDOFF as the one normal file to upload | **Complete in v5.14** | P0 |
| 101 | ANSI color roles | Green primary, cyan optional, yellow debug, blue local info and red failure with text fallback | **Complete in v5.14** | P1 |
| 102 | REPORT/DETAIL alias clarification | State that REPORT ZIP is normally the same DETAIL ZIP, not another file | **Complete in v5.14** | P0 |
| 103 | Persistent LAST_RUN file guide | Embed the output-file meaning table and project root in LAST_RUN.md | **Complete in v5.14** | P1 |

| 104 | Color-coded run states | PASS green, FAIL red, SKIPPED yellow, CANCELLED cyan and IDLE blue with text fallback | **Complete in v5.15** | P0 |
| 105 | Executed-patch list | Final summary prints exact filenames of every patch actually executed | **Complete in v5.15** | P0 |
| 106 | Short handoff bundle names | Bundle filenames use short timestamp/fingerprint/status names instead of original patch filename | **Complete in v5.15** | P1 |
| 107 | Selector patch deletion | Delete queued patch from TTY/line selector with explicit confirmation and LAST_RUN audit entry | **Complete in v5.15** | P1 |

| 108 | Visible auto-skipped queue items | Selector shows duplicates/non-patches/foreign-project items filtered before selection, including reason and quarantine destination | **Complete in v5.16** | P0 |
| 109 | Handoff budget audit | `ai_handoff_budget.md/json` records included, compacted, omitted and duplicate evidence | **Complete in v5.16** | P1 |

## v5.16 completion decision

The **Token reduction and AI handoff** group is now **100% complete for the defined normal workflow**. HANDOFF is bounded and source-aware, while DETAIL remains the deliberate complete redacted fallback. The selector also keeps local duplicate suppression visible so an automatically quarantined patch never appears to disappear without explanation.

The next development group is **Multi-machine/project support (95%)**.

## v5.15 completion decision

Status readability, executed-patch traceability, short bundle filenames and in-selector deletion are **100% complete for the requested scope**. The active group remains **Token reduction and AI handoff (92%)**.


## v5.14 completion decision

Output-file discoverability and local path clarity are **100% complete for the requested scope**. The user normally uploads only the bright-green `[PRIMARY - UPLOAD] AI_HANDOFF.zip`. Split summary/code bundles remain for backward compatibility, while DETAIL remains a debug-only fallback.

Portable JSON and handoff metadata continue to prefer relative paths; absolute paths are a local console/LAST_RUN convenience and are not used as cross-machine patch constraints.

The next active group remains **Token reduction and AI handoff (90%)**.

## v5.13 completion decision

Patch Tool v4 input compatibility is **100% complete for the defined compatibility scope**. New AI output remains v5-only. The next active group returns to **Token reduction and AI handoff (85%)**.

The compatibility contract is intentionally local-source based: a v4 patch has no project identity and no synchronized history, so selection is explicit confirmation and current Git/source is authoritative.

## v5.12 completion decision

The fixed next active group remains **Token reduction and AI handoff**. v5.12 is an explicit user-requested queue-control correction in the remaining-improvements group.

Interactive selection is considered **100% complete for the requested scope** because:

- zero-argument mode defaults to `selection=prompt`;
- the TTY menu supports one, many, all, none, confirm and cancel;
- line fallback supports numeric lists and ranges;
- Enter with no selection never silently runs all;
- CI retains explicit `--all` and config-driven automation;
- unselected packages remain in `patchs/` and are recorded in last-run state;
- a new machine adopts `project.key` from the first selected patch, not the first queue file;
- portable v5.11 layout and all earlier safety behavior remain regression-tested.

## v5.16 late additions

| # | Feature | Short description | Status | Priority |
|---:|---|---|---|---|
| 110 | Ephemeral live task status | TTY-only single-line `\r` status for sandbox overlay, patch payloads, post commands, validation, idempotency, verified-delta apply, Git and report creation; never persisted into AI/report logs | **Complete in v5.16** | P0 |
| 111 | Minimal default AI artifacts | Default AI output is `HANDOFF.zip` + `DETAIL.zip`; separate SUMMARY/CODE ZIPs are compatibility-only and can be re-enabled by config | **Complete in v5.16** | P1 |
| 112 | JSON-safe budget compaction | Machine-readable JSON is kept whole-or-omitted so token budgeting can never create malformed JSON | **Complete in v5.16** | P0 |
