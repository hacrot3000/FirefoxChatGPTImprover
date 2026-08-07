# FirefoxChatImprover current project status

**Current baseline:** Phase 64 v0.41.5
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
| Source integrity and regression | Complete | Phase 04–64 contracts, syntax audits, Native Host tests, release-status, configuration/session scope and Stop/Start continuity gates, plus opt-in real-Firefox E2E/version-matrix tooling. |

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





## Phase 64 v0.41.5 — Manual-preferred snapshot compaction

- Recovery-history normalization now uses the same Manual-over-automatic intent rule as Phase 63 add-time deduplication.
- A newer automatic snapshot can no longer erase an older Manual recovery point with the same semantic fingerprint during browser/background reload.
- When duplicates have the same class, the newest snapshot is retained.
- Semantic fingerprint rules and the bounded 20-snapshot retention policy remain unchanged.

## Phase 63 v0.41.4 — Manual snapshot promotion

- Manual snapshot intent is no longer lost when the same semantic configuration already exists as an automatic safety snapshot.
- The matching automatic entry is replaced by the Manual snapshot while keeping only one fingerprint-equivalent recovery point.
- Later automatic duplicates cannot demote the Manual entry.
- Phase 62 semantic fingerprinting and the existing bounded 20-snapshot retention policy remain unchanged.

## Phase 62 v0.41.3 — Semantic recovery snapshot deduplication

Full-configuration snapshot identity now excludes revision and created/updated timestamps while retaining every behaviorally meaningful profile, default, rule, Local action, preset, prompt and sidebar preference. Existing duplicate full snapshots are compacted on load and the newest semantic copy is retained.

## Phase 61 v0.41.2 — Atomic full configuration commit

Full configuration import/restore now writes the five reusable/global configuration stores on one storage commit boundary. If the provider rejects the write, the previous coherent payload is restored on a best-effort basis before the error is surfaced. Runtime caches are not advanced before storage succeeds.

## Phase 60 v0.41.1 — Configuration import preview and confirmation

- Selecting a configuration file is now read-only until preview/validation succeeds and the user explicitly confirms the import.
- Preview distinguishes full all-configuration bundles from legacy Automation-only JSON and reports the libraries that will be replaced.
- The existing pre-import recovery snapshot remains the final safeguard immediately before mutation.

## Phase 59 v0.41.0 — Configuration scope return contract

- Full configuration import/restore now propagates `scope`, Automation preservation and Local action preservation through the background message response.
- The sidebar can therefore distinguish full bundles from legacy Automation-only files and reload itself only for the full scope.
- Imported/restored sidebar visibility, command presets and prompt templates become visible immediately without reloading monitored web tabs.

## Phase 58 v0.40.9 — Complete configuration backup

- **Export all configuration** now matches its label: it includes Automation/Monitor/Target profiles, Local action profiles, global command presets, custom prompt templates and sidebar visibility preferences.
- Working sessions, runtime logs, active download/shell jobs, recovery-history and tab-ID editor selection remain outside configuration scope.
- Recovery snapshots created from v0.40.9 onward use the same full scope; legacy Automation-only snapshots remain restorable.
- Import/restore preserves active and stopped tabs when Automation or Local action library values differ.

## Phase 57 v0.40.8 — Safe configuration restore

- Full Automation configuration import and recovery-snapshot restore no longer reconfigure active tabs implicitly.
- Active/stopped tabs whose referenced profile is missing or changed keep their prior effective values as tab overrides.
- Imported/restored profile libraries remain available for explicit assignment to a tab later.

## Phase 56 v0.40.7

- Working-session restore is now strictly session-scoped and never mutates global Automation or Local action profile libraries.
- Exact matching saved profiles are reused; missing or changed profiles fall back to per-tab effective-configuration snapshots.
- The working-session JSON format remains backward compatible at version 4.

## Phase 55 v0.40.6

- Standardized profile action labels across all four profile libraries.
- Removed the redundant Automation Duplicate button; Save as new profile now covers the natural copy/create workflow.
- Manual profile creation and rename reject case-insensitive duplicate names.
- Tab and rule assignment/reset actions now describe their actual effect explicitly.

## Phase 54 v0.40.5

- Monitor and Target profile libraries now provide explicit **Set as default** controls.
- Changing a component default changes only the initial library selection; it never modifies the current rule or running tabs.
- Default component profiles must be reassigned before deletion instead of silently falling back to the first profile.
- Profile renaming remains compact: edit **Profile name** and choose **Save current values**.

## Phase 53 v0.40.4

- Automation and Local action profile libraries expose explicit **Set as default** controls.
- Changing a default affects future fallback only; active sessions, stopped snapshots, drafts and jobs remain unchanged.
- A default profile must be replaced deliberately before it can be deleted.

## Phase 52 v0.40.3

- Typed profile-bundle imports are non-destructive by default.
- Existing IDs and local defaults are preserved; identical entries are skipped.
- ID/name conflicts are imported as fresh, clearly named copies.
- Running tabs, Local action drafts and frozen download/shell jobs do not change merely because a bundle was imported.

## Phase 51 v0.40.2

- Monitor/Target profile library operations preserve the complete Automation rule draft instead of reloading the applied/default profile.
- New component profiles are created from current values and stay selected; save/delete/import refresh only the library controls.
- Applying a component profile to the current rule remains explicit through `Apply to rule`.

## Phase 50 v0.40.1

- Saving a shared Local action profile captures any valid per-tab working draft before the profile revision changes.
- Each preserved destination/working-directory/command draft is restored with a fresh tab/session/profile/revision context after the save.
- Tabs without a draft continue to resolve the newly saved shared profile; no unnecessary tab override is created.

## Phase 49 v0.40.0

- Deleting an Automation profile preserves every affected active/stopped tab's effective automation configuration as a tab override instead of reverting to Default.
- Deleting a Local action profile preserves current download and shell values as a tab override and clears obsolete explicit bindings back to URL/default semantics.
- Local action profile bundle imports no longer erase per-tab working drafts or frozen download/shell values.
- Deletion dialogs report affected open tabs and the sidebar identifies preserved Local action overrides.

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
