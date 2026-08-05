#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const context = vm.createContext({ console, URL, Date, JSON, RegExp, crypto: webcrypto });
context.globalThis = context;
for (const file of ["extension/shared/settings.js", "extension/shared/working_session.js"]) {
  vm.runInContext(read(file), context, { filename: file });
}
const Settings = context.FCI_SETTINGS;
const WorkingSession = context.FCI_WORKING_SESSION;

assert.equal(Settings.SCHEMA_VERSION, 16);
const defaults = Settings.defaultStore();
assert.equal(defaults.monitorProfiles.length, 1);
assert.equal(defaults.targetProfiles.length, 1);
assert.equal(defaults.defaultMonitorProfileId, defaults.monitorProfiles[0].id);
assert.equal(defaults.defaultTargetProfileId, defaults.targetProfiles[0].id);

const legacyConfig = Settings.defaultConfig();
legacyConfig.monitor.selector = { kind: "css", tag: "button", value: "button[data-ready]", attributeName: "" };
legacyConfig.target.selector = { kind: "css", tag: "a", value: "a[data-download]", attributeName: "" };
legacyConfig.rules[0].monitor = Settings.clone(legacyConfig.monitor);
legacyConfig.rules[0].target = Settings.clone(legacyConfig.target);
const migrated = Settings.normalizeStore({
  schemaVersion: 15,
  revision: 9,
  defaultProfileId: "legacy",
  profiles: [Settings.createProfile("Legacy", legacyConfig, "legacy")]
});
assert.equal(migrated.monitorProfiles[0].monitor.selector.value, "button[data-ready]");
assert.equal(migrated.targetProfiles[0].target.selector.value, "a[data-download]");

const monitorProfile = Settings.createMonitorProfile("Chat ready", legacyConfig.monitor, "monitor-chat-ready");
const targetProfile = Settings.createTargetProfile("Patch download", legacyConfig.target, "target-patch-download");
const monitorBundle = Settings.buildProfileBundle("monitor", [monitorProfile], { defaultProfileId: monitorProfile.id });
const monitorParsed = Settings.parseProfileBundle(JSON.stringify(monitorBundle), "monitor");
assert.equal(monitorParsed.profileType, "monitor");
assert.equal(monitorParsed.profiles[0].monitor.selector.value, "button[data-ready]");
const targetBundle = Settings.buildProfileBundle("target", [targetProfile], { defaultProfileId: targetProfile.id });
assert.equal(Settings.parseProfileBundle(JSON.stringify(targetBundle), "target").profiles[0].target.selector.value, "a[data-download]");
assert.throws(
  () => Settings.parseProfileBundle(JSON.stringify(monitorBundle), "target"),
  /contains monitor profiles, not target profiles/
);
for (const type of ["configuration", "monitor", "target", "local-action"]) {
  assert.equal(Settings.parseProfileBundle(JSON.stringify(Settings.buildProfileBundle(type, [])), type).profileType, type);
}

const automationProfile = defaults.profiles[0];
const working = WorkingSession.parse(WorkingSession.stringify(WorkingSession.build([{
  sourceTabId: 22,
  url: "https://example.test/chat",
  pageTitle: "Original page title",
  customTitle: "Naruto server patch",
  title: "Naruto server patch",
  addOnActive: true,
  mode: "active",
  profileId: automationProfile.id,
  profile: automationProfile,
  configMode: "profile",
  effectiveConfig: automationProfile.config
}], { extensionVersion: "0.29.0" })));
assert.equal(working.version, 3);
assert.equal(working.tabs[0].customTitle, "Naruto server patch");
assert.equal(working.tabs[0].pageTitle, "Original page title");
assert.equal(working.tabs[0].title, "Naruto server patch");

const protocol = read("extension/shared/protocol.js");
for (const token of [
  "CREATE_COMPONENT_PROFILE", "SAVE_COMPONENT_PROFILE", "DELETE_COMPONENT_PROFILE",
  "EXPORT_PROFILE_BUNDLE", "IMPORT_PROFILE_BUNDLE", "SET_TAB_CUSTOM_TITLE"
]) assert(protocol.includes(token), token);
assert.match(protocol, /VERSION: 19/);

const html = read("extension/sidebar/sidebar.html");
for (const id of [
  "monitorProfileSelect", "monitorProfileName", "applyMonitorProfileButton", "newMonitorProfileButton",
  "saveMonitorProfileButton", "deleteMonitorProfileButton", "targetProfileSelect", "targetProfileName",
  "applyTargetProfileButton", "newTargetProfileButton", "saveTargetProfileButton", "deleteTargetProfileButton",
  "customTabTitle", "saveCustomTabTitleButton", "clearCustomTabTitleButton",
  "exportConfigurationProfilesButton", "importConfigurationProfilesButton",
  "exportMonitorProfilesButton", "importMonitorProfilesButton",
  "exportTargetProfilesButton", "importTargetProfilesButton",
  "exportLocalActionProfilesButton", "importLocalActionProfilesButton", "profileImportFile"
]) assert(html.includes(`id="${id}"`), id);
assert(html.includes("Import/export configuration"));

