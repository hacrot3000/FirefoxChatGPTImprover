#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const root = path.resolve(__dirname, "..");

class FakeElement {
  constructor({ visible = true, attributes = {} } = {}) {
    this._visible = visible;
    this._attributes = { ...attributes };
    this.textContent = "";
    this.hidden = false;
    this.isConnected = true;
    this.parentElement = null;
    this.tagName = "BUTTON";
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this._attributes, name)
      ? this._attributes[name]
      : null;
  }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this._attributes, name); }
  setAttribute(name, value) { this._attributes[name] = String(value); }
  removeAttribute(name) { delete this._attributes[name]; }
  getClientRects() { return this._visible ? [{}] : []; }
}

class FakeMutationObserver {
  constructor(callback) { this.callback = callback; }
  observe() {}
  disconnect() {}
}

function createFakeClock() {
  let now = Date.parse("2026-07-23T00:00:00.000Z");
  let nextTimerId = 1;
  const timers = new Map();

  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
    static now() { return now; }
  }

  function setTimeoutFake(callback, delayMs = 0) {
    const id = nextTimerId++;
    const delay = Math.max(0, Math.ceil(Number(delayMs) || 0));
    timers.set(id, { id, due: now + delay, callback });
    return id;
  }

  function clearTimeoutFake(id) {
    timers.delete(id);
  }

  function nextTimer() {
    return [...timers.values()].sort((a, b) => a.due - b.due || a.id - b.id)[0] || null;
  }

  function runTimer(timer, executionTime = timer.due) {
    assert(timers.delete(timer.id), `Timer ${timer.id} is no longer scheduled.`);
    assert(executionTime >= now, "Fake clock cannot move backwards.");
    now = executionTime;
    timer.callback();
  }

  function advance(ms) {
    const target = now + Math.max(0, Number(ms) || 0);
    while (true) {
      const timer = nextTimer();
      if (!timer || timer.due > target) break;
      runTimer(timer, timer.due);
    }
    now = target;
  }

  function runNextEarly(msBeforeDue = 1) {
    const timer = nextTimer();
    assert(timer, "Expected a pending timer.");
    const executionTime = Math.max(now, timer.due - Math.max(1, msBeforeDue));
    assert(executionTime < timer.due, "Timer must execute before its deadline in this regression test.");
    runTimer(timer, executionTime);
  }

  return {
    Date: FakeDate,
    setTimeout: setTimeoutFake,
    clearTimeout: clearTimeoutFake,
    advance,
    runNextEarly,
    pendingCount: () => timers.size
  };
}

(() => {
  const clock = createFakeClock();
  const element = new FakeElement({ attributes: { "aria-label": "Idle" } });
  const context = vm.createContext({
    console,
    crypto: webcrypto,
    URL,
    Date: clock.Date,
    Element: FakeElement,
    MutationObserver: FakeMutationObserver,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    getComputedStyle() { return { display: "block", visibility: "visible" }; },
    document: {
      documentElement: {},
      body: {},
      querySelectorAll() { return [element]; }
    }
  });
  context.globalThis = context;

  for (const relative of [
    "extension/shared/protocol.js",
    "extension/shared/settings.js",
    "extension/content/monitor.js"
  ]) {
    vm.runInContext(fs.readFileSync(path.join(root, relative), "utf8"), context, { filename: relative });
  }

  const Settings = context.FCI_SETTINGS;
  const Protocol = context.FCI_PROTOCOL;
  const Engine = context.FCI_MONITOR_ENGINE;
  assert(Settings.SCHEMA_VERSION >= 10);
  assert(Engine.VERSION >= 5);

  const config = Settings.normalizeConfig({
    monitor: {
      selector: { tag: "button", kind: "css", value: "button" },
      visibilityTransition: "none",
      matchStableMs: 80,
      resetStableMs: 80,
      conditions: [{
        enabled: true,
        attribute: "aria-label",
        operator: "equals",
        value: "Ready",
        caseSensitive: true
      }]
    }
  });

  const events = [];
  const monitor = Engine.createMonitor({ onRuntime: (runtime) => events.push({ ...runtime }) });
  monitor.start(config, "start");
  assert.equal(events.at(-1).monitorState, Protocol.MONITOR_STATE.WAITING);

  element.setAttribute("aria-label", "Ready");
  monitor.evaluate("match-flicker-begin");
  assert.equal(events.at(-1).pendingMonitorState, Protocol.MONITOR_STATE.MATCHED);
  assert.equal(clock.pendingCount(), 1);
  element.setAttribute("aria-label", "Idle");
  monitor.evaluate("match-flicker-cancel");
  assert.equal(events.at(-1).pendingMonitorState, null);
  assert.equal(clock.pendingCount(), 0);
  clock.advance(100);
  assert.equal(events.at(-1).monitorState, Protocol.MONITOR_STATE.WAITING);
  assert.equal(events.at(-1).cycle, 0);

  element.setAttribute("aria-label", "Ready");
  monitor.evaluate("match-stable");
  clock.runNextEarly(1);
  assert.equal(events.at(-1).monitorState, Protocol.MONITOR_STATE.WAITING);
  assert.equal(events.at(-1).pendingMonitorState, Protocol.MONITOR_STATE.MATCHED);
  assert.equal(clock.pendingCount(), 1, "An early callback must re-arm the remaining stability delay.");
  clock.advance(1);
  assert.equal(events.at(-1).monitorState, Protocol.MONITOR_STATE.MATCHED);
  assert.equal(events.at(-1).cycle, 1);

  element.setAttribute("aria-label", "Idle");
  monitor.evaluate("reset-flicker-begin");
  assert.equal(events.at(-1).pendingMonitorState, Protocol.MONITOR_STATE.WAITING);
  element.setAttribute("aria-label", "Ready");
  monitor.evaluate("reset-flicker-cancel");
  assert.equal(events.at(-1).pendingMonitorState, null);
  assert.equal(clock.pendingCount(), 0);
  clock.advance(100);
  assert.equal(events.at(-1).monitorState, Protocol.MONITOR_STATE.MATCHED);
  assert.equal(events.at(-1).cycle, 1);

  element.setAttribute("aria-label", "Idle");
  monitor.evaluate("reset-stable");
  clock.runNextEarly(1);
  assert.equal(events.at(-1).pendingMonitorState, Protocol.MONITOR_STATE.WAITING);
  assert.equal(clock.pendingCount(), 1, "An early reset callback must also re-arm the remaining delay.");
  clock.advance(1);
  assert.equal(events.at(-1).monitorState, Protocol.MONITOR_STATE.WAITING);
  assert.equal(events.at(-1).pendingMonitorState, null);

  element.setAttribute("aria-label", "Ready");
  monitor.evaluate("second-match");
  clock.advance(80);
  assert.equal(events.at(-1).monitorState, Protocol.MONITOR_STATE.MATCHED);
  assert.equal(events.at(-1).cycle, 2);
  monitor.stop();
  assert.equal(clock.pendingCount(), 0);

  console.log("PASS: Phase 13 deterministic monitor stability and early-timer re-arm");
})();
