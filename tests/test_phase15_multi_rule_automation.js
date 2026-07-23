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
      array[0] = 17;
      array[1] = 23;
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

assert.equal(Settings.SCHEMA_VERSION, 11);
const defaults = Settings.defaultConfig();
assert.equal(defaults.rules.length, 1);
assert.equal(defaults.activeRuleId, defaults.rules[0].id);
assert.deepEqual(JSON.parse(JSON.stringify(defaults.monitor)), JSON.parse(JSON.stringify(defaults.rules[0].monitor)));

const legacy = Settings.normalizeConfig({
  monitor: {
    selector: { tag: "button", kind: "id", value: "legacy-button", attributeName: "" },
    conditions: []
  },
  target: { enabled: false }
});
assert.equal(legacy.rules.length, 1);
assert.equal(legacy.rules[0].monitor.selector.value, "legacy-button");

const second = Settings.defaultRule("Rule B", "rule-b");
second.monitor.selector = { tag: "div", kind: "class", value: "answer-ready", attributeName: "" };
const multi = Settings.normalizeConfig({
  ...defaults,
  activeRuleId: "rule-b",
  rules: [
    { ...defaults.rules[0], id: "rule-a", name: "Rule A" },
    second
  ],
  monitor: second.monitor,
  target: second.target
});
assert.equal(multi.rules.length, 2);
assert.equal(multi.activeRuleId, "rule-b");
assert.equal(Settings.configForRule(multi, "rule-a").monitor.selector.value, "#composer-submit-button");
assert.equal(Settings.configForRule(multi, "rule-b").monitor.selector.value, "answer-ready");

const invalid = Settings.clone(multi);
invalid.rules[1].monitor.conditions = [{ enabled: true, attribute: "aria-label", operator: "regex", value: "[", caseSensitive: true }];
const validation = Settings.validateConfig(invalid);
assert.equal(validation.ok, false);
assert(validation.errors.some((error) => error.includes("Rule B") && error.includes("regex")));

const monitorInstances = [];
const targetInstances = [];
context.FCI_MONITOR_ENGINE = {
  createMonitor({ onRuntime }) {
    const instance = {
      config: null,
      onRuntime,
      started: 0,
      paused: 0,
      stopped: 0,
      start(config) { this.config = config; this.started += 1; },
      resume(config) { this.config = config; this.started += 1; },
      pause() { this.paused += 1; },
      stop() { this.stopped += 1; }
    };
    monitorInstances.push(instance);
    return instance;
  }
};
context.FCI_TARGET_ENGINE = {
  createTargetAutomation({ onRuntime }) {
    const instance = {
      config: null,
      onRuntime,
      monitorEvents: [],
      started: 0,
      paused: 0,
      stopped: 0,
      start(config) { this.config = config; this.started += 1; },
      resume(config) { this.config = config; this.started += 1; },
      pause() { this.paused += 1; },
      stop() { this.stopped += 1; },
      handleMonitorRuntime(runtime) { this.monitorEvents.push(runtime); }
    };
    targetInstances.push(instance);
    return instance;
  }
};
vm.runInContext(fs.readFileSync(path.join(root, "extension/content/rules.js"), "utf8"), context);
const events = [];
const manager = context.FCI_RULE_ENGINE.createRuleAutomation({ onRuntime: (runtime) => events.push(runtime) });
manager.start(multi, "test-start", 5);
assert.equal(monitorInstances.length, 2);
assert.equal(targetInstances.length, 2);
assert.equal(monitorInstances[0].config.activeRuleId, "rule-a");
assert.equal(monitorInstances[1].config.activeRuleId, "rule-b");

monitorInstances[0].onRuntime({ monitorState: MONITOR_STATE.WAITING, cycle: 0, monitorCount: 1, monitorMatchedCount: 0, lastReason: "baseline" });
monitorInstances[1].onRuntime({ monitorState: MONITOR_STATE.WAITING, cycle: 0, monitorCount: 2, monitorMatchedCount: 0, lastReason: "baseline" });
monitorInstances[0].onRuntime({ monitorState: MONITOR_STATE.MATCHED, cycle: 1, monitorCount: 1, monitorMatchedCount: 1, lastTransition: "waiting->matched" });
let latest = events.at(-1);
assert.equal(latest.monitorState, MONITOR_STATE.MATCHED);
assert.equal(latest.matchedRuleCount, 1);
assert.deepEqual(JSON.parse(JSON.stringify(latest.matchedRuleIds)), ["rule-a"]);
assert.equal(latest.cycle, 6);
assert.equal(targetInstances[0].monitorEvents.at(-1).monitorState, MONITOR_STATE.MATCHED);

monitorInstances[1].onRuntime({ monitorState: MONITOR_STATE.MATCHED, cycle: 1, monitorCount: 2, monitorMatchedCount: 1, lastTransition: "waiting->matched" });
latest = events.at(-1);
assert.equal(latest.matchedRuleCount, 2);
assert.equal(latest.cycle, 7);
assert.equal(latest.ruleRuntimes["rule-b"].ruleName, "Rule B");

monitorInstances[0].onRuntime({ monitorState: MONITOR_STATE.WAITING, cycle: 1, monitorCount: 1, monitorMatchedCount: 0, lastTransition: "matched->waiting" });
latest = events.at(-1);
assert.equal(latest.monitorState, MONITOR_STATE.MATCHED);
assert.equal(latest.matchedRuleCount, 1);
assert.deepEqual(JSON.parse(JSON.stringify(latest.matchedRuleIds)), ["rule-b"]);

targetInstances[1].onRuntime({ targetState: "armed", candidateCount: 1, handledCount: 1, lastTargetAction: "click:1" });
latest = events.at(-1);
assert.equal(latest.lastRuleId, "rule-b");
assert(latest.lastTargetAction.includes("Rule B"));

manager.pause();
assert(monitorInstances.every((instance) => instance.paused === 1));
assert(targetInstances.every((instance) => instance.paused === 1));
manager.stop();
assert(monitorInstances.every((instance) => instance.stopped >= 1));
assert(targetInstances.every((instance) => instance.stopped >= 1));

const sidebarHtml = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
const sidebarJs = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
for (const marker of ["ruleSelect", "newRuleButton", "duplicateRuleButton", "deleteRuleButton", "ruleRuntimeSummary"]) {
  assert(sidebarHtml.includes(`id="${marker}"`), `sidebar HTML missing ${marker}`);
}
for (const marker of ["formConfigDraft", "selectedRuleId", "commitCurrentRuleDraft", "selectRuleForEditing", "addRule"]) {
  assert(sidebarJs.includes(marker), `sidebar JS missing ${marker}`);
}
assert(background.includes('"content/rules.js"'));
console.log("PASS: Phase 15 multi-rule schema migration, independent rule runtimes, aggregate alert cycle and sidebar rule editor");
