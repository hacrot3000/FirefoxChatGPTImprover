#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const context = vm.createContext({
  console,
  crypto: webcrypto,
  URL,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval
});
context.globalThis = context;

for (const relative of [
  "extension/shared/protocol.js",
  "extension/shared/settings.js",
  "extension/content/alert.js"
]) {
  vm.runInContext(fs.readFileSync(path.join(root, relative), "utf8"), context, { filename: relative });
}

const Settings = context.FCI_SETTINGS;
const Protocol = context.FCI_PROTOCOL;
const Alert = context.FCI_ALERT_ENGINE;

const config = Settings.normalizeConfig({ alerts: { titleBlink: true } });
assert.equal(Settings.SCHEMA_VERSION, 7);
assert.equal(config.alerts.titlePrefix, "⚠ AI READY");
assert.equal(config.alerts.blinkIntervalMs, 700);
assert.equal(config.alerts.dismissOnUserActivity, true);
assert.equal(config.alerts.activeTabTimeoutSeconds, 10);
assert(Protocol.VERSION >= 5);
assert.equal(Protocol.MESSAGE.TEST_TARGET_ACTION, "FCI_TEST_TARGET_ACTION");

assert.equal(Alert.shouldAlert(
  { alertActive: true, monitorState: Protocol.MONITOR_STATE.WAITING },
  Protocol.MODE.ACTIVE,
  config
), true);
assert.equal(Alert.shouldAlert(
  { alertActive: false, monitorState: Protocol.MONITOR_STATE.MATCHED },
  Protocol.MODE.ACTIVE,
  config
), false);
assert.equal(Alert.shouldAlert(
  { alertActive: true, monitorState: Protocol.MONITOR_STATE.MATCHED },
  Protocol.MODE.PAUSED,
  config
), false);
assert.equal(Alert.alertTitle("READY", "Internal AI"), "[READY] Internal AI");
assert.equal(Alert.alertTitle("", ""), "[⚠ AI READY]");

const clamped = Settings.normalizeConfig({ alerts: { blinkIntervalMs: 10 } });
assert.equal(clamped.alerts.blinkIntervalMs, 250);

console.log("PASS: Phase 05 alert/settings protocol logic");
