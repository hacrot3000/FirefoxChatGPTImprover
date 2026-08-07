# Changelog

All notable user-visible changes to FirefoxChatImprover are documented here.

The format follows the principles of Keep a Changelog. Version numbers follow the add-on version in `extension/manifest.json`.

## [Unreleased]

### Planned

- No additional recommended feature is scheduled after the completed accessibility audit.

### Deferred

- Native Host for macOS is intentionally excluded from the current implementation sequence.


## [0.40.0] - 2026-08-07

### Fixed

- Deleting an Automation profile no longer sends active or stopped tabs back to Default; their effective configuration is preserved as a tab override.
- Deleting a Local action profile no longer changes download destinations or shell commands on affected tabs; current values are preserved as tab overrides.
- Deleted explicit Local action bindings are cleared instead of converting URL/default fallback into a new explicit binding.
- Importing Local action profile bundles no longer discards per-tab working drafts or frozen download/shell values.

### Changed

- Profile deletion dialogs now explain the number of affected open tabs and the safe-detach behavior.
- Source summaries explicitly identify preserved Local action tab overrides.

### Compatibility

- Protocol remains 26 and Native Host remains 0.13.0.

## [0.39.9] - 2026-08-07

### Fixed

- Automation and Local action profile editor selections now survive sidebar close/reopen and add-on reload for the same tab URL.
- Stale saved editor choices are discarded when a tab navigates or a recycled tab ID points to a different URL.
- URL-routed Automation selection, stopped-tab manual selection and stopped-snapshot bypass remain consistent after sidebar reload.
- Duplicating an Automation profile now selects the new copy immediately.

### Changed

- Automation and Local action profile summaries now distinguish the profile being edited from the profile currently used by the tab.

### Compatibility

- Protocol remains 26 and Native Host remains 0.13.0.

## [0.39.8] - 2026-08-07

### Fixed

- `Save current as new` now creates Automation and Local action profiles from the complete values currently visible in the editor.
- Saving or creating a profile keeps that profile selected and preserves the current form instead of reverting to Default.
- Local action profile saving now includes the current working directory, shell command and related shell options.
- Profile editor selection is separated from the profile or Local action binding currently applied to a tab.

### Compatibility

- Protocol remains 26 and Native Host remains 0.13.0.

## [0.39.7] - 2026-08-06

### Changed

- Renamed `Configuration profiles` to `Automation profiles` and clarified the distinct `Local action profiles` scope.
- Reorganized sidebar groups into automation, local-action, session/support and setup areas with clearer names.
- Moved automation save/tab-override controls into Automation profiles, page-highlight cleanup into Rule target action, and left Backup and transfer responsible only for configuration transfer and recovery snapshots.
- Added persistent Simple, Standard, All and Custom sidebar layouts from the always-visible feature button in Tabs and runtime.
- Hiding a feature now hides only its controls; stored data, running automation and Stop/Start state are preserved.

### Compatibility

- Protocol remains 26 and Native Host remains 0.13.0.

## [0.39.6] - 2026-08-06

### Fixed

- Explicitly stopped tabs are no longer reactivated by URL auto-activation after reload or browser startup.
- Applying or clearing a Local action profile while stopped now updates the preserved snapshot instead of allowing the previous draft/profile to return on Start.
- Manual profile and URL-routing choices override the stopped snapshot consistently, including after sidebar refresh.
- A stopped snapshot is consumed only after Start succeeds, so permission or content-script failures do not lose the preserved configuration.

### Compatibility

- Protocol remains 26 and Native Host remains 0.13.0.

## [0.39.5] - 2026-08-06

### Fixed

- `Stop` now stores a tab-scoped configuration snapshot instead of discarding the tab's selected profile and overrides.
- The next `Start` restores saved tab configuration, unsaved monitor/target editor drafts, Local action tab overrides and Local action working drafts.
- Stopped tabs keep their previous configuration visible in the sidebar rather than immediately displaying the default profile.
- Runtime-only state such as monitor baselines, alerts, logs and per-rule statistics still resets on Stop.

### Compatibility

- Protocol remains 26 and Native Host remains 0.13.0.

## [0.39.4] - 2026-08-06

### Changed

- Removed the legacy `Save working session` and `Import working session` controls from the configuration import/export group.
- Renamed the whole-store actions to `Export all configuration` and `Import all configuration` to reflect their actual data scope.
- Kept named-session save, restore, JSON import/export and catalog backup exclusively in `Saved working sessions`.
- Added regression coverage proving that configuration JSON excludes the separately stored saved-working-session catalog.

### Compatibility

- Protocol remains 26 and Native Host remains 0.13.0.

## [0.39.3] - 2026-08-06

### Release consistency

- Marked the required and recommended feature backlogs complete across release-facing status documents.
- Removed stale guidance that still named the already-completed accessibility audit as the next task.
- Added a release-status consistency regression that checks manifest, changelog, project status, current status, implementation plan and test-runner version together.
- Kept Native Host for macOS explicitly deferred.

### Compatibility

- Protocol remains 26 and Native Host remains 0.13.0.

