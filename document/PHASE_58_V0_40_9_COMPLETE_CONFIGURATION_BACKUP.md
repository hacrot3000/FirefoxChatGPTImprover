# Phase 58 v0.40.9 — Complete configuration backup

## Goal

Make **Export all configuration** and recovery snapshots match the actual configuration surface while preserving the strict separation from Working sessions and tab/runtime state.

## Full configuration scope

Included:

- Automation profiles, Monitor profiles and Target profiles.
- Local action profiles and their reusable download/shell settings.
- Global command presets.
- Custom prompt templates (built-ins remain code-defined).
- Sidebar visibility preferences: collapsed groups, Simple/Standard/All/Custom selection, visible feature IDs and automatic URL-profile editor selection preference.

Excluded:

- Working-session catalog and saved working-session entries.
- Active/background tab runtime and stopped-session runtime state.
- Command/run logs.
- Managed-download and shell-job runtime/receipts.
- Recovery snapshot history itself.
- Tab-ID-specific editor selections, list filters and other transient sidebar navigation state.

## Import and restore safety

Full bundle import and v0.40.9+ recovery restore replace the reusable global libraries but do not push their changed values into an already active or explicitly stopped tab. If an Automation or Local action profile is missing or differs after replacement, the tab retains its prior effective values as a tab override. Existing working drafts and frozen jobs remain isolated from configuration replacement.

## Compatibility

- Legacy JSON created before v0.40.9 is treated as Automation-only configuration and remains importable.
- Legacy recovery snapshots remain restorable and are labelled `legacy-automation-only`.
- New snapshots are labelled `all-configuration`.
- Working-session JSON remains version 4 and is not part of this bundle.
- Protocol remains 26. Native Host remains 0.13.0.
