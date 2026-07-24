# Phase 28 v0.28.13 — Full regression and restart dashboard repair

## Failures repaired together

1. Phase 23 still asserted the obsolete strict `job.sessionToken === session.sessionToken` contract. Phase 28 v0.28.8 intentionally replaced that rule so a captured download survives same-tab navigation. The updated regression verifies `tabId + captureId`, immutable configuration, live-job precedence and session-token rebinding without cross-tab attribution.
2. Phase 25 still required content runtime 19 and an obsolete automatic-shell status sentence. Runtime 20 and the current manual-fallback text are now accepted.
3. `tools/build_firefox_addon.sh` had regressed and no longer passed `--overwrite`, breaking repeatable same-version builds.
4. A fresh-background VM smoke test now loads every shared background dependency and proves that a valid sidebar `GET_DASHBOARD` request succeeds after browser restart.
5. The complete terminal-contamination repair and project-wide syntax audit are retained, so the patch is safe even if applied to a tree that still contains the leaked transcript.
6. `web-ext` is health-checked before release use; an incomplete local installation produces an actionable setup error.

## Dashboard diagnosis

The runtime guard reported installed extension version `0.28.10`. The source build stopped before a new artifact could be installed, so Firefox restarted with the older broken add-on. Build and reload version 0.28.13 so the clean background is active.

No Native Host source is changed.
