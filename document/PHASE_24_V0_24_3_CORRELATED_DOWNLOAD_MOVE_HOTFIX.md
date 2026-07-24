# Phase 24 v0.24.3 — Correlated managed-download relocation

The browser download reached the staging directory, but relocation used a fire-and-forget Native Messaging message. Host errors without a `moveId`, unsupported installed hosts, and lost replies could leave the job in `moving` forever.

This hotfix uses the move ID as the Native Messaging request ID, accepts either `requestId` or `moveId` in replies, adds a 20-second timeout, persists and broadcasts failures, and tells the user to reinstall the host when the installed host does not support `move_download`. Native Host 0.9.1 echoes both correlation IDs.
