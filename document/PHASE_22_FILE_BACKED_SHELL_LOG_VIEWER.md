# Phase 22 — File-backed full shell logs

Phase 22 completes the long-output shell workflow. Background commands write their complete transcript to the Native Host state directory while the sidebar keeps only a bounded live tail.

## Behavior

- Every run receives a stable `logId` and a UTF-8 log file under the current user's XDG state directory.
- The full log is read in 256 KiB pages through Native Messaging, so the dashboard payload and sidebar are not forced to hold the entire transcript.
- When a background command exits or fails, the log dialog opens automatically for the selected tab.
- The dialog can be closed and reopened from the Shell command body or from the collapsed group header.
- Users can copy the current selection, current page, or the entire transcript.
- Deleting a stored log removes only the transcript file and leaves command history metadata intact.
- Each tab may read only log IDs referenced by its own current run or command history.

## Compact controls

When the Shell command group is collapsed, its title exposes Run, Stop, Open full log, and Help controls. Help remains the rightmost item.

Interactive terminal mode records lifecycle events only because the external terminal owns its own TTY. Use background mode when complete stdout/stderr capture is required.
