# Phase 16 — Command presets, allowlist and per-tab history

Phase 16 adds reusable command presets to profile/tab configuration, an optional background-enforced exact-match allowlist, and bounded command history stored only with each activated tab session.

## Security contract

- The content page cannot submit shell commands.
- When `Only run commands matching an enabled preset` is enabled, the background compares working directory, command text and mode against enabled presets before contacting the Native Host.
- Editing the sidebar fields does not bypass the background check.
- Command history is bounded, can be disabled, and is isolated by `tabId`.

## Compatibility

Existing profiles migrate with no presets, allowlist disabled and history enabled with a limit of 20. Existing free-form commands continue to work until allowlist mode is enabled.
