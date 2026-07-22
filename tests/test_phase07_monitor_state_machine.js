#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const root = path.resolve(__dirname, "..");
class FakeElement {
  constructor({ visible = false, attributes = {}, text = "" } = {}) {
    this._visible = visible;
    this._attributes = { ...attributes };
    this.textContent = text;
    this.hidden = false;
    this.isConnected = true;
    this.parentElement = null;
    this.tagName = "BUTTON";
  }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this._attributes, name) ? this._attributes[name] : null; }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this._attributes, name); }
  setAttribute(name, value) { this._attributes[name] = String(value); }
  removeAttribute(name) { delete this._attributes[name]; }
  getClientRects() { return this._visible ? [{}] : []; }
}
class FakeMutationObserver {
  constructor(callback) { this.callback = callback; this.options = null; this.disconnected = false; }
  observe(_target, options) { this.options = options; }
  disconnect() { this.disconnected = true; }
}

let elements = [new FakeElement({ visible: false, attributes: { "aria-label": "Ready" } })];
let invalidSelector = false;
const context = vm.createContext({
  console,
  crypto: webcrypto,
  URL,
  Element: FakeElement,
  MutationObserver: FakeMutationObserver,
  setTimeout,
  clearTimeout,
  getComputedStyle(element) {
    return { display: element._visible ? "block" : "none", visibility: "visible" };
  },
  document: {
    documentElement: {},
    body: {},
    querySelectorAll() {
      if (invalidSelector) throw new Error("invalid selector");
      return elements;
    }
  }
});
context.globalThis = context;
for (const relative of ["extension/shared/protocol.js", "extension/shared/settings.js", "extension/content/monitor.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, relative), "utf8"), context, { filename: relative });
}

const Protocol = context.FCI_PROTOCOL;
const engine = context.FCI_MONITOR_ENGINE;
assert(engine.VERSION >= 4);
const config = context.FCI_SETTINGS.normalizeConfig({
  monitor: {
    selector: { tag: "button", kind: "id", value: "composer-submit-button" },
    visibilityTransition: "hidden_to_visible",
    conditions: []
  }
});
const observerOptions = engine.observerOptionsForConfig({
  monitor: {
    selector: { tag: "button", kind: "attribute", attributeName: "data-testid", value: "send-button" },
    conditions: [{ enabled: true, attribute: "aria-label", operator: "contains", value: "Ready" }]
  }
});
assert(observerOptions.attributeFilter.includes("data-testid"));
assert(observerOptions.attributeFilter.includes("aria-label"));
assert(observerOptions.attributeFilter.includes("style"));
assert.equal(observerOptions.characterData, false);
const textOptions = engine.observerOptionsForConfig({ monitor: { conditions: [{ enabled: true, attribute: "textContent", operator: "contains", value: "Ready" }] } });
assert.equal(textOptions.characterData, true);

const events = [];
const monitor = engine.createMonitor({ onRuntime: (runtime) => events.push({ ...runtime }) });
monitor.start(config, "fixture-start");
assert.equal(events.at(-1).monitorState, Protocol.MONITOR_STATE.WAITING);
assert.equal(events.at(-1).cycle, 0, "Baseline ẩn không được tự MATCHED.");

elements[0]._visible = true;
monitor.evaluate("hidden-to-visible");
assert.equal(events.at(-1).monitorState, Protocol.MONITOR_STATE.MATCHED);
assert.equal(events.at(-1).cycle, 1);
const emittedAfterMatch = events.length;
for (let index = 0; index < 20; index += 1) monitor.evaluate("storm");
assert.equal(events.length, emittedAfterMatch, "Mutation storm cùng trạng thái không được phát event lặp.");

elements[0]._visible = false;
monitor.evaluate("rearm-hidden");
assert.equal(events.at(-1).monitorState, Protocol.MONITOR_STATE.WAITING);
elements[0]._visible = true;
monitor.evaluate("second-transition");
assert.equal(events.at(-1).cycle, 2);

const replacement = new FakeElement({ visible: true, attributes: { "aria-label": "Ready" } });
elements = [replacement];
monitor.evaluate("react-replace-visible");
assert.equal(events.at(-1).monitorState, Protocol.MONITOR_STATE.WAITING, "Node mới đang hiện phải tạo baseline, không tự MATCHED.");
replacement._visible = false;
monitor.evaluate("replacement-hidden");
replacement._visible = true;
monitor.evaluate("replacement-visible");
assert.equal(events.at(-1).monitorState, Protocol.MONITOR_STATE.MATCHED);
assert.equal(events.at(-1).cycle, 3);

invalidSelector = true;
monitor.evaluate("invalid-selector");
assert.equal(events.at(-1).monitorState, Protocol.MONITOR_STATE.ERROR);
monitor.stop();

console.log("PASS: Phase 07 monitor transition, re-render, mutation storm and error state");