const background = read("extension/background/background.js");
for (const token of [
  "TAB_CUSTOM_TITLE_KEY", "browser.sessions.setTabValue", "browser.sessions.getTabValue",
  "applyPlainCustomTitle", "restoreAllCustomTabTitles", "tab-custom-title-restored", "createComponentProfile",
  "saveComponentProfile", "deleteComponentProfile", "exportProfileBundle", "importProfileBundle",
  "before_component_profile_save", "before_component_profile_delete", "bundle.defaultProfileId"
]) assert(background.includes(token), token);
assert(background.includes("__fciCustomTabTitleLockV1"));
assert(background.includes("MutationObserver"));

const sidebar = read("extension/sidebar/sidebar.js");
for (const token of [
  "applyComponentProfileToRule", "createComponentProfileFromRule", "saveSelectedComponentProfile",
  "deleteSelectedComponentProfile", "saveCustomTabTitle", "exportProfileType", "chooseProfileImport",
  "browser.permissions.contains", "browser.permissions.request"
]) assert(sidebar.includes(token), token);

const activation = read("extension/content/activation.js");
const alertSource = read("extension/content/alert.js");
assert.match(activation, /const RUNTIME_VERSION = 27/);
assert.match(alertSource, /VERSION: 11/);
assert(activation.includes("customTitle"));
assert(alertSource.includes("customTitle"));

// Verify the production alert title controller uses the custom title as its stable base.
const timeouts = [];
const intervals = [];
const document = {
  title: "Page title",
  visibilityState: "visible",
  documentElement: {
    attrs: new Map(),
    getAttribute(name) { return this.attrs.get(name) || ""; },
    setAttribute(name, value) { this.attrs.set(name, String(value)); }
  },
  querySelector() { return null; },
  head: null,
  addEventListener() {},
  removeEventListener() {}
};
const alertSandbox = {
  globalThis: null,
  document,
  MutationObserver: class { observe() {} disconnect() {} },
  setTimeout(callback) { timeouts.push(callback); return timeouts.length; },
  clearTimeout() {},
  setInterval(callback) { intervals.push(callback); return intervals.length; },
  clearInterval() {},
  FCI_PROTOCOL: {
    MODE: { ACTIVE: "active", INACTIVE: "inactive" },
    MONITOR_STATE: { IDLE: "idle", WAITING: "waiting", MATCHED: "matched" }
  },
  FCI_SETTINGS: {
    normalizeConfig(value) { return value; },
    defaultConfig() {
      return { alerts: { titleBlink: true, badge: true, sidebar: true, notification: false, titlePrefix: "⚠ AI READY", activeTabTimeoutSeconds: 10, blinkIntervalMs: 500, dismissOnUserActivity: false } };
    }
  }
};
alertSandbox.globalThis = alertSandbox;
vm.runInNewContext(alertSource, alertSandbox, { filename: "alert.js" });
const controller = alertSandbox.FCI_ALERT_ENGINE.createAlertController();
const alertConfig = { alerts: { titleBlink: true, badge: true, sidebar: true, notification: false, titlePrefix: "⚠ AI READY", activeTabTimeoutSeconds: 10, blinkIntervalMs: 500, dismissOnUserActivity: false } };
controller.apply(alertConfig, {
  monitorState: "matched", cycle: 1, alertCycle: 1, alertActive: true,
  customTitle: "Naruto server patch", pageTitle: "Page title", shellCommandState: "idle"
}, "active", "custom-title");
assert.equal(document.title, "[⚠ AI READY] Naruto server patch");
controller.stop("reset-before-waiting");
controller.apply(alertConfig, {
  monitorState: "waiting", alertActive: false,
  customTitle: "Naruto server patch", pageTitle: "Different page title", shellCommandState: "idle"
}, "active", "waiting");
assert.equal(document.title, "⠋ Naruto server patch");

const manifest = JSON.parse(read("extension/manifest.json"));
assert.ok(/^0\.(?:29|[3-9]\d)\./.test(manifest.version), `Expected Phase 29+ manifest version, found ${manifest.version}`);
console.log("PASS: Phase 29 v0.29.0 reusable monitor/target profiles, per-type JSON bundles and reload-persistent custom tab titles");
