# Phase 28 v0.28.17 — alert-engine upgrade and title priority

## Failure reproduced

An already-open tab could keep `FCI_ALERT_ENGINE.VERSION = 8` from v0.28.15. v0.28.16 changed the engine implementation but did not raise that version guard, so reinjection skipped the new code while activation runtime 23 continued with the stale title controller. The resulting runtime could be active/waiting while reporting `monitorTitleSpinning: false` and displaying only `[✓]`.

## Contract

- Alert engine version is 9 and replaces version 8 during recovery.
- Activation runtime is 24 so the controller is reconstructed from the upgraded engine.
- Active waiting or matched monitoring keeps the AI spinner whenever no active alert frame is shown.
- Every active alert blink frame retains an AI prefix. Command state is always secondary.
