# Phase 36 v0.36.0 — Compressed per-run command-log export

## Goal

Archive one exact command run for storage or diagnostics without exporting unrelated tab history.

## User flow

1. Select the current command or a history entry.
2. Open **Full command log**.
3. Choose **Export run ZIP**.
4. The sidebar reads every page for the frozen tab ID/run ID/log ID, builds a compressed ZIP, and downloads it.

## Archive contract

| Entry | Purpose |
|---|---|
| `command.log` | Exact UTF-8 Native Host transcript for the selected run, or the persisted fallback when the original file is unavailable. |
| `metadata.json` | Schema/version, export time, extension/protocol version, tab/run correlation, command result and log completeness. |
| `README.txt` | Human-readable completeness and sensitive-data warning. |

`metadata.json` uses schema `firefox-chat-assistant.command-run-archive`, version 1. A complete file-backed export records `completeTranscript: true`. A fallback export records `false` and includes `fallbackReason`.

## ZIP implementation

`extension/shared/log_archive.js` creates standard classic ZIP records with CRC-32, UTF-8 entry names and DEFLATE (`CompressionStream("deflate-raw")`) whenever compressed data is smaller. Stored mode is used for entries that do not benefit from compression.

## Isolation and safety

- Background ownership validation remains authoritative for every `READ_SHELL_LOG` page.
- Export uses an immutable descriptor captured from the open dialog; later tab/history selection changes do not redirect it.
- Logs above 64 MiB require confirmation.
- Complete-log export is bounded at 512 MiB to avoid unbounded sidebar memory.
- The README warns that archives may contain commands, paths, URLs and output secrets.

## Versions

- Extension: 0.36.0
- Protocol: 24 (unchanged; existing paged read contract reused)
- Native Host: 0.13.0 (unchanged)
