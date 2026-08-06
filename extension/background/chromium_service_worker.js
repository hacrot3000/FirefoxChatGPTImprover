"use strict";

// Chromium Manifest V3 accepts one background service worker. Keep this list in
// the same order as extension/manifest.json background.scripts for Firefox.
importScripts(
  "../shared/browser_compat.js",
  "../shared/protocol.js",
  "../shared/settings.js",
  "../shared/alert_sound.js",
  "../shared/local_actions.js",
  "../shared/settings_snapshots.js",
  "../shared/working_session.js",
  "../shared/recovery.js",
  "../shared/support_bundle.js",
  "../shared/prompt_templates.js",
  "background.js"
);
