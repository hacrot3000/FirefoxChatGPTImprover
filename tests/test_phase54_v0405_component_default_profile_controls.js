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

assert(versionAtLeast(manifest.version, "0.40.5"));
assert(protocol.includes('SET_DEFAULT_COMPONENT_PROFILE: "FCI_SET_DEFAULT_COMPONENT_PROFILE"'));
for (const id of [
  "setDefaultRuleListProfileButton",
  "setDefaultMonitorProfileButton",
  "setDefaultTargetProfileButton",
  "setDefaultAlertProfileButton"
]) assert(html.includes('id="' + id + '"'), id);
assert(sidebar.includes('setSelectedComponentProfileAsDefault("rule-list")'));
assert(sidebar.includes('setSelectedComponentProfileAsDefault("monitor")'));
assert(sidebar.includes('setSelectedComponentProfileAsDefault("target")'));
assert(sidebar.includes('setSelectedComponentProfileAsDefault("alerts")'));
assert(sidebar.includes("Open tabs were not reassigned."));
assert(sidebar.includes("profile.id === spec.defaultId()"));
assert(background.includes("async function setDefaultComponentProfile(type, profileId)"));
assert(background.includes('store[spec.defaultKey] = profile.id'));
assert(background.includes('Choose another default ${spec.label} profile before deleting this one.'));
assert(!background.includes('if (store[spec.defaultKey] === profileId) store[spec.defaultKey] = store[spec.collectionKey][0].id'));
const setter = background.slice(background.indexOf("async function setDefaultComponentProfile"), background.indexOf("async function deleteComponentProfile"));
assert(!setter.includes("sessions.values"));
assert(!setter.includes("applySessionToContent"));
assert(!setter.includes("refreshSessionsForStore"));
console.log("PASS: Phase 54 explicit Rule-list/Monitor/Target/Alert defaults remain library-only and require deliberate reassignment before deletion");
