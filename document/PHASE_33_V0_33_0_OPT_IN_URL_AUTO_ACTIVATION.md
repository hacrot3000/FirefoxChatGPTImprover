# Phase 33 v0.33.0 — Opt-in automatic activation for trusted URLs

## Scope

Phase 33 allows a configuration profile to automatically activate inactive HTTP/HTTPS tabs whose URL matches that profile's explicit allowlist. The feature is disabled by default and requires Firefox host permission granted from a direct user action in the sidebar.

## Safety model

- Automatic activation is per configuration profile and opt-in.
- URL routing, `Require the URL to match the allowlist`, and at least one explicit HTTP/HTTPS host pattern are mandatory.
- Universal host patterns are rejected for automatic activation.
- Firefox permission is requested only when the user presses **Grant auto-activation access**.
- Already-active or paused tabs never switch profile automatically.
- A tab/URL/profile signature prevents duplicate concurrent activation.
- The URL and routed profile are re-evaluated immediately before content scripts are injected.
- Startup, completed navigation, profile save, and manual scan use the same guarded decision path.

## User controls

The **URL activation** group now includes:

- **Automatically activate matching pages for this profile (opt-in)**
- **Grant auto-activation access**
- **Activate matching open tabs**
- A live result describing route eligibility, permission origins, and the most recent decision.

## Versions

- Add-on: 0.33.0
- Settings schema: 18
- Protocol: 22
- Native Host: unchanged at 0.13.0
