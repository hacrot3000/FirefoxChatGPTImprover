# Phase 28 v0.28.19 — matched-ready timeout semantics

- `monitorState=matched` always represents AI READY.
- Active-tab timeout only acknowledges/stops blinking; it never changes matched into Running.
- `monitorState=waiting` is the only state that uses the running spinner.
- Shell running/unread remains a secondary icon and does not change AI state.
- Alert engine 10 and activation runtime 26 force replacement of stale title controllers.
