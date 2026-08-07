"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
const sidebar = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
const protocol = fs.readFileSync(path.join(root, "extension/shared/protocol.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));

function versionAtLeast(actual, minimum) {
  const a = String(actual).split(".").map(Number);
  const b = String(minimum).split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff) return diff > 0;
  }
  return true;
}
assert(versionAtLeast(manifest.version, "0.40.4"));
assert(protocol.includes('SET_DEFAULT_PROFILE: "FCI_SET_DEFAULT_PROFILE"'));
assert(protocol.includes('SET_DEFAULT_LOCAL_ACTION_PROFILE: "FCI_SET_DEFAULT_LOCAL_ACTION_PROFILE"'));
assert(html.includes('id="setDefaultProfileButton"'));
assert(html.includes('id="setDefaultLocalActionProfileButton"'));
assert(sidebar.includes("setSelectedAutomationProfileAsDefault"));
assert(sidebar.includes("setSelectedLocalActionProfileAsDefault"));
assert(sidebar.includes("Open tabs were not changed."));
assert(sidebar.includes("automationProfile.id === dashboard.store.defaultProfileId"));
assert(sidebar.includes("profile.id === store.defaultProfileId"));
assert(background.includes("async function setDefaultProfile(profileId)"));
assert(background.includes("async function setDefaultLocalActionProfile(profileId)"));
assert(background.includes('store.defaultProfileId = profile.id'));
assert(background.includes('Choose another default Local action profile before deleting this one.'));

const autoFn = background.slice(background.indexOf("async function setDefaultProfile"), background.indexOf("async function deleteProfile"));
assert(!autoFn.includes("updateProfileSessions"));
assert(!autoFn.includes("refreshSessionsForStore"));
assert(!autoFn.includes("applySessionToContent"));
const localFn = background.slice(background.indexOf("async function setDefaultLocalActionProfile"), background.indexOf("async function deleteLocalActionProfile"));
assert(!localFn.includes("sessions.values"));
assert(!localFn.includes("persistSession"));
console.log("PASS: Phase 53 explicit Automation and Local action defaults never mutate open tabs and default profiles require explicit reassignment before deletion");
