# Phase 35 — Per-rule statistics dashboard (v0.35.0)

## Scope

- Collect diagnostics independently for each activated tab session and rule ID.
- Count MATCHED transitions, clicked/dry-run target elements, verification PASS/FAIL/skipped outcomes and automatic command success/failure.
- Record return-code frequencies, last-event timestamps, average MATCHED-to-target latency and average pipeline duration.
- Display totals and per-rule rows in a collapsible sidebar group.
- Export typed JSON or reset only the selected tab statistics.

## Counting semantics

- A match is counted only on a transition into `MATCHED`.
- Click and dry-run counters use per-cycle deltas and remain correct when target counters reset for a new monitor cycle.
- Verification is counted once when a pipeline enters a terminal verify state.
- Automatic command completion is correlated by `ruleId` and `runId`; return code `0` is success, non-zero and Native Host errors are failures.
- Observer checkpoints are persisted with the tab session to prevent duplicate counts after background recovery, but are removed from public dashboard data.

## Version

- Extension: `0.35.0`
- Protocol: `24`
- Native Host: `0.13.0` (unchanged)

## Regression

- Phase 04–35 test runner includes the new statistics contract.
- Phase 34 keyboard-shortcut checks remain forward-compatible.
- Sidebar group inventory includes `rule-statistics`.
