#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const context = {
  console,
  setTimeout,
  clearTimeout,
  Date,
  JSON,
  Math,
  Uint32Array,
  crypto: {
    getRandomValues(array) {
      array[0] = 19;
      array[1] = 29;
      return array;
    }
  }
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, "extension/shared/protocol.js"), "utf8"), context);
vm.runInContext(fs.readFileSync(path.join(root, "extension/shared/settings.js"), "utf8"), context);
const Settings = context.FCI_SETTINGS;
const { MONITOR_STATE } = context.FCI_PROTOCOL;

assert(Settings.SCHEMA_VERSION >= 13);
const preset = {
  id: "preset-safe",
  name: "Safe build",
  enabled: true,
  workingDirectory: "/tmp",
  command: "echo safe",
  mode: "background",
  confirmBeforeRun: false
};
const base = Settings.defaultConfig();
const rule = {
  ...base.rules[0],
  id: "rule-command",
  name: "Rule command",
  commandAction: {
    enabled: true,
    presetId: preset.id,
    trigger: "on_match",
    allowDryRun: false
  }
};
const config = Settings.normalizeConfig({
  ...base,
  activeRuleId: rule.id,
  rules: [rule],
  shell: { ...base.shell, presets: [preset] }
});
assert.equal(config.rules[0].commandAction.presetId, preset.id);
assert(Settings.validateConfig(config).ok);
// Command presets are validated by the separate local-action profile store.

const monitorInstances = [];
const targetInstances = [];
context.FCI_MONITOR_ENGINE = {
  createMonitor({ onRuntime }) {
    const instance = {
      onRuntime,
      start() {}, resume() {}, pause() {}, stop() {}
    };
    monitorInstances.push(instance);
    return instance;
  }
};
context.FCI_TARGET_ENGINE = {
  createTargetAutomation({ onRuntime }) {
    const instance = {
      onRuntime,
      start() {}, resume() {}, pause() {}, stop() {}, handleMonitorRuntime() {}
    };
    targetInstances.push(instance);
    return instance;
  }
};
vm.runInContext(fs.readFileSync(path.join(root, "extension/content/rules.js"), "utf8"), context);
assert.ok(context.FCI_RULE_ENGINE.VERSION >= 2);
const events = [];
const manager = context.FCI_RULE_ENGINE.createRuleAutomation({ onRuntime: (runtime) => events.push(runtime) });
manager.start(config, "test-start");
monitorInstances[0].onRuntime({ monitorState: MONITOR_STATE.WAITING, cycle: 0, lastReason: "baseline" });
monitorInstances[0].onRuntime({ monitorState: MONITOR_STATE.MATCHED, cycle: 1, lastTransition: "waiting->matched" });
let requestEvents = events.filter((event) => event.commandRequest);
assert.equal(requestEvents.length, 1);
assert.equal(requestEvents[0].commandRequest.ruleId, rule.id);
assert.equal(requestEvents[0].commandRequest.presetId, preset.id);
assert.equal(requestEvents[0].commandRequest.trigger, "on_match");
monitorInstances[0].onRuntime({ monitorState: MONITOR_STATE.MATCHED, cycle: 1, lastReason: "still-matched" });
requestEvents = events.filter((event) => event.commandRequest);
assert.equal(requestEvents.length, 1, "one request per rule cycle");

const afterTargetConfig = Settings.clone(config);
afterTargetConfig.rules[0].commandAction.trigger = "after_target";
manager.start(afterTargetConfig, "after-target");
monitorInstances.at(-1).onRuntime({ monitorState: MONITOR_STATE.MATCHED, cycle: 2, lastTransition: "waiting->matched" });
targetInstances.at(-1).onRuntime({ targetState: "acted", lastTargetAction: "dry-run:1" });
assert.equal(events.filter((event) => event.commandRequest?.trigger === "after_target").length, 0);
targetInstances.at(-1).onRuntime({ targetState: "acted", lastTargetAction: "click:1" });
assert.equal(events.filter((event) => event.commandRequest?.trigger === "after_target").length, 1);

const sidebarHtml = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
const sidebarJs = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
for (const id of ["ruleCommandEnabled", "ruleCommandPreset", "ruleCommandTrigger", "ruleCommandAllowDryRun", "ruleCommandStatus"]) {
  assert(sidebarHtml.includes(`id="${id}"`), `sidebar HTML missing ${id}`);
}
for (const token of ["renderRuleCommandPresetOptions", "commandAction", "ruleCommandPreset"]) {
  assert(sidebarJs.includes(token), `sidebar JS missing ${token}`);
}
for (const token of [
  "processAutomationCommandRequest", "automationCommandRequestIds", "startShellRunForSession",
  "Automatic command presets must have confirmation disabled", "stale monitor cycle"
]) {
  assert(background.includes(token), `background missing ${token}`);
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
const parts = manifest.version.split(".").map(Number);
assert(parts[0] > 0 || parts[1] >= 17, `Phase 17 requires version >= 0.17.0, got ${manifest.version}`);
console.log("PASS: Phase 17 per-rule command preset triggers, exactly-once cycle requests and background validation contracts");
