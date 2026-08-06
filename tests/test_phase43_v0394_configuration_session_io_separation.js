#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const html = read("extension/sidebar/sidebar.html");
const sidebar = read("extension/sidebar/sidebar.js");
const background = read("extension/background/background.js");
const manifest = JSON.parse(read("extension/manifest.json"));

{
  const [major, minor, patch] = manifest.version.split(".").map(Number);
  assert(
    major > 0 || minor > 39 || (minor === 39 && patch >= 4),
    `Phase 43 contract requires version >= 0.39.4, got ${manifest.version}`
  );
}

function section(groupId) {
  const start = html.indexOf(`<section class="card" data-group-id="${groupId}"`);
  assert(start >= 0, `missing ${groupId} section`);
  const end = html.indexOf("</section>", start);
  assert(end > start, `unterminated ${groupId} section`);
  return html.slice(start, end + "</section>".length);
}

const sessions = section("working-sessions");
const configuration = section("save");

for (const id of [
  "newWorkingSessionEntryButton",
  "updateWorkingSessionEntryButton",
  "restoreWorkingSessionEntryButton",
  "exportWorkingSessionEntryButton",
  "importWorkingSessionEntryButton",
  "exportWorkingSessionCatalogButton",
  "importWorkingSessionCatalogButton"
]) {
  assert(sessions.includes(`id="${id}"`), `${id} must remain in Saved working sessions`);
  assert(!configuration.includes(`id="${id}"`), `${id} leaked into configuration section`);
}

for (const legacyId of ["saveWorkingSessionButton", "importWorkingSessionButton", "importWorkingSessionFile"]) {
  assert(!html.includes(`id="${legacyId}"`), `${legacyId} legacy duplicate remains in HTML`);
  assert(!sidebar.includes(`${legacyId}:`), `${legacyId} legacy element mapping remains`);
  assert(!sidebar.includes(`elements.${legacyId}.addEventListener`), `${legacyId} legacy listener remains`);
}

assert(configuration.includes("Export all configuration"));
assert(configuration.includes("Import all configuration"));
assert(configuration.includes("Working-session data is managed separately"));
assert(!configuration.includes("Save working session"));
assert(!configuration.includes("Import working session"));
assert(sessions.includes("This section manages working-session data only"));

const sandbox = { console, Date, JSON, Math, URL, crypto: crypto.webcrypto, globalThis: null };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(read("extension/shared/settings.js"), sandbox);
const Settings = sandbox.FCI_SETTINGS;
const storeWithForeignSessionData = {
  ...Settings.defaultStore(),
  workingSessionCatalog: { format: "must-not-export", entries: [{ id: "session-1" }] }
};
const exportedConfiguration = JSON.parse(Settings.exportStore(storeWithForeignSessionData));
assert(!Object.prototype.hasOwnProperty.call(exportedConfiguration, "workingSessionCatalog"));

const importStart = background.indexOf("async function importSettings(text)");
const importEnd = background.indexOf("\n  async function restoreSettingsSnapshot", importStart);
assert(importStart >= 0 && importEnd > importStart);
const importSettingsBody = background.slice(importStart, importEnd);
assert(!importSettingsBody.includes("WorkingSession"));
assert(!importSettingsBody.includes("CATALOG_STORAGE_KEY"));

console.log("PASS: Phase 43 separates configuration import/export from saved working sessions");
