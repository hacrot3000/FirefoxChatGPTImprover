# FirefoxChatImprover Project Status

<!-- FCI_PROJECT_STATUS_SCHEMA: 1 -->

- Current add-on version: **0.37.0**
- Native Host version: **0.13.0**
- Status updated: **2026-08-06**
- Required-feature backlog: **completed**
- Recommended-feature backlog: **in progress**

This file is the release-facing feature inventory. Every feature patch must update this file and `CHANGELOG.md` before a release is published.

## Completed features

| Area | Capability | Progress | Release state |
| --- | --- | ---: | --- |
| Multi-tab runtime | Independent activation, pause/resume/stop, cycles, logs, alert state and local actions per tab | **100%** | Released |
| Configuration management | Configuration profiles, URL routing, opt-in trusted-URL automatic activation, tab override, migration, recovery snapshots and typed import/export | **100%** | Auto-activation completed in v0.33.0 |
| Monitor and target profiles | Reusable Monitor element and New target element profile libraries with typed JSON import/export | **100%** | Released in v0.29.0 |
| Automation engine | Multiple rules, monitor conditions, stability window, new-target baseline, picker, selector tests and action pipeline | **100%** | Released |
| Alerts and titles | AI READY/running indicators, desktop notification, optional bounded sound alerts, badge/title lifecycle and persistent custom tab names | **100%** | Sound alerts completed in v0.32.0 |
| Sidebar scale | Search/filter for tabs, all profile libraries, command presets and command history | **100%** | Released in v0.30.0 |
| Keyboard shortcuts | Firefox-managed shortcuts for sidebar, tab lifecycle, alert acknowledgement, target action and command-log access | **100%** | Released in v0.34.0 |
| Per-rule statistics | Session-isolated match/click/verify/command counts, return-code frequencies, timing diagnostics, JSON export and reset | **100%** | Released in v0.35.0 |
| Command-run log archives | Per-run ZIP with complete paged transcript, metadata, README, DEFLATE compression and explicit fallback completeness | **100%** | Released in v0.36.0 |
| Prompt templates | Two code-configured built-ins, clipboard copy, active-tab last-input filling and locally stored user-defined templates | **100%** | Released in v0.37.0 |
| Working sessions | Export/import current tabs plus a searchable named catalog with update, rename, duplicate, delete, typed JSON backup and controlled subset restore | **100%** | Released in v0.31.0 |
| Managed downloads | Dialog-free capture, immutable per-tab jobs, relocation receipts, restart recovery and correlated Native Host responses | **100%** | Released |
| Shell execution | Manual/automatic execution, reusable presets, full stdout/stderr, per-tab history, recovery and stop semantics | **100%** | Released |
| Native Host platforms | Linux and Windows installer/runtime, process-tree control, path handling, relocation and bounded log retention | **100%** | Released in v0.28.25 |
| Release quality | Full regression suite, real-Firefox E2E tooling, version matrix, support bundles and signed update-channel tooling | **100%** | Released |
| Release documentation | Versioned changelog, current feature inventory and generated GitHub Release notes/assets | **100%** | Added by release-documentation hotfix |

## In progress

No recommended feature is partially implemented. The next item is the Chromium port.

## Planned features

| Priority | Feature | Expected value | Progress |
| ---: | --- | --- | ---: |
| 1 | Chromium port | Reuse the engine on Chrome/Edge with platform-specific manifest and Native Host registration | **0%** |
| 2 | Full accessibility audit | Focus order, screen reader, contrast and keyboard-only picker flow | **0%** |
## Deferred

| Feature | State | Reason |
| --- | --- | --- |
| Native Host for macOS | **Deferred by project decision** | Explicitly excluded from the current recommended-feature sequence |

## Release documentation policy

1. `PROJECT_STATUS.md` records what is complete, in progress, planned and deferred, including progress percentages.
2. `CHANGELOG.md` records version-specific user-visible changes.
3. `tools/release_documentation.py` validates both files against `extension/manifest.json`.
4. `tools/release_firefox_addon.py` builds rich `RELEASE_NOTES.md`, copies both source documents into the release directory and uploads them as GitHub Release assets.
5. A release build fails when the current manifest version has no matching changelog entry or the project-status version is stale.
