# Phase 39 v0.39.0 — Full accessibility audit

## Scope

This phase audits and hardens the shared Firefox/Chromium sidebar and page element picker for keyboard focus, screen-reader announcements, contrast preferences and reduced motion.

## Implemented

- Keyboard-visible skip link to the main sidebar controls.
- Consistent `:focus-visible` treatment for controls, links, disclosures and generated group toggles.
- Status/alert live regions, `aria-busy` during requests and labelled/described dialogs.
- Unique accessible names for repeated profile import/export buttons.
- Reduced-motion, increased-contrast and forced-colour media-query support.
- Keyboard-only picker navigation using Tab/Shift+Tab, Enter/Space and Escape.
- Screen-reader picker instructions and focus restoration on cancellation.

## Compatibility

- Extension: 0.39.0
- Protocol: 25
- Native Host: 0.13.0
- Firefox and Chromium builds use the same accessible UI and picker behavior.

## Regression

`tests/test_phase39_v0390_accessibility_audit.js` validates the static accessibility contracts and executes a keyboard-only picker selection in a VM fixture. Phase 38 build tests derive the current manifest version so the Chromium port remains forward-compatible.
