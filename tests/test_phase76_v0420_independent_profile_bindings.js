#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const manifest = JSON.parse(read("extension/manifest.json"));
const html = read("extension/sidebar/sidebar.html");
const sidebar = read("extension/sidebar/sidebar.js");
const background = read("extension/background/background.js");
const protocol = read("extension/shared/protocol.js");
const working = read("extension/shared/working_session.js");

assert.ok(
  manifest.version.localeCompare("0.42.0", undefined, { numeric: true }) >= 0,
  `Phase 76 requires add-on version >= 0.42.0, got ${manifest.version}`
);

for (const id of [
  "ruleListProfileSelect", "applyRuleListProfileButton", "clearRuleListProfileBindingButton",
  "monitorProfileSelect", "applyMonitorProfileButton", "clearMonitorProfileBindingButton",
  "targetProfileSelect", "applyTargetProfileButton", "clearTargetProfileBindingButton",
  "alertProfileSelect", "applyAlertProfileButton", "clearAlertProfileBindingButton",
  "localActionProfileSelect"
]) assert(html.includes(`id="${id}"`), `missing independent profile control: ${id}`);

assert(html.includes("Automation profiles own only URL routing"));
assert(html.includes("Local-action profiles own only managed-download and shell-command settings"));
assert(html.includes("Apply to tab / selected rule"));
assert(html.includes("Rule-list profiles"));
assert(html.includes("Alert profiles"));

assert(protocol.includes('ASSIGN_COMPONENT_PROFILE: "FCI_ASSIGN_COMPONENT_PROFILE"'));
assert(protocol.includes('CLEAR_COMPONENT_PROFILE_BINDING: "FCI_CLEAR_COMPONENT_PROFILE_BINDING"'));

for (const marker of [
  'TAB_COMPONENT_BINDINGS_KEY = "firefoxChatImprover.componentBindings.v1"',
  "function normalizeComponentBindings(raw)",
  "function sessionConfig(session, store)",
  "async function assignComponentProfile(tabId, type, profileId, ruleId = null)",
  "async function clearComponentProfileBinding(tabId, type, ruleId = null)",
  "async function replaceStoppedTabComponentBindings",
  "async function reconcileComponentBindingsForStore"
]) assert(background.includes(marker), `background missing independent binding contract: ${marker}`);

assert(background.includes("activation: Settings.clone(validation.config.activation)"));
assert(background.includes("const automationOnlyConfig = Settings.normalizeConfig({"));
assert(background.includes("componentBaseConfig"));
assert(background.includes("componentBindings"));
assert(background.includes("saveTabComponentBindings(tab.id, session.componentBindings)"));

for (const marker of [
  "ruleListProfileEditorSelectionByTab",
  "alertProfileEditorSelectionByTab",
  "monitorProfileEditorSelectionByRule",
  "targetProfileEditorSelectionByRule",
  "function componentEditorSpec(type)",
  "function rememberComponentEditorSelection(type, profileId)",
  "async function applySelectedComponentProfile(type)",
  "async function clearSelectedComponentProfileBinding(type)",
  "async function createComponentProfileFromEditor(type)",
  "async function saveSelectedComponentProfile(type)",
  "function componentEditorDirty(type)",
  "function confirmDiscardComponentEditor(type, action)"
]) assert(sidebar.includes(marker), `sidebar missing independent editor contract: ${marker}`);

const targetHandlerStart = sidebar.indexOf('elements.applyTargetProfileButton.addEventListener');
const targetHandlerEnd = sidebar.indexOf('elements.clearTargetProfileBindingButton.addEventListener', targetHandlerStart);
assert(targetHandlerStart >= 0 && targetHandlerEnd > targetHandlerStart);
const targetHandler = sidebar.slice(targetHandlerStart, targetHandlerEnd);
assert(targetHandler.includes('applySelectedComponentProfile("target")'));
assert(!targetHandler.includes("saveProfileConfiguration"), "Target Apply must not save or duplicate the Automation profile.");

assert(working.includes("const VERSION = 5;"));
assert(working.includes("componentBaseConfig"));
assert(working.includes("componentBindings"));

const sandbox = {
  console, Date, JSON, Math, URL, Uint32Array,
  crypto: crypto.webcrypto,
  globalThis: null
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(read("extension/shared/settings.js"), sandbox, { filename: "settings.js" });
const Settings = sandbox.FCI_SETTINGS;
assert.ok(Settings.SCHEMA_VERSION >= 19);

const configA = Settings.defaultConfig();
configA.rules[0].name = "Legacy A";
configA.alerts.titlePrefix = "A";
const configB = Settings.defaultConfig();
configB.rules[0].name = "Legacy B";
configB.alerts.titlePrefix = "B";
const configBDuplicate = Settings.clone(configB);

const legacyStore = {
  schemaVersion: 18,
  revision: 8,
  defaultProfileId: "legacy-b",
  profiles: [
    Settings.createProfile("Legacy A automation", configA, "legacy-a"),
    Settings.createProfile("Legacy B automation", configB, "legacy-b"),
    Settings.createProfile("Legacy B duplicate", configBDuplicate, "legacy-b-copy")
  ]
};
const migrated = Settings.normalizeStore(legacyStore);
assert.equal(migrated.ruleListProfiles.length, 2, "Distinct legacy Rule lists must migrate and duplicates must collapse.");
assert.equal(migrated.alertProfiles.length, 2, "Distinct legacy Alert configs must migrate and duplicates must collapse.");
const defaultRules = Settings.ruleListProfileById(migrated, migrated.defaultRuleListProfileId);
const defaultAlerts = Settings.alertProfileById(migrated, migrated.defaultAlertProfileId);
assert.equal(defaultRules.rules[0].name, "Legacy B", "Legacy default Automation must map to the migrated default Rule-list profile.");
assert.equal(defaultAlerts.alerts.titlePrefix, "B", "Legacy default Automation must map to the migrated default Alert profile.");

console.log("PASS: Phase 76 v0.42.0 independent Automation/Rule-list/Monitor/Target/Alert/Local-action profiles with per-tab and per-rule bindings");