## [0.39.2] - 2026-08-06

### Added

- Accurate Local action source summary for explicit tab bindings, URL-routed profiles and default fallback.
- A `Use URL/default` action that clears an explicit Local action profile binding on stopped or active tabs.

### Fixed

- Active sessions are no longer labeled as explicitly bound merely because they have an effective Local action profile.
- Clearing a binding immediately updates the active session and preserves the routed/default choice across refresh and Start.

## [0.39.1] - 2026-08-06

### Fixed

- `Apply to tab` for Local action profiles is now available while the selected current tab is stopped.
- An explicit Local action profile selection is stored as a tab-scoped binding and survives Start/Stop transitions and sidebar refreshes.
- Starting a stopped tab now prefers its explicit Local action binding instead of falling back to the default or URL-routed profile.
- Deleted Local action profiles safely rebind affected stopped tabs to the current routed/default profile.

### Compatibility

- Protocol remains 25 and Native Host remains 0.13.0.


## [0.39.0] - 2026-08-06

### Accessibility

- Added a keyboard-visible skip link and a stable main-content focus target for the long sidebar.
- Added consistent high-visibility focus rings, unique accessible names for repeated profile transfer controls, live status semantics, busy-state announcements and explicit dialog labels/descriptions.
- Added reduced-motion, increased-contrast and forced-colour adaptations without changing normal visual operation.
- Completed keyboard-only element picking: Tab and Shift+Tab move through page controls, Enter or Space selects the focused element, and Escape cancels while restoring the previous page focus.
- Added an assertive, screen-reader-visible picker instruction/status surface and retained mouse/pointer selection.

### Compatibility

- Firefox and Chromium packages share the accessibility changes.
- Protocol remains 25 and Native Host remains 0.13.0.

## [0.38.0] - 2026-08-06

### Added

- A dedicated Manifest V3 build for Chromium, Google Chrome and Microsoft Edge using the shared Firefox automation engine.
- Chromium Side Panel integration and a single service-worker entry point with ordered shared-script loading.
- A cross-browser API compatibility layer for Promise message responses, tab-scoped session values, side-panel opening, shortcut settings and browser metadata.
- Deterministic unpacked and ZIP artifacts with generated PNG icons, stable local extension ID, checksums and release metadata.
- Separate Linux Native Host registration for Chromium, Chrome and Edge using `allowed_origins` and an overridable store extension ID.
- Development launch tooling for isolated Chromium profiles.

### Compatibility

- Firefox continues to use its native background scripts, sidebar and `browser` namespace.
- Chromium packages remove unsupported Firefox manifest keys and normal-MV3 `webRequestBlocking`; managed downloads retain the browser-download event fallback.
- Native Host remains 0.13.0.

## [0.37.0] - 2026-08-06

### Added

- A **Prompt templates** sidebar group with two bundled Vietnamese workflow prompts.
- One-click filling of the last visible writable textarea, text/search input, or compatible contenteditable textbox in the currently displayed page.
- Clipboard copy for the selected prompt template.
- Locally stored custom prompt templates with create, update and delete actions.
- `extension/shared/prompt_templates.js` as the dedicated, easy-to-edit built-in template configuration file.

### Reliability and safety

- Prompt filling is bound to the currently displayed tab and rejects stale sidebar tab selection.
- Native value setters plus `input` and `change` events keep React/framework-controlled inputs synchronized.
- Built-in templates remain read-only; custom templates are validated, size-bounded and isolated in Firefox local storage.
- Native Host remains 0.13.0 and does not need to be reinstalled.

## [0.36.0] - 2026-08-06

### Added

- **Export run ZIP** in the Full command log dialog for the currently displayed command run.
- A standard ZIP archive containing `command.log`, `metadata.json` and `README.txt`.
- Complete transcript collection through the existing tab-owned paged Native Host log API.
- Run metadata for command source, preset/rule correlation, working directory, status, return code, timestamps and log completeness.

### Reliability and safety

- ZIP entries use DEFLATE when compression reduces size and preserve exact UTF-8 transcript bytes.
- The selected tab ID, run ID and log ID are frozen when export starts, so changing sidebar selection cannot redirect an in-progress export.
- If the complete Native Host file is unavailable, the archive uses the persisted per-run fallback and records `completeTranscript: false` plus the failure reason.
- Large-log confirmation and a 512 MiB per-run memory guard protect the sidebar from accidental unbounded allocation.
- Archives explicitly warn that commands, paths, output and URLs may contain sensitive information.

## [0.35.0] - 2026-08-06

### Added

- A per-rule statistics dashboard isolated by activated tab session.
- Counts for monitor MATCHED transitions, clicked and dry-run target elements, verification PASS/FAIL/skipped results, automatic command success/failure and return-code frequencies.
- Average MATCHED-to-target latency and target-pipeline duration with last-event timestamps.
- JSON export and explicit reset for the current tab without changing rules or stopping automation.

### Reliability

- Statistics observer checkpoints persist with the tab session across background recovery and prevent duplicate counting.
- Command completion is correlated by rule and run ID; private observer state is never exposed in the dashboard payload.

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
