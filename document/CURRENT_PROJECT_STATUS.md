# FirefoxChatImprover current project status

**Current baseline:** Phase 46 v0.39.7
**Primary supported environment:** Firefox Desktop plus Chromium/Chrome/Edge packages; Native Host registration is provided for Linux Chromium browsers  
**Native Host:** 0.13.0

## Completed production scope

| Area | Status | Notes |
|---|---|---|
| Multi-tab monitor and target automation | Complete | Independent tab/rule state, stability windows, baseline-only target action and recovery. |
| AI READY / Running status | Complete | `matched` remains AI READY; only `waiting` displays Running; optional bounded sound alerts are available per profile/tab and default to off. |
| Persistent custom tab titles | Complete | User-defined per-tab names survive reload/navigation/background restart, preserve the original page title and remain compatible with AI READY/Running decorations. |
| Configuration, URL routing and tab overrides | Complete | Includes protected drafts, snapshots, reusable Monitor/Target component profiles, typed per-profile JSON import/export and opt-in trusted-URL auto-activation with explicit permission gating. |
| Command presets and rule-triggered commands | Complete | Includes per-tab execution, status, stop and history. |
| Managed downloads | Complete | Capture, no-dialog restart, immutable snapshot, relocation, retry and post-download command. |
| Restart recovery for managed downloads | Complete | Armed captures resume while valid; moves replay by idempotent receipt. |
| Full command logs | Complete | File-backed paging, persisted fallback and legacy `runId` discovery. |
| Per-run compressed log export | Complete | ZIP export of the selected run with complete transcript, typed metadata, README, DEFLATE and explicit fallback completeness. |
| Prompt templates | Complete | Two built-ins in a dedicated config file, clipboard copy, last-input filling in the active tab and locally stored custom templates. |
| Chromium port | Complete | MV3 service worker, Side Panel, browser API adapters, deterministic Chrome/Edge build, PNG icons and separate Linux Native Host registration. |
| Native Host Linux | Complete | Version 0.13.0; shell execution, scoped stop, bounded log retention and transaction receipts. |
| Native Host Windows | Complete | PowerShell install/uninstall, dual registry-view registration, PowerShell/cmd execution, process-tree stop, Windows state/download paths and integration-test script. |
| Firefox build/release tooling | Complete | Lint, build, checksum, signing helper, rollback and guarded update channel management. |
| Firefox Android manifest validation | Complete | Minimum Firefox 142 removes unsupported-key warning. |
| Stop/Start tab configuration continuity | Complete | Stop stores a per-tab snapshot of the selected profile, tab override, current automation draft and Local action working state; Start restores it without falling back to default. Runtime/log/statistics state intentionally resets. |
| Tab-bound local-action working snapshots | Complete | Unsaved destination/command edits survive background recovery; stale cross-tab autosync is rejected by tab/session/URL/revision context. |
| Real Firefox E2E and version matrix | Complete | Opt-in runner covers tabs, title, badge, DOM action, navigation and optional Native Host download/shell; matrix emits JSON/Markdown per Firefox binary. |
| Named saved working-session catalog | Complete | Multiple locally stored named sessions with search, update, rename, duplicate, delete, per-session/catalog JSON backup and controlled subset restore. |
| Per-rule statistics dashboard | Complete | Session-isolated counts for match/click/verify/automatic-command outcomes, return-code frequencies, average target/pipeline timings, JSON export and reset. |
| Source integrity and regression | Complete | Phase 04–45 contracts, syntax audits, Native Host tests, release-status, configuration/session scope and Stop/Start continuity gates, plus opt-in real-Firefox E2E/version-matrix tooling. |

## Operator-provided deployment inputs

The code path is complete, but persistent self-hosted updates cannot be activated without external operator assets:

1. a Mozilla-signed XPI;
2. stable HTTPS URLs for the XPI and `updates.json`;
3. hosting credentials or deployment access.

Use:

