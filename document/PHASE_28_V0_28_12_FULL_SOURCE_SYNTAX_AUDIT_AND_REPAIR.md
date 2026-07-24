# Phase 28 v0.28.12 — Full source syntax audit and repair

## Root cause found in the current source archive

`extension/background/background.js` contained a complete terminal/build transcript inserted between `nativeDashboardState()` and `scheduleShellBroadcast()`. The contamination was not one isolated BuildKit line: it was a contiguous 127-line block containing Docker progress, PHP lint output, environment values, test summaries, paths, and shell status records.

## Repair

- Remove the entire non-code interstitial block in one operation using stable function anchors.
- Retain the existing Phase 28 download, per-tab shell, popup Execute, and console logic before and after the damaged region.
- Remove any remaining standalone numeric BuildKit progress lines from extension JavaScript.
- Add `tools/check_source_syntax.py` to audit every project JavaScript, Python, shell, JSON, and SVG source outside generated/vendor/patch directories.
- Run that audit inside the patch before the patch is allowed to report success.
- Add a Phase 28 v0.28.12 regression that runs `node --check` over the complete project JavaScript set and verifies the damaged region is clean.
- Supersede stale failed v0.28.9–v0.28.11 source-sanitizer packages so `--all` does not stop on an obsolete package after this repair succeeds.

## Validation against the supplied current source

After removing the full contaminated block:

- JavaScript syntax failures: 0
- Python syntax failures: 0
- Shell syntax failures: 0
- JSON parse failures: 0
- SVG parse failures: 0

No Native Host source is changed by this patch.
