# Phase 24 v0.24.4 — Page completion and retry semantics

Managed-download completion now prefers a high-z-index modal overlay centered in the original page. The sidebar dialog remains a fallback for restricted or unloaded pages and now writes the destination into the form control value rather than the ineffective `textContent` property.

Manual retry is explicitly a relocation retry, not a new network download. It moves the existing staging file using the currently saved destination and conflict policy. Stale completion fields are cleared before retry, success is accepted only after the move returns a valid absolute destination, and a missing staging file becomes non-retryable with instructions to trigger the target again.
