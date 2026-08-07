#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const html = read("extension/sidebar/sidebar.html");
const sidebar = read("extension/sidebar/sidebar.js");
const css = read("extension/sidebar/sidebar.css");
const manifest = JSON.parse(read("extension/manifest.json"));

function section(groupId) {
  const marker = `data-group-id="${groupId}"`;
  const markerIndex = html.indexOf(marker);
  const start = html.lastIndexOf("<section", markerIndex);
  assert(markerIndex >= 0 && start >= 0, `Missing sidebar group: ${groupId}`);
  const end = html.indexOf("</section>", markerIndex);
  assert(end > start, `Unterminated sidebar group: ${groupId}`);
  return html.slice(start, end + "</section>".length);
}

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Missing function: ${signature}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Unclosed function: ${signature}`);
}

{
  const [major, minor, patch] = manifest.version.split(".").map(Number);
  assert(major > 0 || minor > 39 || (minor === 39 && patch >= 7), `Phase 46 requires version >= 0.39.7, got ${manifest.version}`);
}

for (const token of [
  'id="customizeSidebarButton"',
  'id="sidebarFeaturesDialog"',
  'id="sidebarFeaturePresetSelect"',
  'id="resetSidebarFeaturesButton"',
  "Hiding a feature hides only its sidebar controls",
  "Simple — core automation only",
  "Standard — common automation and local actions",
  "All features"
]) assert(html.includes(token), `Missing feature-visibility UI contract: ${token}`);

const featureIds = [
  "automation-editor", "automation-profiles", "automation-routing", "alerts",
  "local-action-profiles", "managed-downloads", "shell-commands", "working-sessions",
  "prompt-templates", "rule-diagnostics", "activity-log", "keyboard-shortcuts",
  "backup-recovery", "setup-guide"
];
for (const featureId of featureIds) {
  assert(html.includes(`data-sidebar-feature="${featureId}"`), `Missing feature checkbox: ${featureId}`);
}

const headings = new Map([
  ["tabs", "Tabs and runtime"],
  ["profiles", "Automation profiles"],
  ["activation", "Automation profile routing"],
  ["rules", "Rule list"],
  ["monitor", "Rule monitor"],
  ["target", "Rule target action"],
  ["rule-statistics", "Rule diagnostics"],
  ["local-actions", "Local action profiles"],
  ["download", "Local action: managed download"],
  ["shell", "Local action: shell command"],
  ["working-sessions", "Working session library"],
  ["activity", "Activity and support"],
  ["save", "Backup and transfer"],
  ["installation-guide", "Setup and installation"]
]);
for (const [groupId, heading] of headings) assert(section(groupId).includes(`>${heading}</h2>`), `${groupId} heading is still ambiguous`);

const profiles = section("profiles");
const backup = section("save");
const target = section("target");
for (const id of ["saveProfileButton", "saveTabButton", "resetTabButton"]) {
  assert(profiles.includes(`id="${id}"`), `${id} must be colocated with Automation profiles`);
  assert(!backup.includes(`id="${id}"`), `${id} must not remain in Backup and transfer`);
}
assert(target.includes('id="clearHighlightsButton"'), "Clear highlights belongs with rule target testing");
assert(!backup.includes('id="clearHighlightsButton"'), "Backup must not contain page-test controls");
assert(backup.includes("Export all configuration") && backup.includes("Import all configuration"));
assert(backup.includes("Working sessions, runtime logs and active jobs are excluded."));
assert(backup.includes("Recovery snapshot"));
assert(!backup.includes("Save working session"));

for (const token of [
  "const SIDEBAR_FEATURES = Object.freeze",
  "const SIDEBAR_FEATURE_PRESETS = Object.freeze",
  "featurePreset: sidebarFeaturePreset",
  "visibleFeatures: [...visibleSidebarFeatures]",
  "function normalizeSidebarFeatureSelection",
  "function applySidebarFeatureVisibility",
  "function organizeSidebarGroups",
  "section.hidden = !visibleGroups.has(section.dataset.groupId)",
  'visibleGroups = new Set(["tabs"])',
  "organizeSidebarGroups();",
  "setSidebarFeaturePreset(\"standard\")"
]) assert(sidebar.includes(token), `Missing feature-visibility implementation contract: ${token}`);

assert(css.includes("section.card[hidden] { display: none !important; }"));
assert(css.includes(".sidebar-features-dialog"));
assert(css.includes(".sidebar-feature-list"));

const constantsStart = sidebar.indexOf("  const SIDEBAR_FEATURES = Object.freeze");
const constantsEnd = sidebar.indexOf("  const $ =", constantsStart);
assert(constantsStart >= 0 && constantsEnd > constantsStart, "Cannot isolate feature constants");
const sandbox = { Object, Set, Array, globalThis: null };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(`${sidebar.slice(constantsStart, constantsEnd)}\nthis.FEATURES = SIDEBAR_FEATURES; this.PRESETS = SIDEBAR_FEATURE_PRESETS;`, sandbox);
vm.runInContext(`${extractFunction(sidebar, "function normalizeSidebarFeatureSelection")}\nthis.normalize = normalizeSidebarFeatureSelection;`, sandbox);

assert.deepEqual(Object.keys(sandbox.FEATURES).sort(), [...featureIds].sort(), "Feature registry must cover every published checkbox");
assert.equal(sandbox.PRESETS.simple.includes("automation-profiles"), false, "Simple mode must allow the default automation profile without profile-management clutter");
assert(sandbox.PRESETS.standard.includes("local-action-profiles"), "Standard mode must keep Local action profiles visible");
assert.equal(sandbox.PRESETS.full.length, featureIds.length, "All-features preset is incomplete");

const normalize = (features, changed = "", enabled = true) => Array.from(sandbox.normalize(features, changed, enabled));
assert(normalize(["shell-commands"]).includes("local-action-profiles"), "Shell commands require Local action profiles");
assert(normalize(["managed-downloads"]).includes("local-action-profiles"), "Managed downloads require Local action profiles");
assert(normalize(["automation-routing"]).includes("automation-profiles"), "Automation routing requires Automation profiles");
assert(normalize(["rule-diagnostics"]).includes("automation-editor"), "Rule diagnostics require the automation editor");
const withoutLocal = normalize(["local-action-profiles", "managed-downloads", "shell-commands"], "local-action-profiles", false);
assert(!withoutLocal.includes("managed-downloads") && !withoutLocal.includes("shell-commands"), "Disabling Local action profiles must hide dependent editors");

console.log("PASS: Phase 46 simplified sidebar names, coherent control placement and persistent Simple/Standard/All/Custom feature visibility");
