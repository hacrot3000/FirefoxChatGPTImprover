# Phase 28 v0.28.4 — Phase 16 test-contract compatibility hotfix

The Phase 16 regression test still required the original profile-local preset-name field and the original mandatory preset allowlist checkbox. Phase 28 intentionally replaced that workflow with a global command-preset library:

- **New preset** asks for the name through a prompt.
- The preset list, working directory, command, mode and confirmation setting remain visible.
- Mandatory `requireShellPresetMatch` execution gating is retired.
- Per-tab command history remains supported.
- Legacy local-action preset normalization and matching helpers remain covered for migration compatibility.

This hotfix updates the historical test instead of restoring removed UI. No Native Host files are changed, so reinstalling the Native Host is not required.
