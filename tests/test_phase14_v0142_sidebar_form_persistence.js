#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");
const root = path.resolve(__dirname, "..");
const sidebar = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");

for (const marker of [
  "function renderRuntimeDashboard", "function refreshDashboardPassive", "function schedulePassiveDashboardRefresh",
  "FORM_RELOAD_MESSAGE_TYPES", "renderDetails(contextChanged)", "schedulePassiveDashboardRefresh()"
]) assert(sidebar.includes(marker), `sidebar missing ${marker}`);
assert(sidebar.includes('if (loadForm) {\n      elements.profileName.value'), "profile name must only reload with form");
assert(!sidebar.includes('} else {\n      void request(MESSAGE.GET_DASHBOARD);\n    }'), "passive dashboard updates must not use destructive request render");
for (const marker of ["runtimeBroadcastTimers", "scheduleRuntimeBroadcast(tabId)", "assertPersistedConfig", "Save profile", "Import profile"]) {
  assert(background.includes(marker), `background missing ${marker}`);
}

const context = { globalThis: {}, crypto: { randomUUID: () => "uuid-test", getRandomValues: (array) => { array[0] = 1; array[1] = 2; return array; } }, Uint32Array };
context.globalThis = context;
vm.runInNewContext(fs.readFileSync(path.join(root, "extension/shared/settings.js"), "utf8"), context);
const Settings = context.FCI_SETTINGS;
const store = Settings.defaultStore();
store.profiles[0].config.rules[0].monitor.selector = { tag: "button", kind: "id", attributeName: "", value: "composer-submit-button" };
store.profiles[0].config.rules[0].monitor.conditions = [{ enabled: true, attribute: "aria-label", operator: "contains", value: "Start Voice", caseSensitive: false }];
store.profiles[0].config.monitor = store.profiles[0].config.rules[0].monitor;
const imported = Settings.importStore(Settings.exportStore(store));
assert.deepStrictEqual(JSON.parse(JSON.stringify(imported.profiles[0].config.monitor.selector)), {
  tag: "button", kind: "id", value: "composer-submit-button", attributeName: ""
});
assert.strictEqual(imported.profiles[0].config.monitor.conditions[0].value, "Start Voice");
console.log("PASS: Phase 14 v0.14.2 sidebar form stability and lossless profile/import persistence");
