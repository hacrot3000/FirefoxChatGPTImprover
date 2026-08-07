# Phase 51 v0.40.2 — Component profile editor draft continuity

## Goal

Monitor and Target profile library operations must not reload the Automation form or discard the rule currently being edited.

## Behaviour

- **Save current as new** captures the current rule's Monitor or Target values, selects the created profile and preserves the complete Automation draft.
- **Save current values** updates the selected component profile without changing the selected rule or any unsaved rule fields.
- Deleting a component profile selects a valid fallback in the library while leaving the current rule draft untouched.
- Importing Monitor or Target profile bundles refreshes only the component-profile library; it does not reload the Automation form.
- Applying a component profile to a rule remains an explicit action through **Apply to rule**.

## Compatibility

Protocol remains 26 and Native Host remains 0.13.0.
