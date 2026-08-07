"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const background = read("extension/background/background.js");
const html = read("extension/sidebar/sidebar.html");
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
assert(versionAtLeast(manifest.version, "0.40.7"));
assert(background.includes("function exactWorkingSessionAutomationProfile"));
assert(background.includes("function workingSessionAutomationRestorePlan"));
assert(background.includes("function exactWorkingSessionLocalActionProfile"));
assert(background.includes("function workingSessionLocalActionRestorePlan"));
assert(background.includes('\"session-snapshot\"'));
assert(background.includes('configMode: CONFIG_MODE.TAB'));
assert(!background.includes("function mergeWorkingSessionProfiles"));
assert(!background.includes("function mergeWorkingSessionLocalActionProfiles"));
assert(!background.includes('createSettingsSnapshot("before_working_session_import"'));

const start = background.indexOf("async function importWorkingSession(text)");
const end = background.indexOf("\n  function shortcutAction", start);
assert(start >= 0 && end > start);
const body = background.slice(start, end);
for (const forbidden of ["saveStore(", "saveLocalActionStore(", "mergeWorkingSessionProfiles", "mergeWorkingSessionLocalActionProfiles", "createSettingsSnapshot("]) {
  assert(!body.includes(forbidden), `working-session restore must not mutate global profile/config storage: ${forbidden}`);
}
assert(body.includes("workingSessionAutomationRestorePlan(store, savedTab)"));
assert(body.includes("workingSessionLocalActionRestorePlan(localStore, savedTab)"));
assert(body.includes("session.configMode = automationPlan.configMode"));
assert(body.includes("session.localActionConfigMode = localActionPlan.configMode"));
assert(html.includes("Restore recreates each tab from its saved effective configuration without creating or changing global profiles."));
console.log("PASS: Phase 56 working-session restore is isolated from global profile libraries and falls back to tab snapshots");
