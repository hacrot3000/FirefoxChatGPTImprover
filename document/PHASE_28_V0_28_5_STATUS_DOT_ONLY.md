# Phase 28 v0.28.5 — Status-dot-only hotfix

The volatile local-action draft indicator no longer renders a sentence inside the Local action profile heading.

- Clean state: no indicator is visible.
- Unsaved volatile edits: one 8 px yellow dot is visible.
- The dot has an accessible label and a short hover tooltip, but no visible text.
- Volatile-edit runtime priority and reload-loss semantics are unchanged.

The Phase 16 compatibility correction from v0.28.4 is included so this patch can also be applied directly to a v0.28.3 source tree. No Native Host files are changed.
