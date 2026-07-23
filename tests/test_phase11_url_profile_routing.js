#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const context = vm.createContext({ console, crypto: webcrypto, URL });
context.globalThis = context;
vm.runInContext(fs.readFileSync(path.join(root, "extension/shared/settings.js"), "utf8"), context, { filename: "settings.js" });
const Settings = context.FCI_SETTINGS;
assert(Settings.SCHEMA_VERSION >= 8);

function profile(id, name, patterns, priority = 0, enabled = true) {
  return {
    id, name,
    createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
    config: Settings.normalizeConfig({ activation: { requireUrlMatch: true, urlPatterns: patterns, routingEnabled: enabled, routingPriority: priority } })
  };
}
const store = Settings.normalizeStore({
  schemaVersion: 7, revision: 1, defaultProfileId: "default",
  profiles: [
    profile("default", "Default", [], 0, true),
    profile("broad", "Broad", ["https://ai.company.local/*"], 10, true),
    profile("specific", "Specific", ["https://ai.company.local/chat/*"], 10, true),
    profile("priority", "Priority", ["https://ai.company.local/*"], 20, true),
    profile("disabled", "Disabled", ["https://ai.company.local/chat/*"], 100, false)
  ]
});
let routed = Settings.routeProfile(store, "https://ai.company.local/chat/123");
assert.equal(routed.profileId, "priority");
assert.equal(routed.candidates.length, 3);
assert.equal(routed.candidates[0].priority, 20);
assert(!routed.candidates.some((item) => item.profileId === "disabled"));

const noPriority = Settings.normalizeStore({
  schemaVersion: 8, revision: 1, defaultProfileId: "default",
  profiles: [
    profile("default", "Default", [], 0, true),
    profile("broad", "Broad", ["https://ai.company.local/*"], 5, true),
    profile("specific", "Specific", ["https://ai.company.local/chat/*"], 5, true)
  ]
});
routed = Settings.routeProfile(noPriority, "https://ai.company.local/chat/123");
assert.equal(routed.profileId, "specific");
assert.equal(routed.candidates[0].bestPattern, "https://ai.company.local/chat/*");

routed = Settings.routeProfile(noPriority, "https://unmatched.example/");
assert.equal(routed.profileId, "default");
assert.equal(routed.matched, false);
assert.equal(routed.usedFallback, true);

const sidebar = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
for (const id of ["autoProfileByUrl", "routingEnabled", "routingPriority", "testUrlRoutingButton", "useRoutedProfileButton", "urlRoutingResult"]) {
  assert(sidebar.includes(`id="${id}"`), `missing sidebar routing control ${id}`);
}
const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
assert(background.includes("Settings.routeProfile(store, tab.url)"));
assert(background.includes("routingPreview"));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
assert(Number(manifest.version.split(".")[1]) >= 11);
console.log("PASS: Phase 11 URL profile routing priority, specificity, fallback and UI/background contract");
