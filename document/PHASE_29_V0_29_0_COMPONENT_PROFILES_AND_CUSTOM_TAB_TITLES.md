# Phase 29 v0.29.0 — component profiles and persistent custom tab titles

## Scope

Phase 29 introduces reusable profile libraries for the two rule components that previously existed only inside a full configuration profile:

- **Monitor element profiles** store the complete monitor selector, conditions, visibility transition and stability timing.
- **New target element profiles** store the complete target selector, click strategy, dry-run state and action/verification pipeline.

A component profile can be created from the currently edited rule, applied to another rule, renamed, saved or deleted. Applying a component profile updates only that component and does not replace the other rule settings.

## Typed JSON import/export

The former **Save configuration** group is now **Import/export configuration**. It retains all save and working-session controls and adds separate JSON import/export rows for:

1. Configuration profiles;
2. Monitor profiles;
3. Target profiles;
4. Local action profiles.

Each exported file uses the format `firefox-chat-improver-profile-bundle` and includes a `profileType`. Import rejects a file whose type does not match the selected row. Profiles are merged by ID, and the exported default profile is restored when that ID exists in the imported result. A recovery snapshot is created before destructive settings imports, component-profile saves and component-profile deletes.

## Persistent custom tab title

The **Tabs and sessions** group now provides a custom-title field for any normal HTTP/HTTPS tab.

- A saved custom title replaces the page title in Firefox's tab strip.
- AI states decorate that custom title, for example `[⚠ AI READY] Naruto server patch` or `⠋ Naruto server patch`.
- The original page title is retained separately and restored by **Use page title**.
- The custom title is stored per tab with `browser.sessions.setTabValue`.
- It is restored after reload, full navigation, background restart, add-on reload and working-session import.
- A page-side `MutationObserver` prevents single-page applications from overwriting the custom title.
- Site permission is requested from the explicit Save action when needed.

## Versions

- Extension: `0.29.0`
- Protocol: `19`
- Settings schema: `16`
- Content runtime: `27`
- Alert engine: `11`
- Native Host: unchanged at `0.13.0`

## Validation

The Phase 29 regression verifies:

- migration from schema 15 without losing legacy monitor or target selectors;
- component-profile creation and typed bundle round trips;
- rejection of cross-type JSON imports;
- custom title and original page title in working-session v3;
- custom-title use by both AI READY and Running title controllers;
- all Phase 04–29 regression contracts.
