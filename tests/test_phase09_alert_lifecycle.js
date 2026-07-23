#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const listeners = new Map();
class FakeMutationObserver {
  observe() {}
  disconnect() {}
}
let now = Date.parse("2026-07-22T12:00:00.000Z");
let nextTimerId = 1;
const timers = new Map();
const document = {
  title: "Internal AI",
  visibilityState: "visible",
  head: {},
  documentElement: {},
  querySelector() { return null; },
  addEventListener(type, listener) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(listener);
  },
  removeEventListener(type, listener) {
    listeners.get(type)?.delete(listener);
  }
};
function dispatch(type, event = {}) {
  for (const listener of listeners.get(type) || []) listener({ type, isTrusted: true, ...event });
}
function runTimers() {
  const pending = [...timers.entries()];
  timers.clear();
  for (const [, timer] of pending) {
    now += timer.delay;
    timer.callback();
  }
}

const context = vm.createContext({
  console,
  crypto: webcrypto,
  URL,
  document,
  MutationObserver: FakeMutationObserver,
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
assert(Alert.VERSION >= 5);
const emitted = [];
const config = Settings.normalizeConfig({
  alerts: {
    titleBlink: false,
    badge: true,
    sidebar: true,
    notification: false,
    dismissOnUserActivity: true,
    activeTabTimeoutSeconds: 5
  }
});
const clock = {
  now: () => now,
  setTimeout(callback, delay) {
    const id = nextTimerId++;
    timers.set(id, { callback, delay });
    return id;
  },
  clearTimeout(id) { timers.delete(id); }
};
const controller = Alert.createAlertController({ onRuntime: (runtime) => emitted.push(runtime), clock });

let runtime = controller.apply(config, {
  monitorState: Protocol.MONITOR_STATE.MATCHED,
  cycle: 1,
  alertActive: false,
  alertCycle: 0
}, Protocol.MODE.ACTIVE, "cycle-1");
assert.equal(runtime.alertActive, true);
assert.equal(runtime.alertCycle, 1);
assert.equal(timers.size, 1, "Active tab fallback timer must start for a visible alert.");

runtime = controller.apply(config, {
  ...runtime,
  monitorState: Protocol.MONITOR_STATE.WAITING,
  cycle: 1
}, Protocol.MODE.ACTIVE, "condition-left");
assert.equal(runtime.alertActive, true, "Alert must remain latched after monitor leaves MATCHED.");

for (const listener of listeners.get("pointerdown") || []) {
  listener({ type: "pointerdown", isTrusted: false });
}
assert.equal(controller.snapshot().alertActive, true, "Synthetic target clicks must not acknowledge the alert.");
dispatch("pointerdown");
assert.equal(controller.snapshot().alertActive, false);
assert.equal(controller.snapshot().alertDismissReason, "user-activity:pointerdown");
assert.equal(emitted.at(-1).alertActive, false);
assert.equal(timers.size, 0);

runtime = controller.apply(config, {
  ...controller.snapshot(),
  monitorState: Protocol.MONITOR_STATE.MATCHED,
  cycle: 1
}, Protocol.MODE.ACTIVE, "same-cycle");
assert.equal(runtime.alertActive, false, "Acknowledged cycle must not re-alert while condition stays MATCHED.");

runtime = controller.apply(config, {
  ...runtime,
  monitorState: Protocol.MONITOR_STATE.WAITING,
  cycle: 1
}, Protocol.MODE.ACTIVE, "rearm");
runtime = controller.apply(config, {
  ...runtime,
  monitorState: Protocol.MONITOR_STATE.MATCHED,
  cycle: 2
}, Protocol.MODE.ACTIVE, "cycle-2");
assert.equal(runtime.alertActive, true);
assert.equal(runtime.alertCycle, 2);
runTimers();
assert.equal(controller.snapshot().alertActive, false);
assert.equal(controller.snapshot().alertDismissReason, "active-tab-timeout");

runtime = controller.apply(config, {
  ...controller.snapshot(),
  monitorState: Protocol.MONITOR_STATE.WAITING,
  cycle: 2
}, Protocol.MODE.ACTIVE, "wait-cycle-3");
runtime = controller.apply(config, {
  ...runtime,
  monitorState: Protocol.MONITOR_STATE.MATCHED,
  cycle: 3
}, Protocol.MODE.ACTIVE, "cycle-3");
assert.equal(runtime.alertActive, true);
document.visibilityState = "hidden";
dispatch("visibilitychange");
assert.equal(timers.size, 0, "Hidden tab must cancel the continuous-active fallback timer.");
document.visibilityState = "visible";
dispatch("visibilitychange");
assert.equal(timers.size, 1, "Returning to the active tab must restart the full timeout window.");
controller.stop("test-done");

const disabledTimeout = Settings.normalizeConfig({ alerts: { activeTabTimeoutSeconds: -10 } });
assert.equal(disabledTimeout.alerts.activeTabTimeoutSeconds, 0);
const maxTimeout = Settings.normalizeConfig({ alerts: { activeTabTimeoutSeconds: 99999 } });
assert.equal(maxTimeout.alerts.activeTabTimeoutSeconds, 3600);

console.log("PASS: Phase 09 latched alerts, trusted activity acknowledgement and active-tab timeout");
