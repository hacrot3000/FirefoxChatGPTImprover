# Phase 24 v0.24.1 — No-dialog fallback download restart

The original fallback path observed downloads created by the page and then allowed the browser-owned download to continue. That path could still open Firefox's Save As dialog. The hotfix now cancels and erases the page-created download immediately, then restarts the same URL through `browser.downloads.download()` with `saveAs: false` into the extension staging directory before Native Host relocation.

The restart carries the referrer, cookie-store identity and private-window flag when Firefox exposes them. Extension-created downloads are identified through `byExtensionId` to avoid recapturing the restarted item.
