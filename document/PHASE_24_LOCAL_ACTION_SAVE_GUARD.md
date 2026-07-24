# Phase 24 — Verified local-action persistence and draft protection

Phase 24 makes the separate local-action profile system auditable and loss-resistant. The sidebar now shows the effective source (tab override, assigned profile, URL route, or default profile), marks unsaved download/shell edits, protects them before tab/profile changes, and provides an explicit revert action.

Profile and tab-override saves are verified against the normalized data returned from background storage before success is shown. The tab save response includes the persisted public session so the sidebar can compare the effective local-action configuration byte-for-byte through a canonical fingerprint.
