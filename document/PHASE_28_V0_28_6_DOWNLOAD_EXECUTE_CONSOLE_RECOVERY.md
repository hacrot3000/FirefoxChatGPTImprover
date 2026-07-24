# Phase 28 v0.28.6 — Download execute and console recovery

This hotfix repairs the completed-download shell workflow without weakening immutable download snapshots.

## Execute readiness

- A completed download can be executed manually when its frozen command is valid even if the editor originally selected terminal mode. Download-triggered commands are still forced to background mode so stdout and stderr can be captured.
- Automatic mode no longer permanently disables the manual button when automatic launch failed before a run ID was created.
- A run ID still enforces exactly-once execution for the completed download.
- Manual execution confirmation is honored for both manual mode and automatic-fallback mode.

## Console recovery

- File-backed logs remain preferred when the Native Host returns a log ID.
- When no log ID is available, Full command log opens from every stdout, stderr and system chunk received by the add-on.
- If reading a stored log fails, the dialog falls back to the in-memory stream instead of showing an empty console.
- Copy all works for both stored and inline logs.
- The sidebar warns when the connected Native Host is older than 0.10.0, because complete file-backed logs require the current host installation.

No Native Host source file is modified by this patch. An already-installed old Native Host must be reinstalled from the repository after applying the patch.
