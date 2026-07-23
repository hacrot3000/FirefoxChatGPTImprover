# Phase 15 v0.15.3 — Stability timer re-arm hotfix

## Problem

The Phase 13 monitor-stability test could pass once and then time out when the build task immediately ran it again. The same race could occur at runtime: a stability timer may execute just before its recorded deadline. The monitor evaluated too early, saw that the deadline had not been reached, and left no timer scheduled for the remaining fraction.

## Fix

- Stability callbacks calculate the remaining duration against the recorded deadline.
- An early callback re-arms itself for the exact remaining duration.
- Match and reset windows use the same recovery path.
- The Phase 13 test now uses a deterministic fake clock and explicitly executes both match and reset callbacks one millisecond early.
- No production timeout is increased and no machine-speed assumption remains in the test.

## Compatibility

The configuration schema and existing profiles are unchanged. This hotfix only changes stability-window scheduling and the regression test.
