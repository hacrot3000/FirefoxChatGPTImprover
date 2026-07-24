# Phase 24 v0.24.2 — Capture-aware target click and content timer hotfix

The activity log showed that the target action completed as `dry-run:1`, with `clickedCount: 0`. Managed download capture is armed only immediately before a real target click, so the download pipeline never started. When the saved local-action configuration has managed capture enabled, an armed capture now overrides dry-run for that single target action. If capture is disabled, dry-run remains unchanged and the runtime explains why no real click occurred.

The same log repeatedly reported `setTimeout called on an object that does not implement interface Window`. Native browser timers are now called through lexical timer globals, while injected test clocks retain explicit receiver binding. The content runtime version is bumped so already-open tabs replace the faulty controller after extension reload.
