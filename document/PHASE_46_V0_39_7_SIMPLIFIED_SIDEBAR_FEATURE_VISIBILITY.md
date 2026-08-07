# Phase 46 v0.39.7 — Simplified sidebar and feature visibility

## Result

The sidebar keeps the existing data models but presents them as two clear domains: Automation profiles and Local action profiles. Controls are ordered by workflow and save/import actions are colocated with the data they affect.

## Layout presets

- **Simple:** core rule, monitor, target and alert controls.
- **Standard:** common automation, Local action, working-session and backup controls.
- **All features:** every group.
- **Custom:** individual feature selection.

Tabs and runtime is permanently visible. Layout preferences are stored separately from configuration profiles. Hiding a feature never deletes data or changes running automation. Dependencies are enforced so dependent editors cannot be shown without their parent profile/editor controls.
