# Phase 28 v0.28.15 — Preset edit and command notice cleanup

This phase removes the redundant direct-command button, protects edited preset values from accidental selection changes, makes Save configuration a normal scrolling group, and separates icon-only shell command notices from the AI monitor status.

The unread marker is acknowledged only after the matching log is displayed for the currently active browser tab. Legacy `viewed` notices normalize to `idle`, while stored log identifiers remain available for reopening.
