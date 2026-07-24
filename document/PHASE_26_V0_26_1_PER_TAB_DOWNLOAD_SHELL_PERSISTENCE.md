# Phase 26 v0.26.1 — Per-tab download shell persistence hotfix

## Reported regression

A shell command could be entered and executed manually, but the displayed Working directory and Command were not persisted into the selected tab's effective local-action configuration. The next managed download therefore froze the previous/empty shell settings. In addition, the completion-dialog Execute shell command button was created disabled and the sidebar never recalculated that disabled state.

## Fix

- Before a manual shell run, the displayed Managed download and Shell command sections are normalized, validated, saved through `SAVE_TAB_LOCAL_ACTIONS`, and read back before `RUN_SHELL` is sent.
- Only the execution-related download/shell settings are promoted to the tab override; URL-routing edits remain governed by their explicit profile/tab save controls.
- The completed download button now derives readiness from the immutable `configSnapshot`, including relocation status, capture ID, destination path, execution mode, frozen working directory/command, and prior-run state.
- The manual completion action shows the frozen working directory, command, and relocated file in its confirmation.
- A pure readiness contract and VM regression test cover valid, missing-command, automatic, incomplete, and already-executed download jobs.

No Native Host reinstall is required because the wire protocol and host implementation are unchanged.
