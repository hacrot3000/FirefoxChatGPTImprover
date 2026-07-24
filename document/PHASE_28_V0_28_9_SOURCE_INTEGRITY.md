# Phase 28 v0.28.9 — BuildKit output source-integrity hotfix

## Failure

`extension/background/background.js` contained a standalone terminal-progress line such as:

```text
#10 51.98
```

That text is valid Docker BuildKit console output but invalid JavaScript, causing `node --check` to stop with `SyntaxError: Invalid or unexpected token`.

## Repair

- Scan every JavaScript file under `extension/`.
- Remove only standalone BuildKit timing records matching `#<step> <seconds>`.
- Preserve all application code, comments and Phase 28 v0.28.8 download/shell behavior.
- Add a regression that rejects leaked BuildKit records and runs `node --check` on every extension JavaScript file.

No Native Host source is changed by this patch.