```bash
python3 tools/manage_firefox_update_channel.py prepare \
  --xpi /absolute/path/to/signed.xpi \
  --xpi-url https://host/path/addon.xpi \
  --update-url https://host/path/updates.json

python3 tools/manage_firefox_update_channel.py verify \
  --update-url https://host/path/updates.json

python3 tools/manage_firefox_update_channel.py enable \
  --update-url https://host/path/updates.json
```

## Known physical limitation

A log file deleted before v0.28.20 cannot be reconstructed from metadata. Existing legacy files are now rediscovered automatically by `runId`; missing bytes remain irrecoverable by definition.

## Required implementation status

No required implementation tasks remain from the v0.28.19 feature audit. No required or recommended implementation tasks remain overall. No recommended implementation tasks remain either. The approved Chromium port and full accessibility audit are complete. Native Host for macOS remains deferred by project decision.

Windows runtime validation can be run on a Windows machine with:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\tools\test_native_host_windows.ps1
python .\tools\run_firefox_e2e.py --require-native
```

| Sidebar search/filter | Complete | Non-destructive filters cover tabs, configuration/monitor/target/local-action profiles, global command presets and per-tab command history while preserving the current selection and drafts. |





## Phase 46 v0.39.7

- Renamed the two profile systems to **Automation profiles** and **Local action profiles** with explicit, non-overlapping scopes.
- Reordered the sidebar into a coherent automation → local action → session/support → setup flow.
- Added an always-available feature chooser with Simple, Standard, All and Custom layouts persisted in sidebar UI storage.
- Hidden groups retain all configuration and runtime data; only their controls are removed from view.
- Moved automation save controls into Automation profiles and kept Backup and transfer limited to configuration transfer and recovery snapshots.

## Phase 45 v0.39.6

- Explicit Stop now suppresses trusted-URL auto-activation after reload and background/browser startup.
- Local action Apply/Clear operations on a stopped tab rewrite the preserved Local action choice and discard the superseded stopped draft.
- Manual configuration profile or URL-routing choices can intentionally bypass the snapshot, while failed Start attempts leave it intact.
- Sidebar refresh displays the newly selected profile instead of silently repainting the old stopped snapshot.

## Phase 44 v0.39.5

- Stop persists a dedicated `browser.sessions` snapshot for the current tab before deleting its active runtime session.
- Start restores the prior configuration profile, tab-specific config or current editor draft, plus Local action profile/override/working draft.
- The stopped tab remains visible with its preserved config in the sidebar; choosing another profile while stopped intentionally replaces the snapshot.
- Monitor runtime, target baseline, alerts, activity logs and per-rule statistics remain session-scoped and restart cleanly.

## Phase 43 v0.39.4

- Separated configuration transfer controls from working-session controls.
- Removed duplicate legacy session save/import buttons from the configuration card.
- Confirmed configuration JSON excludes the independently stored saved-session catalog.
- Protocol remains 26; Native Host remains 0.13.0.

## Phase 42 v0.39.3

- Closed the required and recommended feature backlogs consistently across release-facing documents.
- Removed stale guidance that still described the completed accessibility audit as the next task.
- Added regression coverage that rejects stale version/status/backlog metadata before release.
- Protocol remains 26; Native Host remains 0.13.0.

## Phase 41 v0.39.2

- Local action source summary distinguishes explicit tab binding, URL routing and default fallback.
- `Use URL/default` removes an explicit binding while the tab is stopped or active.
- Clearing a binding immediately resolves and persists the routed/default profile for an active session.
- Protocol is 26; Native Host remains 0.13.0.

## Phase 40 v0.39.1

- Local action `Apply to tab` works while the current tab is stopped.
- Explicit tab bindings persist in tab-session storage and are preferred on activation.
- A bound profile remains selected across refresh and Stop/Start cycles.
- Deleting a bound profile safely replaces stale tab bindings.
- Protocol remains 25; Native Host remains 0.13.0.

## Phase 39 v0.39.0

Full accessibility audit completed: focus order, screen-reader semantics, contrast/motion preferences and keyboard-only picker flow. Protocol 25 and Native Host 0.13.0 remain unchanged.
