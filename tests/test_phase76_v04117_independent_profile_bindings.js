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
const settingsSource = read("extension/shared/settings.js");
const protocol = read("extension/shared/protocol.js");
const workingSource = read("extension/shared/working_session.js");
const bundleSource = read("extension/shared/configuration_bundle.js");
const background = read("extension/background/background.js");
const sidebar = read("extension/sidebar/sidebar.js");
const html = read("extension/sidebar/sidebar.html");

function versionAtLeast(actual, minimum) {
  const a = String(actual).split(".").map(Number);
  const b = String(minimum).split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff) return diff > 0;
  }
  return true;
}

assert(versionAtLeast(manifest.version, "0.41.17"), "Phase 76 requires add-on version >= 0.41.17");

const sandbox = { console, Date, JSON, Math, URL, Uint32Array, crypto: crypto.webcrypto, globalThis: null };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(settingsSource, sandbox, { filename: "settings.js" });
vm.runInContext(workingSource, sandbox, { filename: "working_session.js" });
const Settings = sandbox.FCI_SETTINGS;
const Working = sandbox.FCI_WORKING_SESSION;

assert(Settings.SCHEMA_VERSION >= 19);
assert(Working.VERSION >= 5);

const store = Settings.defaultStore();
for (const [collection, defaultKey] of [
  ["ruleListProfiles", "defaultRuleListProfileId"],
  ["monitorProfiles", "defaultMonitorProfileId"],
  ["targetProfiles", "defaultTargetProfileId"],
  ["alertProfiles", "defaultAlertProfileId"]
]) {
  assert(Array.isArray(store[collection]) && store[collection].length > 0, collection);
  assert.equal(store[defaultKey], store[collection][0].id, defaultKey);
}

for (const type of ["configuration", "rule-list", "monitor", "target", "alerts", "local-action"]) {
  const parsed = Settings.parseProfileBundle(JSON.stringify(Settings.buildProfileBundle(type, [])), type);
  assert.equal(parsed.profileType, type);
}

const baseConfig = Settings.defaultConfig();
const working = Working.parse(Working.stringify(Working.build([{
  sourceTabId: 76,
  url: "https://chat.example.test/thread/76",
  title: "Independent profiles",
  addOnActive: true,
  mode: "active",
  profileId: store.defaultProfileId,
  profile: store.profiles[0],
  configMode: "profile",
  effectiveConfig: baseConfig,
  componentBaseConfig: baseConfig,
  componentBindings: {
    schema: 1,
    ruleListProfileId: store.defaultRuleListProfileId,
    alertProfileId: store.defaultAlertProfileId,
    rules: {
      [baseConfig.rules[0].id]: {
        monitorProfileId: store.defaultMonitorProfileId,
        targetProfileId: store.defaultTargetProfileId
      }
    }
  }
}], { extensionVersion: manifest.version })));
assert.equal(working.tabs[0].componentBindings.ruleListProfileId, store.defaultRuleListProfileId);
assert.equal(working.tabs[0].componentBindings.alertProfileId, store.defaultAlertProfileId);
assert.equal(
  working.tabs[0].componentBindings.rules[baseConfig.rules[0].id].targetProfileId,
  store.defaultTargetProfileId
);

for (const token of [
  'ASSIGN_COMPONENT_PROFILE: "FCI_ASSIGN_COMPONENT_PROFILE"',
  'CLEAR_COMPONENT_PROFILE_BINDING: "FCI_CLEAR_COMPONENT_PROFILE_BINDING"'
]) assert(protocol.includes(token), token);

for (const id of [
  "ruleListProfileSelect", "applyRuleListProfileButton", "clearRuleListProfileBindingButton",
  "monitorProfileSelect", "applyMonitorProfileButton", "clearMonitorProfileBindingButton",
  "targetProfileSelect", "applyTargetProfileButton", "clearTargetProfileBindingButton",
  "alertProfileSelect", "applyAlertProfileButton", "clearAlertProfileBindingButton",
  "newRuleListProfileButton", "saveRuleListProfileButton",
  "newMonitorProfileButton", "saveMonitorProfileButton",
  "newTargetProfileButton", "saveTargetProfileButton",
  "newAlertProfileButton", "saveAlertProfileButton"
]) assert(html.includes('id="' + id + '"'), id);

