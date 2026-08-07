# Phase 63 v0.41.4 — Manual snapshot promotion

Phase 62 introduced semantic recovery-snapshot deduplication while retaining the existing bounded 20-snapshot history. Phase 63 fixes one remaining intent issue: if an identical semantic configuration already exists as an automatic safety snapshot, creating a Manual snapshot replaces that automatic entry with the new Manual snapshot rather than silently returning the automatic entry. The fingerprint-equivalent configuration remains stored once, and later automatic duplicates cannot demote the Manual entry.
