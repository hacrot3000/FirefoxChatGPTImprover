"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const background = read("extension/background/background.js");
const sidebar = read("extension/sidebar/sidebar.js");
const manifest = JSON.parse(read("extension/manifest.json"));

function versionAtLeast(actual, minimum) {
  const a = String(actual).split(".").map(Number);
  const b = String(minimum).split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff) return diff > 0;
  }
  return true;
}
function functionBody(name, nextName) {
  const start = background.indexOf(`async function ${name}`);
  const end = background.indexOf(`\n  async function ${nextName}`, start);
  assert(start >= 0 && end > start, `${name} block`);
  return background.slice(start, end);
}

assert(versionAtLeast(manifest.version, "0.40.8"));
assert(background.includes('async function refreshSessionsForStore(previousStore, saved, reason = "configuration replacement")'));
const refreshStart = background.indexOf("async function refreshSessionsForStore(previousStore, saved");
const refreshEnd = background.indexOf("\n  async function importSettings", refreshStart);
assert(refreshStart >= 0 && refreshEnd > refreshStart);
const refresh = background.slice(refreshStart, refreshEnd);
assert(refresh.includes("sessionConfig(session, previousStore)"));
assert(refresh.includes("session.configMode = CONFIG_MODE.TAB"));
assert(refresh.includes("session.tabConfig = previousEffective"));
assert(refresh.includes("loadStoppedTabConfigSnapshot(tab.id)"));
assert(refresh.includes("saveStoppedTabConfigSnapshot(tab.id"));
assert(refresh.includes("tabConfig: snapshot.effectiveConfig"));
assert(refresh.includes("replacementAutomationProfile(saved"));
assert(!refresh.includes("applySessionToContent("), "configuration library replacement must not reconfigure a running tab");

const imported = functionBody("importSettings", "restoreSettingsSnapshot");
assert(imported.includes('replaceFullConfigurationBundle(importedBundle, "Full configuration import")'));
assert(imported.includes('createSettingsSnapshot("before_full_configuration_import"'));
assert(imported.includes('refreshSessionsForStore(current, saved, "Legacy Automation configuration import")'));
assert(imported.includes('createSettingsSnapshot("before_settings_import"'));
const restoredStart = background.indexOf("async function restoreSettingsSnapshot");
const restoredEnd = background.indexOf("\n  function supportNativeState", restoredStart);
assert(restoredStart >= 0 && restoredEnd > restoredStart);
const restored = background.slice(restoredStart, restoredEnd);
assert(restored.includes('replaceFullConfigurationBundle(snapshot.configurationBundle, "Full recovery snapshot restore")'));
assert(restored.includes('refreshSessionsForStore(current, saved, "Legacy Automation recovery snapshot restore")'));
assert(restored.includes('createSettingsSnapshot("before_snapshot_restore"'));

assert(sidebar.includes("Existing open/stopped tabs kept their current Automation and Local action values where imported profiles differed"));
assert(sidebar.includes("Existing open/stopped tabs kept their current Automation and Local action values where restored profiles differed"));
console.log("PASS: Phase 57 configuration import and recovery restore preserve active/stopped tab values instead of falling back to changed defaults");
