# Phase 69 v0.41.10 — ready alert visual clarity

## Scope

This is a bugfix/hardening continuation of Phase 65–68. No new feature is introduced.

## Runtime issue confirmed

The managed-download badge was already explicit, but normal matched/ready alert presentation still had independent legacy warning semantics:

- tab title could alternate `⚠ RD` and `RD`;
- toolbar alert badge used `!`;
- sidebar matched state used error color and pulse.

That made a normal READY state look like a download warning/error even when download state itself was `CK`, `DL`, `MV`, or complete.

## Fixed contract

- READY/matched: stable `RD`.
- Download checking: `CK`.
- Browser downloading: `DL`.
- Relocation: `MV`.
- Verified complete: `✓`.
- No download detected during capture: `NO`.
- Managed-download failure: `×`.
- Actual automation runtime error: `!`.

Legacy built-in `⚠ AI READY`, `AI READY`, `READY`, and `⚠ RD` values normalize to `RD`. Custom user prefixes are preserved. The normal RD frame does not create a meaningless title-blink interval.

## Versions

- Add-on: 0.41.10
- Alert Engine: 14
- Protocol: 26 (unchanged)
- Settings schema: 18 (unchanged)
- Native Host: 0.13.0 (unchanged)
