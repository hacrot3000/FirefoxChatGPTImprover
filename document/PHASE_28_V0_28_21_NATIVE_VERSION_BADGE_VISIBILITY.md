# Phase 28 v0.28.21 — Native Host version badge visibility

## Problem

The Shell command heading reused the generic `.native-status` width limit. Because the badge sits in a shrink-to-content flex container, `max-width: 55%` truncated values such as `Native 0.11.0` to `Native 0.`. The tooltip exposed only `lastSeenAt`, so hovering did not reveal the version.

## Resolution

- Add a dedicated `.native-host-status` class that displays the complete Native Host version.
- Keep the generic compact badge behavior unchanged for all other status indicators.
- Allow the Shell command heading to wrap only on extremely narrow sidebars.
- The tooltip and accessible label now include Native Host version, connection state, error information and last-check time.
- No Native Host source changed; reinstall is not required.
