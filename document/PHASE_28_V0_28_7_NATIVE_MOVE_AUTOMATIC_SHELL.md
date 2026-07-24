# Phase 28 v0.28.7 — Native move completion and automatic shell launch

This hotfix repairs the actual completion boundary between Native Host download relocation and post-download shell execution.

## Root causes fixed

1. A correlated `move_download` response was resolved as a generic pending Native Host request before the download state machine consumed it. Depending on timing, the job could remain `moving`, so the Execute shell command button stayed disabled and automatic execution never started.
2. Automatic mode pre-set `shellStatus` to `starting` before calling `startDownloadShellForJob`. The start function correctly rejects an already-starting job, so automatic execution blocked itself.

## Correct behavior

- A successful move response is normalized and consumed inside the Native Host message listener before the pending request resolves.
- The continuation in `moveCompletedDownload` is retained as a guarded fallback and cannot process the same completion twice.
- Duplicate move responses are idempotent and cannot launch the frozen command twice.
- Manual and automatic post-download execution both use the immutable download snapshot.
- Automatic mode leaves the completed job `available` until `startDownloadShellForJob` changes it to `starting` itself.
- Download-triggered commands always run in background mode for complete stdout/stderr capture.
- Command text is passed unchanged to Native Host. Operators such as `&&`, `||`, pipes, quoting and redirection remain shell syntax; a nonzero result means one command in the shell expression failed according to normal Bash semantics.

No Native Host source is changed by this patch.
