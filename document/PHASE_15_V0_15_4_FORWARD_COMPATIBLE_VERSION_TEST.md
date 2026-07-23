# Phase 15 v0.15.4 — Forward-compatible feature version contract

## Problem

`tests/test_phase15_v0152_english_title_help.js` validated the English UI and title/help behavior correctly, but also required the manifest version to equal exactly `0.15.2`. Any later valid hotfix therefore failed this historical feature test after all earlier tests had passed.

## Fix

- The historical Phase 15 v0.15.2 test now requires semantic version `>= 0.15.2`.
- The comparison handles patch, minor, and major version increments instead of matching a literal string.
- The add-on version is advanced to `0.15.4`.
- The aggregate test summary identifies the forward-compatible version-contract check.

## Compatibility

No runtime behavior, profile schema, permissions, monitor state, or Native Messaging behavior changes in this hotfix.
