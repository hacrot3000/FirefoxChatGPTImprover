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
assert(html.includes('id="setDefaultMonitorProfileButton"'));
assert(html.includes('id="setDefaultTargetProfileButton"'));
assert(html.includes("To rename, edit Profile name and choose Save changes."));
assert(sidebar.includes('setSelectedComponentProfileAsDefault("monitor")'));
assert(sidebar.includes('setSelectedComponentProfileAsDefault("target")'));
assert(sidebar.includes("The current rule was not changed."));
assert(sidebar.includes("monitorProfile.id === dashboard.store.defaultMonitorProfileId"));
assert(sidebar.includes("targetProfile.id === dashboard.store.defaultTargetProfileId"));
assert(background.includes("async function setDefaultComponentProfile(type, profileId)"));
assert(background.includes('store[defaultKey] = profile.id'));
assert(background.includes('Choose another default ${type === "monitor" ? "Monitor" : "Target"} profile before deleting this one.'));
assert(!background.includes('if (store[defaultKey] === profileId) store[defaultKey] = store[collectionKey][0].id'));
const setter = background.slice(background.indexOf("async function setDefaultComponentProfile"), background.indexOf("async function deleteComponentProfile"));
assert(!setter.includes("sessions.values"));
assert(!setter.includes("applySessionToContent"));
assert(!setter.includes("refreshSessionsForStore"));
console.log("PASS: Phase 54 explicit Monitor/Target defaults preserve the current rule and require deliberate reassignment before deletion");
