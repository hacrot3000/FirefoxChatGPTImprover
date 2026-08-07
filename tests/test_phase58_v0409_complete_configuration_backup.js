#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const manifest = JSON.parse(read("extension/manifest.json"));
const background = read("extension/background/background.js");
const sidebarHtml = read("extension/sidebar/sidebar.html");
const sidebar = read("extension/sidebar/sidebar.js");

function versionAtLeast(actual, minimum) {
  const a = actual.split(".").map(Number);
  const b = minimum.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (av !== bv) return av > bv;
  }
  return true;
}
assert(versionAtLeast(manifest.version, "0.40.9"));

const scripts = manifest.background.scripts;
for (const rel of [
  "shared/command_presets.js",
  "shared/local_actions.js",
  "shared/prompt_templates.js",
  "shared/configuration_bundle.js",
  "shared/settings_snapshots.js"
]) assert(scripts.includes(rel), `${rel} must load in the background`);
assert(scripts.indexOf("shared/configuration_bundle.js") < scripts.indexOf("shared/settings_snapshots.js"), "configuration bundle must load before snapshots");

const sandbox = { console, Date, JSON, Math, URL, Uint32Array, crypto: crypto.webcrypto, globalThis: null };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const rel of [
  "extension/shared/settings.js",
  "extension/shared/command_presets.js",
  "extension/shared/local_actions.js",
  "extension/shared/prompt_templates.js",
  "extension/shared/configuration_bundle.js",
  "extension/shared/settings_snapshots.js"
]) vm.runInContext(read(rel), sandbox, { filename: rel });

const Settings = sandbox.FCI_SETTINGS;
const LocalActions = sandbox.FCI_LOCAL_ACTIONS;
const CommandPresets = sandbox.FCI_COMMAND_PRESETS;
const PromptTemplates = sandbox.FCI_PROMPT_TEMPLATES;
const Bundle = sandbox.FCI_CONFIGURATION_BUNDLE;
const Snapshots = sandbox.FCI_SETTINGS_SNAPSHOTS;

const automationStore = Settings.defaultStore();
automationStore.profiles[0].name = "Automation backup profile";
const localActionStore = LocalActions.defaultStore();
localActionStore.profiles[0].name = "Local backup profile";
localActionStore.profiles[0].config.shell.command = "echo backup";
const commandPresetStore = CommandPresets.normalizeStore({ presets: [{ id: "preset-1", name: "Build", command: "make", workingDirectory: "/tmp" }] });
const promptTemplateStore = PromptTemplates.normalizeStore({ customTemplates: [{ id: "custom-one", name: "One", prompt: "Prompt one" }] });
const bundle = Bundle.build({
  automationStore,
  localActionStore,
  commandPresetStore,
  promptTemplateStore,
  sidebarPreferences: {
    featurePreset: "custom",
    visibleFeatures: ["automation-editor", "local-action-profiles"],
    collapsedGroups: { rules: true },
    autoProfileByUrl: false,
    tabProfileUi: { shouldNotBeExported: true },
    selectedWorkingSessionEntryId: "session-should-not-be-exported"
  },
  exportedAt: "2026-08-07T00:00:00.000Z"
});
assert.equal(bundle.format, "firefox-chat-improver-configuration");
assert.equal(bundle.version, 1);
assert.equal(bundle.automationStore.profiles[0].name, "Automation backup profile");
assert.equal(bundle.localActionStore.profiles[0].config.shell.command, "echo backup");
assert.equal(bundle.commandPresetStore.presets.length, 1);
assert.equal(bundle.promptTemplateStore.customTemplates.length, 1);
assert.equal(bundle.sidebarPreferences.featurePreset, "custom");
assert.equal(bundle.sidebarPreferences.autoProfileByUrl, false);
assert(!Object.hasOwn(bundle.sidebarPreferences, "tabProfileUi"));
assert(!Object.hasOwn(bundle.sidebarPreferences, "selectedWorkingSessionEntryId"));
const serialized = Bundle.stringify(bundle);
assert(!serialized.includes("workingSessionCatalog"));
assert(!serialized.includes("downloadJobs"));
assert(!serialized.includes("shellRuns"));

const fullSnapshot = Snapshots.makeSnapshot(automationStore, "manual", "Full", { configurationBundle: bundle, id: "full" });
const fullSummary = Snapshots.summary(fullSnapshot);
assert.equal(fullSummary.scope, "all-configuration");
assert.equal(fullSummary.localActionProfileCount, 1);
assert.equal(fullSummary.commandPresetCount, 1);
assert.equal(fullSummary.customPromptTemplateCount, 1);
const legacySummary = Snapshots.summary(Snapshots.makeSnapshot(automationStore, "legacy", "Legacy", { id: "legacy" }));
assert.equal(legacySummary.scope, "legacy-automation-only");

for (const marker of [
  "buildFullConfigurationBundle",
  "replaceFullConfigurationBundle",
  "refreshSessionsForLocalActionStore",
  "before_full_configuration_import",
  "legacy-automation-only",
  "ConfigurationBundle.stringify(bundle)"
]) assert(background.includes(marker), `background missing ${marker}`);
assert(background.includes("before_local_action_profile_save"));
assert(background.includes("before_local_action_profile_delete"));
assert(background.includes("before_local_action_default_change"));
assert(sidebarHtml.includes("Full configuration backup:"));
assert(sidebarHtml.includes("Working sessions, runtime logs and active jobs are excluded."));
assert(sidebar.includes("Full configuration imported."));
assert(sidebar.includes("Legacy Automation-only configuration imported."));
assert(sidebar.includes("Legacy Automation-only snapshot restored."));

console.log("PASS: Phase 58 complete configuration bundle, full recovery snapshots, legacy compatibility and active/stopped tab preservation contracts");
