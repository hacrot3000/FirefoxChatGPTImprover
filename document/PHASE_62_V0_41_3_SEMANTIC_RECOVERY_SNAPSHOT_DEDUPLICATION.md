# Phase 62 v0.41.3 — Semantic recovery snapshot deduplication

## Goal

Prevent recovery history from filling with snapshots that differ only by revision counters or created/updated timestamps.

## Contract

- Full configuration fingerprints retain every behaviorally meaningful reusable/global value.
- `exportedAt`, store revisions and profile/preset/template created/updated timestamps are excluded from fingerprint identity.
- Existing full snapshots are re-fingerprinted on load; semantic duplicates are compacted and the newest copy is retained.
- Legacy Automation-only snapshots remain compatible.
- Snapshot history remains bounded to 20 unique semantic states.
