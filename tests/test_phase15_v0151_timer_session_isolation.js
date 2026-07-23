#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const titleNode = { nodeType: 1 };
const listeners = new Map();
const document = {
  title: "AI tab",
  visibilityState: "visible",
  head: titleNode,
  documentElement: titleNode,
  querySelector(selector) { return selector === "title" ? titleNode : null; },
  addEventListener(type, callback) { listeners.set(type, callback); },
  removeEventListener(type) { listeners.delete(type); }
};
class FakeMutationObserver { observe() {} disconnect() {} }
const context = vm.createContext({
  console, Date, JSON, Math, Reflect, document, MutationObserver: FakeMutationObserver,
  setTimeout, clearTimeout, setInterval, clearInterval
});
context.globalThis = context;
for (const relative of ["extension/shared/protocol.js", "extension/shared/settings.js", "extension/content/alert.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, relative), "utf8"), context, { filename: relative });
}

const windowClock = {
  timers: new Map(), nextId: 1, nowValue: 1000,
  now() { assert.equal(this, windowClock); return this.nowValue; },
  setTimeout(callback) { assert.equal(this, windowClock); const id = this.nextId++; this.timers.set(id, callback); return id; },
  clearTimeout(id) { assert.equal(this, windowClock); this.timers.delete(id); },
  setInterval(callback) { assert.equal(this, windowClock); const id = this.nextId++; this.timers.set(id, callback); return id; },
  clearInterval(id) { assert.equal(this, windowClock); this.timers.delete(id); }
};
const controller = context.FCI_ALERT_ENGINE.createAlertController({ clock: windowClock });
const config = context.FCI_SETTINGS.normalizeConfig({
  alerts: { titleBlink: false, badge: true, sidebar: true, notification: false, dismissOnUserActivity: true, activeTabTimeoutSeconds: 5 }
});
assert.doesNotThrow(() => controller.apply(config, { monitorState: "matched", cycle: 1, alertActive: true, alertCycle: 1 }, "active", "test"));
assert(windowClock.timers.size >= 1, "active timeout must be scheduled through the bound clock");
controller.stop("test-stop");

const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
const activation = fs.readFileSync(path.join(root, "extension/content/activation.js"), "utf8");
for (const marker of ["sessionToken: Settings.makeId(\"session\")", "incomingSessionToken !== session.sessionToken", "activation-rolled-back"]) {
  assert(background.includes(marker), `background missing isolation marker: ${marker}`);
}
for (const marker of ["sessionToken: state.sessionToken", "tabId: state.tabId"]) {
  assert(activation.includes(marker), `activation missing isolation marker: ${marker}`);
}
const runtimeVersion = Number(/const RUNTIME_VERSION = (\d+);/.exec(activation)?.[1] || 0);
assert(runtimeVersion >= 13, `activation runtime version must remain >= 13, got ${runtimeVersion}`);
assert(!background.includes("monitorState: MONITOR_STATE.IDLE };"), "resume must preserve content monitor state");
console.log("PASS: Phase 15 v0.15.1 bound timers, activation rollback and tab/session runtime isolation");
