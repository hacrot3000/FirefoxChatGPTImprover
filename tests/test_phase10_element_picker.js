#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const runtimeListeners = [];
const documentStub = {
  querySelectorAll() { return []; },
  addEventListener() {}, removeEventListener() {},
  createElement() { return { style: {}, setAttribute() {}, remove() {}, isConnected: true }; },
  documentElement: { append() {} }, body: { append() {} }
};
const context = vm.createContext({
  console,
  document: documentStub,
  window: { addEventListener() {}, removeEventListener() {}, innerHeight: 800, innerWidth: 1200 },
  browser: {
    runtime: {
      onMessage: { addListener(listener) { runtimeListeners.push(listener); }, removeListener() {} },
      sendMessage() { return Promise.resolve(); }
    }
  },
  globalThis: null,
  CSS: { escape(value) { return String(value).replace(/[^a-zA-Z0-9_-]/g, "_"); } },
  FCI_PROTOCOL: {
    MESSAGE: {
      CONTENT_START_ELEMENT_PICKER: "start",
      CONTENT_CANCEL_ELEMENT_PICKER: "cancel",
      CONTENT_PICKER_RESULT: "result"
    }
  }
});
context.globalThis = context;
vm.runInContext(fs.readFileSync(path.join(root, "extension/content/picker.js"), "utf8"), context, { filename: "picker.js" });
const Picker = context.FCI_ELEMENT_PICKER;
assert(Picker.VERSION >= 1);

function element({ tag = "BUTTON", id = "", classes = [], attrs = {}, parent = null } = {}) {
  return {
    nodeType: 1,
    tagName: tag,
    id,
    classList: classes,
    parentElement: parent,
    children: [],
    closest() { return null; },
    getAttribute(name) { return attrs[name] ?? null; }
  };
}
const uniqueId = element({ id: "composer-submit-button" });
let doc = { querySelectorAll(css) { return css.includes("composer-submit-button") ? [uniqueId] : []; } };
let result = Picker.buildSelector(uniqueId, doc);
assert.equal(result.selector.kind, "id");
assert.equal(result.selector.value, "composer-submit-button");
assert.equal(result.matchCount, 1);

const byTestId = element({ attrs: { "data-testid": "send-button" } });
doc = { querySelectorAll(css) { return css.includes("data-testid") ? [byTestId] : []; } };
result = Picker.buildSelector(byTestId, doc);
assert.equal(result.selector.kind, "attribute");
assert.equal(result.selector.attributeName, "data-testid");
assert.equal(result.selector.value, "send-button");

const byClass = element({ classes: ["composer-submit-btn", "primary"] });
doc = { querySelectorAll(css) { return css.includes("composer-submit-btn") ? [byClass] : []; } };
result = Picker.buildSelector(byClass, doc);
assert.equal(result.selector.kind, "class");
assert.match(result.css, /composer-submit-btn/);

const protocol = fs.readFileSync(path.join(root, "extension/shared/protocol.js"), "utf8");
assert(protocol.includes('VERSION: 7'));
for (const token of ["START_ELEMENT_PICKER", "CANCEL_ELEMENT_PICKER", "CONTENT_PICKER_RESULT", "PICKER_RESULT"]) {
  assert(protocol.includes(token), `missing picker protocol ${token}`);
}
const sidebarHtml = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
assert(sidebarHtml.includes('id="monitorPickerButton"'));
assert(sidebarHtml.includes('id="targetPickerButton"'));
const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
assert(background.includes('const pickerStates = new Map()'));
assert(background.includes('content/picker.js'));
assert(background.includes('handleElementPickerResult'));
console.log("PASS: Phase 10 visual element picker selector generation and multi-tab message contract");
