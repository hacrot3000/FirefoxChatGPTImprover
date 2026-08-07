#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const manifest = JSON.parse(read("extension/manifest.json"));
const background = read("extension/background/background.js");
const sidebar = read("extension/sidebar/sidebar.js");
function versionAtLeast(actual, minimum) {
  const a = String(actual).split(".").map(Number), b = String(minimum).split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const av = a[i] || 0, bv = b[i] || 0;
    if (av !== bv) return av > bv;
  }
  return true;
}
assert(versionAtLeast(manifest.version, "0.41.0"));
assert(background.includes('case MESSAGE.IMPORT_SETTINGS: {\n          const result = await importSettings(message.text);\n          return { ok: true, ...result, dashboard: await dashboard() };'));
assert(background.includes('case MESSAGE.RESTORE_SETTINGS_SNAPSHOT: {\n          const result = await restoreSettingsSnapshot(message.snapshotId);\n          return { ok: true, ...result, dashboard: await dashboard() };'));
assert(background.includes('return { ...result, scope: "all-configuration" };'));
assert(background.includes('return { store: saved, preservation, scope: "legacy-automation-only" };'));
assert(sidebar.includes('if (response.scope === "all-configuration")'));
assert(sidebar.includes('Reloading the sidebar to apply imported UI, preset and template preferences'));
assert(sidebar.includes('Reloading the sidebar to apply restored UI, preset and template preferences'));
assert(sidebar.includes('response.automationPreservation?.preservedActiveTabs'));
assert(sidebar.includes('response.localActionPreservation?.preservedStoppedTabs'));
console.log("PASS: Phase 59 import/restore returns configuration scope and preservation reports so full bundles reload sidebar preferences instead of being misclassified as legacy");
