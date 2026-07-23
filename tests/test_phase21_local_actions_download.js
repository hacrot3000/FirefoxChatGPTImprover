#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const root = path.resolve(__dirname, "..");
const context = vm.createContext({ console, URL, Date, JSON, RegExp, crypto: webcrypto });
context.globalThis = context;
for (const file of ["extension/shared/settings.js", "extension/shared/local_actions.js", "extension/shared/working_session.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
}
const Local = context.FCI_LOCAL_ACTIONS;
const Working = context.FCI_WORKING_SESSION;
assert.equal(Local.SCHEMA_VERSION, 1);
const shared = Local.createProfile("Shared", {
  routing: { enabled: true, priority: 5, urlPatterns: ["https://ai.example.test/*"] },
  download: { enabled: true, destinationDirectory: "/tmp/result", captureWindowSeconds: 30, conflictAction: "uniquify", showCompletionDialog: true },
  shell: { workingDirectory: "/tmp", command: "echo done", mode: "background", confirmBeforeRun: false }
}, "local-shared");
const other = Local.createProfile("Other", { routing: { enabled: true, priority: 1, urlPatterns: ["https://*/*"] } }, "local-other");
const store = Local.normalizeStore({ schemaVersion: 1, revision: 1, defaultProfileId: other.id, profiles: [other, shared] });
assert.equal(Local.routeProfile(store, "https://ai.example.test/chat").profileId, shared.id);
assert(Local.validateConfig(shared.config).ok);
assert.equal(Local.validateConfig({ download: { enabled: true, destinationDirectory: "relative" } }).ok, false);

const automationProfile = context.FCI_SETTINGS.defaultStore().profiles[0];
const bundle = Working.build([{
  sourceTabId: 9, url: "https://ai.example.test/chat", title: "Chat", addOnActive: true, mode: "active",
  profileId: automationProfile.id, profile: automationProfile, configMode: "profile", effectiveConfig: automationProfile.config,
  localActionProfileId: shared.id, localActionProfile: shared, localActionConfigMode: "tab",
  localActionTabConfig: { ...shared.config, download: { ...shared.config.download, destinationDirectory: "/tmp/tab-specific" } },
  effectiveLocalActions: { ...shared.config, download: { ...shared.config.download, destinationDirectory: "/tmp/tab-specific" } }
}], { extensionVersion: "0.21.0" });
const parsed = Working.parse(Working.stringify(bundle));
assert.equal(parsed.version, 2);
assert.equal(parsed.tabs[0].localActionProfileId, shared.id);
assert.equal(parsed.tabs[0].localActionConfigMode, "tab");
assert.equal(parsed.tabs[0].effectiveLocalActions.download.destinationDirectory, "/tmp/tab-specific");

const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
for (const permission of ["downloads", "webRequest", "webRequestBlocking"]) assert(manifest.permissions.includes(permission));
assert(manifest.background.scripts.includes("shared/local_actions.js"));
const html = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
for (const id of ["localActionProfileSelect", "managedDownloadEnabled", "downloadDestinationDirectory", "downloadCompletionDialog"]) assert(html.includes(`id="${id}"`));
assert.equal((html.match(/id="downloadCompletionDialog"/g) || []).length, 1);
const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
for (const token of ["armDownloadCapture", "interceptDownloadResponse", "move_download", "sessionLocalActionConfig", "mergeWorkingSessionLocalActionProfiles"]) assert(background.includes(token));
const activation = fs.readFileSync(path.join(root, "extension/content/activation.js"), "utf8");
assert(activation.includes("onBeforeTargetClick"));
assert(activation.includes("ARM_DOWNLOAD_CAPTURE"));
const sidebar = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
for (const token of ["readLocalActionConfig", "writeLocalActionConfig", "SAVE_TAB_LOCAL_ACTIONS", "renderDownloadState"]) assert(sidebar.includes(token));
console.log("PASS: Phase 21 separate local-action profiles, URL/tab routing, working-session round-trip and managed-download contracts");