assert(html.includes("Automation profiles own only URL routing"));
assert(html.includes("Local-action profiles own only managed-download and shell-command settings."));
assert(html.includes("Apply to tab / selected rule"));

for (const token of [
  "const ruleListProfileEditorSelectionByTab = new Map()",
  "const alertProfileEditorSelectionByTab = new Map()",
  "const monitorProfileEditorSelectionByRule = new Map()",
  "const targetProfileEditorSelectionByRule = new Map()",
  "function rememberComponentEditorSelection(type, profileId)",
  "function componentEditorSpec(type)",
  "async function applySelectedComponentProfile(type)",
  "async function clearSelectedComponentProfileBinding(type)",
  "MESSAGE.ASSIGN_COMPONENT_PROFILE",
  "MESSAGE.CLEAR_COMPONENT_PROFILE_BINDING",
  "function writeAutomationEditorConfig(config)",
  "function readPreviewConfig()"
]) assert(sidebar.includes(token), token);

const targetApplyStart = sidebar.indexOf('elements.applyTargetProfileButton.addEventListener');
const targetApplyEnd = sidebar.indexOf('elements.clearTargetProfileBindingButton.addEventListener', targetApplyStart);
assert(targetApplyStart >= 0 && targetApplyEnd > targetApplyStart);
assert(!sidebar.slice(targetApplyStart, targetApplyEnd).includes("saveProfileConfiguration"),
  "Target Apply must not save or rewrite the Automation profile");

for (const token of [
  'TAB_COMPONENT_BINDINGS_KEY = "firefoxChatImprover.componentBindings.v1"',
  "function normalizeComponentBindings(raw)",
  "async function assignComponentProfile(tabId, type, profileId, ruleId = null)",
  "async function clearComponentProfileBinding(tabId, type, ruleId = null)",
  "ruleListProfileId",
  "monitorProfileId",
  "targetProfileId",
  "alertProfileId",
  "componentBaseConfig",
  "replaceStoppedTabComponentBindings",
  "reconcileComponentBindingsForStore",
  "componentBindings: session?.componentBindings || await loadTabComponentBindings(tab.id)",
  "session.componentBindings = normalizeComponentBindings(savedTab.componentBindings)"
]) assert(background.includes(token), token);

const createProfileStart = background.indexOf("async function createProfile(name");
const saveProfileStart = background.indexOf("async function saveProfile(rawProfile)", createProfileStart);
const defaultProfileStart = background.indexOf("async function setDefaultProfile", saveProfileStart);
assert(createProfileStart >= 0 && saveProfileStart > createProfileStart && defaultProfileStart > saveProfileStart);
const createProfileBody = background.slice(createProfileStart, saveProfileStart);
const saveProfileBody = background.slice(saveProfileStart, defaultProfileStart);
assert(createProfileBody.includes("activation: Settings.clone(validation.config.activation)"));
assert(saveProfileBody.includes("activation: Settings.clone(validation.config.activation)"));
assert(!createProfileBody.includes("rules: Settings.clone(validation.config.rules)"));
assert(!saveProfileBody.includes("rules: Settings.clone(validation.config.rules)"));

assert(bundleSource.includes("ruleListProfiles: store.ruleListProfiles.map"));
assert(bundleSource.includes("alertProfiles: store.alertProfiles.map"));
assert(bundleSource.includes("defaultRuleListProfileId"));
assert(bundleSource.includes("defaultAlertProfileId"));

console.log("PASS: Phase 76 independent Automation, Rule-list, Monitor, Target, Alert and Local-action profile ownership with per-tab/per-rule bindings and session continuity");
