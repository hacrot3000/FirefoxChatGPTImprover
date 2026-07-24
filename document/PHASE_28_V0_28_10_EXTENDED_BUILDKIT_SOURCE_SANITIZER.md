# Phase 28 v0.28.10 — Extended BuildKit source sanitizer

## Failure confirmed

The v0.28.9 sanitizer only matched a BuildKit line that ended immediately after the elapsed time:

```text
#10 51.98
```

The repository instead contained a valid BuildKit console variant with trailing text:

```text
#10 51.98 Configuring extension
```

That line remained in `extension/background/background.js` and caused `node --check` to fail.

## Repair

- Remove standalone timestamped BuildKit records even when descriptive text follows the elapsed time.
- Also recognize standalone `DONE`, `CACHED`, `ERROR`, and `[stage ...]` BuildKit records.
- Do not match normal JavaScript comments or strings that merely contain an issue number.
- Run `node --check` for every JavaScript file from inside the patch before returning success.
- Keep all Phase 28 v0.28.8 download-job, popup Execute, and shell behavior unchanged.

No Native Host source is changed by this patch.
