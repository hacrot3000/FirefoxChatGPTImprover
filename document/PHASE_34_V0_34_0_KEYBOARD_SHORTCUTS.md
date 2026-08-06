# Phase 34 v0.34.0 — Keyboard shortcuts

## Scope

Firefox-managed keyboard commands provide pointer-free access to the most common current-tab actions.

## Commands

| Command | Default | Behavior |
|---|---|---|
| Open sidebar | Ctrl+Shift+Y | Opens Firefox ChatAI Assistant sidebar. |
| Toggle current tab | Ctrl+Shift+U | Activates, pauses or resumes the active tab. |
| Acknowledge alert | Ctrl+Shift+L | Dismisses the current active alert cycle. |
| Run target action | Ctrl+Shift+K | Runs the configured target click action in the active tab. |
| Open command log | Unassigned | Opens the active tab command log in the sidebar. |
| Stop current tab | Unassigned | Stops automation in the active tab. |

On macOS, suggested defaults use Command instead of Ctrl. Firefox remains the authority for shortcut assignment and conflict resolution.

## Safety

- Every command resolves the currently active tab at invocation time.
- Host permission is never requested silently from a shortcut.
- Pending sidebar actions carry action ID and tab ID and are acknowledged after consumption.
- Optional commands are unassigned by default to reduce conflicts.

## Versions

- Extension: 0.34.0
- Protocol: 23
- Native Host: 0.13.0 (unchanged)
