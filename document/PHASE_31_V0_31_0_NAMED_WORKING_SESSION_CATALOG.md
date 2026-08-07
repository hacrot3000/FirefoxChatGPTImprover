# Phase 31 v0.31.0 — Named saved working-session catalog

## Objective

Extend the Phase 20 file-based working-session workflow into a persistent local catalog without removing the existing JSON save/import controls.

## Delivered

- Up to 100 named saved sessions in Firefox local extension storage.
- Name and optional description for each catalog entry.
- Search by name, description, ID, tab title, URL, mode and activation state.
- Create from selected open tabs and update an existing entry from current tabs.
- Rename, duplicate and delete with explicit user actions.
- Controlled restore: select a subset of saved tabs, request site permissions first, then open tabs and restore add-on state.
- Import a single working-session file into the catalog without opening tabs.
- Export a selected entry as a standard working-session JSON file.
- Typed full-catalog JSON backup and collision-safe import.
- Existing Phase 20 direct file export/import remains available.

## Storage and compatibility

- Catalog key: `firefoxChatImprover.workingSessionCatalog.v1`.
- Working-session bundle version: 4; versions 1–3 remain readable and normalize to version 4.
- Catalog format: `firefox-chat-assistant-working-session-catalog`, version 1.
- Native Host is unchanged at 0.13.0.

## Safety

- Restores always present tab selection before opening anything.
- Site permissions are requested for the selected origins before restore.
- Since v0.40.7, restore is strictly session-scoped: it does not merge profiles or write the global Automation/Local action stores. Missing/mismatched saved profiles are represented by tab overrides using the embedded effective configuration.
- Search is UI-only and never changes the selected saved session.
- Import ID collisions with different content create a separate `(imported)` entry instead of overwriting unrelated data.
