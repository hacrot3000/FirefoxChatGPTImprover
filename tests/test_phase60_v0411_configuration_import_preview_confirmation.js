#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const manifest = JSON.parse(read("extension/manifest.json"));
const protocol = read("extension/shared/protocol.js");
const background = read("extension/background/background.js");
const sidebar = read("extension/sidebar/sidebar.js");
function versionAtLeast(actual, minimum) {
  const a = String(actual).split(".").map(Number), b = String(minimum).split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const av = a[i] || 0, bv = b[i] || 0;
    if (av !== bv) return av > bv;
  }
  return true;
}
assert(versionAtLeast(manifest.version, "0.41.1"));
assert(protocol.includes('PREVIEW_SETTINGS_IMPORT: "FCI_PREVIEW_SETTINGS_IMPORT"'));
assert(background.includes("async function previewSettingsImport(text)"));
assert(background.includes("automationProfiles: bundle.automationStore.profiles.length"));
assert(background.includes("localActionProfiles: bundle.localActionStore.profiles.length"));
assert(background.includes("commandPresets: bundle.commandPresetStore.presets.length"));
assert(background.includes("customPromptTemplates: bundle.promptTemplateStore.customTemplates.length"));
assert(background.includes("case MESSAGE.PREVIEW_SETTINGS_IMPORT:"));
assert(sidebar.includes("MESSAGE.PREVIEW_SETTINGS_IMPORT, MESSAGE.IMPORT_SETTINGS"));
assert(sidebar.includes("A recovery snapshot will be created before import."));
const previewIndex = sidebar.indexOf("const previewResponse = await request(MESSAGE.PREVIEW_SETTINGS_IMPORT");
const confirmIndex = sidebar.indexOf("if (!confirm(`Import ${scopeText}?", previewIndex);
const importIndex = sidebar.indexOf("const response = await request(MESSAGE.IMPORT_SETTINGS", previewIndex);
assert(previewIndex >= 0 && confirmIndex > previewIndex && importIndex > confirmIndex, "preview and confirmation must happen before the mutating import request");
console.log("PASS: Phase 60 configuration import validates and previews scope/counts before explicit confirmation and mutation");
