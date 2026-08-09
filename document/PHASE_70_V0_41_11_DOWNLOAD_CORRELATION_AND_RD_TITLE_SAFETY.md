# Phase 70 v0.41.11 — download correlation and RD title safety

## Scope

Bugfix/hardening continuation of Phase 65–69 only. No new feature is introduced.

## Fixed invariants

- `CK` becomes `DL` as soon as an intercepted response is positively identified as a download.
- Firefox download events are consumed only when their `downloadId` matches the current tab job.
- Native Host relocation responses are consumed only when their immutable `moveId` matches the current tab job.
- A transient `downloads.search()` failure after Firefox reports completion cannot leave the job stuck at `DL`; already captured filename metadata is used as fallback.
- A second managed target click is converted to a safe dry-run while the current job remains `DL` or `MV`.
- Plain page titles beginning with `RD` are preserved. Only bracketed add-on decoration such as `[RD] Project` is stripped.

## Runtime implementation versions

- Add-on: 0.41.11
- Alert Engine: 15
- Target Engine: 5
- Content runtime: 29
- Protocol: 26 (unchanged)
- Settings schema: 18 (unchanged)
- Native Host: 0.13.0 (unchanged)
