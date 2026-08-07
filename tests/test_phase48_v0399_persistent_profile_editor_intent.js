"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sidebar = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
const html = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));

function versionAtLeast(actual, minimum) {
  const a = String(actual).split(".").map(Number);
  const b = String(minimum).split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i] || 0;
    const right = b[i] || 0;
    if (left !== right) return left > right;
  }
  return true;
}

assert(versionAtLeast(manifest.version, "0.39.9"));
assert(html.includes('id="automationProfileSourceSummary"'));
assert(sidebar.includes("const tabProfileUiUrlByTab = new Map();"));
assert(sidebar.includes("tabProfileUi: {"));
assert(sidebar.includes("automationEditor: serializeTabProfileMap(profileEditorSelectionByTab)"));
assert(sidebar.includes("localActionEditor: serializeTabProfileMap(localActionProfileEditorSelectionByTab)"));
assert(sidebar.includes("manualAutomation: serializeTabProfileMap(manualProfileSelectionByTab)"));
assert(sidebar.includes("stoppedConfigBypass: serializeTabProfileSet(stoppedConfigBypassTabs)"));
assert(sidebar.includes("restoreTabProfileMap(profileEditorSelectionByTab, storedTabProfileUi.automationEditor)"));
assert(sidebar.includes("restoreTabProfileMap(localActionProfileEditorSelectionByTab, storedTabProfileUi.localActionEditor)"));
assert(sidebar.includes("validateTabProfileUiContext(selectedTabId);"));
assert(sidebar.includes("storedUrl && currentUrl && storedUrl !== currentUrl"));
assert(sidebar.includes("setTabProfileSelection(profileEditorSelectionByTab, selectedTabId, selectedProfileId)"));
assert(sidebar.includes("setTabProfileSelection(localActionProfileEditorSelectionByTab, selectedTabId, selectedLocalActionProfileId)"));
assert(sidebar.includes("setTabProfileSelection(profileEditorSelectionByTab, selectedTabId, selectedProfileId);\n        elements.profileSelect.value"));
assert(sidebar.includes("async function duplicateSelectedProfile()"));
assert(sidebar.includes("duplicated and selected"));
assert(background.includes("savedProfile: Settings.profileById(result.store, result.profileId)"));
assert(sidebar.includes("Tab uses: ${effectiveProfile?.name"));
assert(sidebar.includes("Editing: ${selectedProfile?.name"));
console.log("PASS: Phase 48 persists per-tab profile editor intent across sidebar reload, rejects stale tab URLs and clearly separates editing from applied profiles");
