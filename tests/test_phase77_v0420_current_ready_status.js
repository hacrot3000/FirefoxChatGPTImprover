#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const manifest = JSON.parse(read("extension/manifest.json"));
const rulesSource = read("extension/content/rules.js");
const alertSource = read("extension/content/alert.js");
const activationSource = read("extension/content/activation.js");
const background = read("extension/background/background.js");
const sidebar = read("extension/sidebar/sidebar.js");

assert.ok(
  manifest.version.localeCompare("0.42.0", undefined, { numeric: true }) >= 0,
  `Phase 77 requires add-on version >= 0.42.0, got ${manifest.version}`
);

const ruleGuard = Number(rulesSource.match(/FCI_RULE_ENGINE\?\.VERSION >= (\d+)/)?.[1] || 0);
const ruleExport = Number(rulesSource.match(/VERSION:\s*(\d+)/)?.[1] || 0);
assert(ruleGuard >= 5);
assert.equal(ruleGuard, ruleExport);

const alertGuard = Number(alertSource.match(/FCI_ALERT_ENGINE\?\.VERSION >= (\d+)/)?.[1] || 0);
const alertExport = Number(alertSource.match(/VERSION:\s*(\d+)/)?.[1] || 0);
assert(alertGuard >= 16);
assert.equal(alertGuard, alertExport);

const runtimeVersion = Number(activationSource.match(/const RUNTIME_VERSION = (\d+);/)?.[1] || 0);
assert(runtimeVersion >= 31);

assert(rulesSource.includes("const currentlyMatched = values.filter"));
assert(rulesSource.includes("currentMatchedRuleCount: currentlyMatched.length"));
assert(rulesSource.includes("currentMatchedRuleIds: currentlyMatched.map"));
assert(rulesSource.includes("conditionMatched: currentlyMatched.length > 0"));

assert(background.includes("function runtimeHasCurrentMonitorMatch(runtime)"));
assert(background.includes("function runtimeIsReady(runtime)"));
assert(background.includes("runtimeIsReady(session.runtime) && config.alerts.badge"));
assert(!background.includes("session.runtime?.alertActive && config.alerts.badge"));

assert(sidebar.includes("function runtimeHasCurrentMonitorMatch(runtime)"));
assert(sidebar.includes("function runtimeIsReady(runtime, mode)"));
assert(sidebar.includes('elements.statusPill.textContent = readyNow ? "RD"'));
assert(sidebar.includes('"LATCHED"'));
assert(sidebar.includes("monitor not currently matched"));
assert(sidebar.includes("which is not applied to this tab/rule; RD reflects the monitor currently used by the running tab."));

const document = {
  title: "Project",
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
const sandbox = {
  console,
  crypto: webcrypto,
  URL,
  document,
  MutationObserver: class { observe() {} disconnect() {} },
  setTimeout() { return 1; },
  clearTimeout() {},
  setInterval() { return 1; },
  clearInterval() {}
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(read("extension/shared/protocol.js"), sandbox, { filename: "protocol.js" });
vm.runInContext(read("extension/shared/settings.js"), sandbox, { filename: "settings.js" });
vm.runInContext(alertSource, sandbox, { filename: "alert.js" });

const Alert = sandbox.FCI_ALERT_ENGINE;
const Protocol = sandbox.FCI_PROTOCOL;
assert.equal(
  Alert.shouldShowReadyTitle({ monitorState: Protocol.MONITOR_STATE.MATCHED, conditionMatched: true }, Protocol.MODE.ACTIVE),
  true
);
assert.equal(
  Alert.shouldShowReadyTitle({ monitorState: Protocol.MONITOR_STATE.MATCHED, conditionMatched: false, monitorMatchedCount: 0 }, Protocol.MODE.ACTIVE),
  false,
  "Stable MATCHED must not display RD after the current evaluation has stopped matching."
);
assert.equal(
  Alert.shouldShowReadyTitle({ monitorState: Protocol.MONITOR_STATE.WAITING, conditionMatched: true }, Protocol.MODE.ACTIVE),
  false,
  "A current raw match must still wait for match stability before displaying RD."
);

console.log("PASS: Phase 77 current-ready status uses stable MATCHED plus the current monitor evaluation, while latched alerts remain separate");
