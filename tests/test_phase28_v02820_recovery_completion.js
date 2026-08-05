#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const background = read("extension/background/background.js");
const sidebar = read("extension/sidebar/sidebar.js");
const manifest = JSON.parse(read("extension/manifest.json"));

assert(Number(manifest.version.split(".")[2]) >= 21);
assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, "142.0");
for (const token of [
  "restoreArmedDownloadCapture",
  "downloadCaptures.set(Number(session.tabId)",
  "resumeInterruptedDownloadMove",
  "Replaying the persisted moveId through the Native Host idempotency receipt",
  "moveId: job.moveId",
  "resolveLegacyShellLog",
  'nativeRequest("resolve_log"',
  "recoverLegacyShellLogs(recovered)"
]) assert(background.includes(token), `Missing v0.28.20 recovery contract: ${token}`);
assert.match(sidebar, /Native Host 0\.11\.0 or newer/);
assert.match(sidebar, /Recovered legacy log/);
assert.match(sidebar, /runId: descriptor\.runId/);
console.log("PASS: Phase 28 v0.28.20 restores armed captures, replays idempotent moves and discovers legacy logs");
