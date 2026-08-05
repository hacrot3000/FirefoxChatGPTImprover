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

assert.ok(/^0\.28\.(?:1[8-9]|[2-9][0-9])$/.test(manifest.version));
assert.match(activation, /const RUNTIME_VERSION = (?:2[4-9]|[3-9][0-9])/);
assert.match(alertSource, /FCI_ALERT_ENGINE\?\.VERSION >= 9/);
assert.match(alertSource, /VERSION: 9/);
assert.match(alertSource, /MONITOR_STATE\.WAITING \|\| runtime\?\.monitorState === MONITOR_STATE\.MATCHED/);
assert.doesNotMatch(alertSource, /: \(commandPrefix \? alertTitle\(commandPrefix, baseTitle\) : baseTitle\)/);

function createDocument(title = "Project") {
  return {
    title,
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
}

function loadAlertEngine(document) {
  const intervals = [];
  const sandbox = {
    globalThis: null,
    document,
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout() { return 1; },
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
        return {
          alerts: {
            titleBlink: false,
            badge: true,
            sidebar: true,
            notification: false,
            titlePrefix: "⚠ AI READY",
            activeTabTimeoutSeconds: 0,
            blinkIntervalMs: 500,
            dismissOnUserActivity: false
          }
        };
      }
    }
  };
  sandbox.globalThis = sandbox;
  Object.defineProperty(sandbox, "FCI_ALERT_ENGINE", {
    configurable: true,
    enumerable: false,
    writable: false,
    value: Object.freeze({ VERSION: 8 })
  });
  vm.runInNewContext(alertSource, sandbox, { filename: "alert.js" });
  return { Alert: sandbox.FCI_ALERT_ENGINE, intervals };
}

const waitingDocument = createDocument();
const waitingLoaded = loadAlertEngine(waitingDocument);
assert.equal(waitingLoaded.Alert.VERSION, 9, "v0.28.18 must replace a preloaded v8 alert engine");
assert.equal(waitingLoaded.Alert.shouldSpinMonitorTitle({ monitorState: "matched" }, "active"), true,
  "an acknowledged matched monitor remains an active AI runtime and must retain the running spinner");

const waitingController = waitingLoaded.Alert.createAlertController();
waitingController.apply({
  alerts: {
    titleBlink: false,
    badge: true,
    sidebar: true,
    notification: false,
    titlePrefix: "⚠ AI READY",
    activeTabTimeoutSeconds: 0,
    blinkIntervalMs: 500,
    dismissOnUserActivity: false
  }
}, { monitorState: "waiting", shellCommandState: "unread" }, "active", "waiting");
assert.match(waitingDocument.title, /^⠋ \[✓\] Project$/,
  "the AI spinner must remain primary while the unread command icon is secondary");
assert.equal(waitingController.snapshot().monitorTitleSpinning, true);

const matchedDocument = createDocument();
const matchedLoaded = loadAlertEngine(matchedDocument);
const matchedController = matchedLoaded.Alert.createAlertController();
matchedController.apply({
  alerts: {
    titleBlink: false,
    badge: true,
    sidebar: true,
    notification: false,
    titlePrefix: "⚠ AI READY",
    activeTabTimeoutSeconds: 0,
    blinkIntervalMs: 500,
    dismissOnUserActivity: false
  }
}, { monitorState: "matched", shellCommandState: "unread", alertActive: false }, "active", "matched-acknowledged");
assert.match(matchedDocument.title, /^⠋ \[✓\] Project$/,
  "after an alert is acknowledged, the still-active AI monitor must resume the spinner instead of leaving a tick-only title");

const alertDocument = createDocument();
const alertLoaded = loadAlertEngine(alertDocument);
const alertController = alertLoaded.Alert.createAlertController();
alertController.apply({
  alerts: {
    titleBlink: true,
    badge: true,
    sidebar: true,
    notification: false,
    titlePrefix: "⚠ AI READY",
    activeTabTimeoutSeconds: 0,
    blinkIntervalMs: 500,
    dismissOnUserActivity: false
  }
}, {
  monitorState: "matched",
  cycle: 1,
  alertCycle: 1,
  alertActive: true,
  shellCommandState: "unread"
}, "active", "matched-alert");
assert.match(alertDocument.title, /^\[⚠ AI READY · ✓\] Project$/);
assert.ok(alertLoaded.intervals.length >= 1, "title blinking must install its interval");
alertLoaded.intervals[0]();
assert.match(alertDocument.title, /^\[AI READY · ✓\] Project$/,
  "the alternate alert frame must remain AI-primary and may never degrade to a tick-only title");
assert.doesNotMatch(alertDocument.title, /^\[✓\]/);

console.log("PASS: Phase 28 v0.28.18 forces the cumulative alert engine and keeps AI page-title status primary on every frame");
