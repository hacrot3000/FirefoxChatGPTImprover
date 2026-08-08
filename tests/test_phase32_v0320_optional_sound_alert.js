#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const listeners = new Map();
class FakeMutationObserver { observe() {} disconnect() {} }
const attributes = new Map();
const document = {
  title: "Sound test tab",
  visibilityState: "visible",
  head: {},
  documentElement: {
    getAttribute(name) { return attributes.get(name) || null; },
    setAttribute(name, value) { attributes.set(name, String(value)); }
  },
  querySelector() { return null; },
  addEventListener(type, listener) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(listener);
  },
  removeEventListener(type, listener) { listeners.get(type)?.delete(listener); }
};
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
  "extension/shared/alert_sound.js",
  "extension/content/alert.js"
]) {
  vm.runInContext(fs.readFileSync(path.join(root, relative), "utf8"), context, { filename: relative });
}

const Settings = context.FCI_SETTINGS;
const Protocol = context.FCI_PROTOCOL;
const Sound = context.FCI_ALERT_SOUND;
const Alert = context.FCI_ALERT_ENGINE;

assert(Settings.SCHEMA_VERSION >= 17);
assert(Protocol.VERSION >= 21);
assert(Alert.VERSION >= 12);
assert.equal(Sound.VERSION, 1);

const defaults = Settings.defaultConfig().alerts.sound;
assert.deepEqual(JSON.parse(JSON.stringify(defaults)), {
  enabled: false,
  tone: "soft-chime",
  volume: 0.45,
  repeatCount: 1,
  repeatIntervalMs: 900
});
const normalized = Settings.normalizeConfig({ alerts: { sound: {
  enabled: true,
  tone: "urgent",
  volume: 99,
  repeatCount: 99,
  repeatIntervalMs: 1
} } }).alerts.sound;
assert.equal(normalized.enabled, true);
assert.equal(normalized.tone, "urgent");
assert.equal(normalized.volume, 1);
assert.equal(normalized.repeatCount, 5);
assert.equal(normalized.repeatIntervalMs, 250);
assert.equal(Settings.normalizeConfig({ alerts: { sound: { tone: "invalid" } } }).alerts.sound.tone, "soft-chime");

const playCalls = [];
let stopCalls = 0;
const soundPlayer = {
  async play(options) {
    playCalls.push(JSON.parse(JSON.stringify(options)));
    return { started: true, options };
  },
  stop() { stopCalls += 1; }
};
const emitted = [];
const controller = Alert.createAlertController({ soundPlayer, onRuntime(runtime) { emitted.push(runtime); } });
const config = Settings.normalizeConfig({ alerts: {
  titleBlink: false,
  badge: false,
  sidebar: false,
  notification: false,
  sound: { enabled: true, tone: "double-beep", volume: 0.3, repeatCount: 2, repeatIntervalMs: 700 },
  dismissOnUserActivity: false,
  activeTabTimeoutSeconds: 0
} });

let runtime = controller.apply(config, {
  monitorState: Protocol.MONITOR_STATE.MATCHED,
  cycle: 1,
  alertActive: false,
  alertCycle: 0,
  soundAlertCycle: 0
}, Protocol.MODE.ACTIVE, "cycle-1");
assert.equal(runtime.alertActive, true, "Sound-only alert channel must activate the alert lifecycle.");
assert.equal(playCalls.length, 1, "A sound must be scheduled once for the new alert cycle.");
assert.equal(playCalls[0].tone, "double-beep");

runtime = controller.apply(config, {
  ...runtime,
  monitorState: Protocol.MONITOR_STATE.MATCHED,
  cycle: 1
}, Protocol.MODE.ACTIVE, "same-cycle");
assert.equal(playCalls.length, 1, "Repeated runtime updates in the same cycle must not replay sound.");

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
assert.equal(playCalls.length, 2, "A later alert cycle must play sound once.");
controller.acknowledge("test");
assert(stopCalls >= 1, "Dismissing an alert must stop pending sound repeats.");

const restoredPlayerCalls = [];
const restoredController = Alert.createAlertController({
  soundPlayer: { async play(options) { restoredPlayerCalls.push(options); return { started: true, options }; }, stop() {} }
});
restoredController.apply(config, {
  monitorState: Protocol.MONITOR_STATE.MATCHED,
  cycle: 8,
  alertActive: true,
  alertCycle: 8,
  soundAlertCycle: 8,
  soundAlertState: "played"
}, Protocol.MODE.ACTIVE, "recovery");
assert.equal(restoredPlayerCalls.length, 0, "Recovery of an already-active cycle must not replay the sound.");

const html = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
const sidebar = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
assert.match(html, /id="soundAlertEnabled"/);
assert.match(html, /id="testSoundAlertButton"/);
assert.match(html, /shared\/alert_sound\.js/);
assert.match(sidebar, /soundPreviewPlayer/);
assert.match(background, /"shared\/alert_sound\.js"/);

console.log("PASS: Phase 32 optional sound alert defaults, bounded controls, one-play-per-cycle and recovery semantics");
