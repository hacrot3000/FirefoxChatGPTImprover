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
for (const rel of ["extension/shared/protocol.js", "extension/shared/settings.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, rel), "utf8"), context, { filename: rel });
}
const Settings = context.FCI_SETTINGS;
const Protocol = context.FCI_PROTOCOL;
assert.equal(Settings.SCHEMA_VERSION, 18);
assert(Protocol.VERSION >= 22);
assert.equal(Settings.defaultConfig().activation.autoActivate, false);
function profile(id, name, patterns, priority, autoActivate = true) {
  return Settings.createProfile(name, Settings.normalizeConfig({ activation: {
    routingEnabled: true, routingPriority: priority, requireUrlMatch: true, urlPatterns: patterns, autoActivate
  }}), id);
}
const store = Settings.normalizeStore({
  schemaVersion: 18, revision: 1, defaultProfileId: "default",
  profiles: [
    profile("default", "Default", [], 0, false),
    profile("broad", "Broad", ["https://ai.example.test/*"], 10, true),
    profile("specific", "Specific", ["https://ai.example.test/chat/*"], 10, true),
    profile("manual", "Manual", ["https://ai.example.test/chat/*"], 99, false)
  ]
});
let routed = Settings.routeAutoActivation(store, "https://ai.example.test/chat/42");
assert.equal(routed.profileId, "specific", "Auto routing must ignore manual-only profiles and prefer specificity.");
assert.equal(routed.candidates.length, 2);
assert.deepEqual(JSON.parse(JSON.stringify(Settings.autoActivationPermissionOrigins(routed.profile.config))), ["https://ai.example.test/*"]);
assert.equal(Settings.routeAutoActivation(store, "https://other.example.test/").matched, false);
assert.equal(Settings.trustedAutoActivationPattern("https://*/*"), null);
assert(Settings.trustedAutoActivationPattern("https://*.example.test/chat/*"));
let validation = Settings.validateConfig({ activation: { autoActivate: true, routingEnabled: true, requireUrlMatch: false, urlPatterns: ["https://ai.example.test/*"] } });
assert.equal(validation.ok, false);
assert(validation.errors.some((error) => error.includes("Require the URL")));
validation = Settings.validateConfig({ activation: { autoActivate: true, routingEnabled: true, requireUrlMatch: true, urlPatterns: ["*"] } });
assert.equal(validation.ok, false);
const html = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
const sidebar = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
for (const id of ["autoActivateMatchingUrls", "grantAutoActivationAccessButton", "runAutoActivationScanButton", "autoActivationResult"]) {
  assert(html.includes(`id="${id}"`), `missing ${id}`);
}
assert.match(sidebar, /browser\.permissions\.request\(\{ origins: preview\.origins \}\)/);
assert.match(sidebar, /RUN_AUTO_ACTIVATION_SCAN/);
assert.match(background, /async function attemptAutoActivation/);
assert.match(background, /Settings\.routeAutoActivation/);
assert.match(background, /source === "url-auto"/);
assert.match(background, /tab-already-active/);
assert.match(background, /scanAutoActivationTabs\("background-startup"\)/);
assert.match(background, /onlyTabId !== null && onlyTabId !== undefined/);
assert.match(background, /changeInfo\.status === "complete"/);
console.log("PASS: Phase 33 opt-in trusted URL auto-activation, permission gate, priority and per-tab safety");
