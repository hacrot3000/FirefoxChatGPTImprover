# Phase 15 v0.15.2 — English UI, title de-duplication, and help disclosure

## Scope

- Convert all add-on sidebar labels, messages, notifications, picker overlays, selector previews, and Native Host errors to English.
- Migrate only historical generated names (`Mặc định`, `Profile mới`, `Quy tắc N`) to their English defaults without changing arbitrary user-defined names.
- Prevent monitor/alert title decorations from stacking after an extension reload or content-runtime reinjection.
- Make rule runtime status collapsible and keep every `?` help popover functional, including while its card is collapsed.

## Title ownership contract

The content alert engine stores the clean page title in `data-fci-base-title` and the last managed alert prefix in `data-fci-title-prefix`. Before writing a spinner or alert title it removes repeated managed prefixes and spinner frames. A normal site title such as `[Project] Title` is preserved.

## Rule status and help contract

`Rule runtime` is a closed `<details>` block by default. Its badge remains visible while the detail text is hidden until expanded. Help controls use the same `.help-menu` popover implementation in every card; the `?` button stays available even when the card is collapsed.

## Regression tests

`tests/test_phase15_v0152_english_title_help.js` verifies English UI markers, legacy generated-name migration, title de-duplication, rule runtime disclosure, and help popover structure.
