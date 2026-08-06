# Changelog

All notable user-visible changes to FirefoxChatImprover are documented here.

The format follows the principles of Keep a Changelog. Version numbers follow the add-on version in `extension/manifest.json`.

## [Unreleased]

### In progress

- Per-rule statistics dashboard for match, click, verification, command-result and timing diagnostics.

### Deferred

- Native Host for macOS is intentionally excluded from the current implementation sequence.

## [0.34.0] - 2026-08-06

### Added

- Firefox-managed keyboard shortcuts for opening the sidebar, toggling the current tab, acknowledging an alert and running the configured target action.
- Optional unassigned commands for opening the current tab command log and stopping the current tab.
- A sidebar Keyboard shortcuts group that displays the effective Firefox assignment, highlights unassigned/conflicting commands, opens Manage Extension Shortcuts and resets manifest defaults.
- Tab-bound shortcut action delivery so command-log requests and error messages are consumed by the correct sidebar/tab context.

### Safety

- Shortcut handlers always resolve the currently active tab and never reuse a stale sidebar selection.
- Permission failures open the sidebar with an actionable error instead of silently requesting host permission.
- Only four commands receive suggested defaults; optional commands remain unassigned to reduce Firefox shortcut conflicts.

## [0.33.0] - 2026-08-05

### Added

- Per-configuration-profile opt-in automatic activation for explicitly trusted HTTP/HTTPS URL patterns.
- A user-gesture **Grant auto-activation access** flow that requests only the configured host origins and saves the profile before scanning.
- Startup, completed-navigation, profile-save and manual open-tab scans using one guarded decision path.
- Live auto-activation eligibility and last-decision status in the URL activation group.

### Safety

- Automatic activation remains disabled by default.
- URL routing, explicit allowlist matching and Firefox host permission are mandatory.
- Universal host patterns are rejected.
- Active or paused tabs are never switched automatically, duplicate concurrent activation is blocked, and URL/profile routing is rechecked immediately before injection.

## [0.32.0] - 2026-08-05

### Added

- Optional sound alerts in the Alerts group, disabled by default.
- Three built-in tones: Soft chime, Double beep and Urgent.
- Per-profile/tab controls for volume, repeat count and repeat interval, with a Test sound preview.
- One-play-per-alert-cycle semantics, bounded repeats and immediate stop when the alert is dismissed.
- Recovery protection so an already-active alert cycle is not replayed after reload or background recovery.

## [0.31.0] - 2026-08-05

### Added

- A local catalog of multiple named working sessions stored inside the extension.
- Search by session name, description, tab title, URL or session ID.
- Create from selected open tabs, update from current tabs, rename, duplicate and delete saved sessions.
- Controlled restore that lets the user choose a subset of saved tabs and grants required site access before opening them.
- Export/import for an individual saved session and typed JSON export/import for the complete saved-session catalog.
- Existing file-based working-session save/import remains available for compatibility.

## [0.30.0] - 2026-08-05

### Added

- Search/filter controls for tabs, Configuration profiles, Monitor profiles, Target profiles, Local action profiles, command presets and per-tab command history.
- Selected items remain visible outside the active filter so filtering never changes the working selection or discards drafts.

### Release documentation hotfix

- Added `PROJECT_STATUS.md` as the release-facing inventory of completed, in-progress, planned and deferred features.
- Added generated rich release notes and documentation assets for GitHub Release publishing.

## [0.29.0] - 2026-08-05

### Added

- Reusable Monitor element and New target element profile libraries.
- Typed JSON import/export for Configuration, Monitor, Target and Local action profiles.
- Persistent per-tab custom titles that survive reload and navigation while preserving AI READY/running prefixes.

## [0.28.25] - 2026-08-05

### Added

- Windows Native Messaging Host runtime, PowerShell installer/uninstaller, registry integration, Windows path handling and process-tree stop support.

## [0.28.24] - 2026-08-05

### Added

- Real-Firefox E2E tooling and a multi-version Firefox compatibility matrix.

## [0.28.23] - 2026-08-05

### Fixed

- Bound managed-download working configuration and delayed autosync to the originating tab/session/revision, preventing cross-project destination changes.

## [0.28.22] - 2026-08-05

### Added

- Bounded Native Host command-log retention by age, total size and file count, with protection for running and unread logs.

## [0.28.21] - 2026-08-05

### Fixed

- Native Host version badge now shows the full version and a useful status tooltip.

## [0.28.20] - 2026-08-05

### Added

- Managed-download restart recovery, idempotent relocation receipts, legacy shell-log discovery and private signed update-channel tooling.

## [0.28.0-0.28.19]

### Changed

- Stabilization series for managed download, automatic shell execution, per-tab log isolation, popup execution, source integrity, alert-engine title priority and matched-ready timeout behavior.

## [0.25.0]

### Added

- Execute-shell-after-download workflow with disabled/manual/automatic modes and complete background stdout/stderr capture.

## [0.24.3]

### Added

- Managed dialog-free download capture and relocation with Native Host correlation.

## [0.23.1]

### Added

- Persistent Local action profiles, per-tab override and effective-source indicators.

## [0.18.0]

### Added

- Support-bundle export for diagnostics and project handoff.
