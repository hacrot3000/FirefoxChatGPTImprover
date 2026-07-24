# Phase 28 v0.28.14 — tab-bound command log and status

This patch binds the full command-log viewer to the selected tab, rejects stale asynchronous log pages after tab changes, persists command-running and completed-unread state per tab, and clears the unread state only after the matching console has actually been displayed. Stored-log read failures remain visible but non-fatal.
