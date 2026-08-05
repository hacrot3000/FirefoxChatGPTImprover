# Phase 28 v0.28.22 — bounded Native Host command-log retention

## Goal

Prevent the file-backed command-log directory from growing without limit while preserving running commands and completed-but-unread logs.

## Policy

The global settings store now contains a retention policy. Defaults are enabled, 90 days, 512 MiB and 500 files. Cleanup runs after startup and command completion and can also be started manually.

Deletion order is deterministic: logs older than the age limit first, then oldest-first until file-count and total-size quotas are met. Active Native Host run logs and extension-provided unread log IDs are protected. If protected files alone exceed a quota, cleanup reports that the limit could not yet be satisfied rather than deleting protected output.

Native Host 0.12.0 exposes `cleanup_logs` and log-store statistics. The extension clears deleted file references while retaining bounded inline fallback and command metadata.
