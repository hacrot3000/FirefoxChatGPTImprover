#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const manifest = JSON.parse(read("extension/manifest.json"));
const background = read("extension/background/background.js");
function versionAtLeast(actual, minimum) {
  const a = String(actual).split(".").map(Number), b = String(minimum).split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const av = a[i] || 0, bv = b[i] || 0;
    if (av !== bv) return av > bv;
  }
  return true;
}
assert(versionAtLeast(manifest.version, "0.41.2"));
assert(background.includes("async function commitFullConfigurationBundle(bundle)"));
for (const key of [
  "[Settings.STORAGE_KEY]: savedAutomationStore",
  "[LocalActions.STORAGE_KEY]: savedLocalActionStore",
  "[CommandPresets.STORAGE_KEY]: savedCommandPresetStore",
  "[PromptTemplates.STORAGE_KEY]: savedPromptTemplateStore",
  "[ConfigurationBundle.SIDEBAR_UI_STORAGE_KEY]: savedSidebarPreferences"
]) assert(background.includes(key), `missing commit payload key: ${key}`);
const commitStart = background.indexOf("async function commitFullConfigurationBundle(bundle)");
const replaceStart = background.indexOf("async function replaceFullConfigurationBundle", commitStart);
const commit = background.slice(commitStart, replaceStart);
assert.equal((commit.match(/await browser\.storage\.local\.set\(nextPayload\)/g) || []).length, 1);
assert(commit.includes("await browser.storage.local.set(rollbackPayload)"));
assert(commit.indexOf("storePromise = Promise.resolve(savedAutomationStore)") > commit.indexOf("await browser.storage.local.set(nextPayload)"));
assert(commit.indexOf("localActionStorePromise = Promise.resolve(savedLocalActionStore)") > commit.indexOf("await browser.storage.local.set(nextPayload)"));
const replace = background.slice(replaceStart, background.indexOf("async function previewSettingsImport", replaceStart));
for (const legacyCall of [
  "await saveStore(normalized.automationStore)",
  "await saveLocalActionStore(normalized.localActionStore)",
  "saveCommandPresetStore(normalized.commandPresetStore)",
  "PromptTemplates.saveStore(browser, normalized.promptTemplateStore)",
  "saveSidebarPreferences(normalized.sidebarPreferences)"
]) assert(!replace.includes(legacyCall), `sequential full-replacement write survived: ${legacyCall}`);
assert(replace.includes("const committed = await commitFullConfigurationBundle(bundle)"));
assert(replace.includes("refreshSessionsForStore(committed.previousAutomationStore, committed.savedAutomationStore, reason)"));
assert(replace.includes("refreshSessionsForLocalActionStore(committed.previousLocalActionStore, committed.savedLocalActionStore, reason)"));
console.log("PASS: Phase 61 full configuration import/restore commits all five global stores together and rolls back on storage failure");
