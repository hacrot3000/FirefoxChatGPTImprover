#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const alertSource = read("extension/content/alert.js");
const activation = read("extension/content/activation.js");
const manifest = JSON.parse(read("extension/manifest.json"));

assert.ok(manifest.version.localeCompare("0.28.19", undefined, { numeric: true }) >= 0);
assert.match(activation, /const RUNTIME_VERSION = (?:2[7-9]|[3-9][0-9])/);
assert.match(alertSource, /FCI_ALERT_ENGINE\?\.VERSION >= (?:1[1-9]|[2-9][0-9])/);
assert.match(alertSource, /VERSION: (?:1[1-9]|[2-9][0-9])/);

function createHarness() {
  const timeouts = [];
  const intervals = [];
  const document = {
    title: "Research - OTA",
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
  sandbox.globalThis = sandbox;
  Object.defineProperty(sandbox, "FCI_ALERT_ENGINE", {
    configurable: true,
    enumerable: false,
    writable: false,
    value: Object.freeze({ VERSION: 9 })
  });
  vm.runInNewContext(alertSource, sandbox, { filename: "alert.js" });
  return { document, Alert: sandbox.FCI_ALERT_ENGINE, timeouts, intervals };
}

const harness = createHarness();
assert.ok(harness.Alert.VERSION >= 11);
const controller = harness.Alert.createAlertController();
const config = { alerts: { titleBlink: true, badge: true, sidebar: true, notification: false, titlePrefix: "⚠ AI READY", activeTabTimeoutSeconds: 10, blinkIntervalMs: 500, dismissOnUserActivity: false } };
const matched = { monitorState: "matched", cycle: 149, alertCycle: 149, alertActive: true, shellCommandState: "idle" };
controller.apply(config, matched, "active", "matched");
assert.match(harness.document.title, /^\[⚠ AI READY\] Research - OTA$/);
assert.equal(controller.snapshot().titleBlinking, true);
assert.ok(harness.timeouts.length >= 1, "matched alert must schedule active-tab acknowledgement");

harness.timeouts[0]();
const afterTimeout = controller.snapshot();
assert.equal(afterTimeout.alertActive, false);
assert.equal(afterTimeout.alertDismissReason, "active-tab-timeout");
assert.equal(afterTimeout.monitorTitleSpinning, false, "matched must not become running after timeout");
assert.equal(harness.document.title, "[⚠ AI READY] Research - OTA");

controller.apply(config, { ...matched, alertActive: false, alertAcknowledgedAt: afterTimeout.alertAcknowledgedAt, alertDismissReason: "active-tab-timeout" }, "active", "post-timeout");
assert.equal(controller.snapshot().monitorTitleSpinning, false);
assert.equal(harness.document.title, "[⚠ AI READY] Research - OTA");

controller.apply(config, { monitorState: "waiting", shellCommandState: "idle" }, "active", "waiting");
assert.equal(controller.snapshot().monitorTitleSpinning, true, "only waiting is AI running");
assert.match(harness.document.title, /^⠋ Research - OTA$/);

console.log("PASS: Phase 28 v0.28.19 active-tab timeout keeps matched AI READY and only waiting shows Running");
