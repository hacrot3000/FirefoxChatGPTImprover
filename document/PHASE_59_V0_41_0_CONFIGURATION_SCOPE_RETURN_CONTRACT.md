# Phase 59 v0.41.0 — Configuration scope return contract

Full configuration import/restore already produced a scope and preservation report internally, but the message dispatcher discarded that result and returned only a dashboard. The sidebar therefore misclassified full bundles as legacy Automation-only operations. Phase 59 preserves the result across the message boundary, reloads only the sidebar for `all-configuration`, and keeps legacy behavior unchanged.
