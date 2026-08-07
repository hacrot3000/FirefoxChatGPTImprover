# Phase 61 v0.41.2 — Atomic full configuration commit

Full configuration import and full recovery-snapshot restore now prepare Automation, Local action, command-preset, prompt-template and sidebar-preference stores first and write all five keys in one `browser.storage.local.set(...)` call. In-memory Automation/Local-action caches are updated only after that commit succeeds.

If the storage provider rejects the commit, the background makes a best-effort rollback to the previous coherent five-store payload and returns an error instead of intentionally continuing with a partially replaced global configuration. Existing active/stopped-tab safe-detach reconciliation runs only after the global commit succeeds.
