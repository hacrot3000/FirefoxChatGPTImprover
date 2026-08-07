#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
const css = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.css"), "utf8");
const sidebar = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
const pickerSource = fs.readFileSync(path.join(root, "extension/content/picker.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));

const version = manifest.version.split(".").map(Number);
assert(version[0] > 0 || version[1] > 39 || (version[1] === 39 && version[2] >= 0));
assert(html.includes('class="skip-link" href="#mainContent"'));
assert(html.includes('<main id="mainContent" tabindex="-1">'));
assert(html.includes('id="statusPill" class="status-pill" role="status" aria-live="polite" aria-atomic="true"'));
assert(html.includes('id="messageBox" class="message-box" role="status"'));
assert(html.includes('id="shellLogDialog" class="shell-log-dialog" aria-labelledby="shellLogDialogTitle" aria-describedby="shellLogMetadata"'));
assert(html.includes('id="workingSessionDialog" class="working-session-dialog" aria-labelledby="workingSessionDialogTitle" aria-describedby="workingSessionDialogDescription"'));
assert(html.includes('id="sidebarFeaturesDialog" class="sidebar-features-dialog" aria-labelledby="sidebarFeaturesDialogTitle" aria-describedby="sidebarFeaturesDialogDescription"'));
assert(html.includes('id="downloadCompletionDialog" class="working-session-dialog download-completion-dialog" aria-labelledby="downloadCompletionDialogTitle" aria-describedby="downloadCompletionMessage"'));
for (const label of [
  "Export automation profiles", "Import automation profiles",
  "Export monitor profiles", "Import monitor profiles",
  "Export target profiles", "Import target profiles",
  "Export local action profiles", "Import local action profiles",
]) {
  assert(html.includes(`aria-label="${label}"`), `missing unique accessible name: ${label}`);
}
assert(css.includes(":focus-visible"));
assert(css.includes("@media (prefers-reduced-motion: reduce)"));
assert(css.includes("@media (prefers-contrast: more)"));
assert(css.includes("@media (forced-colors: active)"));
assert(sidebar.includes('setAttribute("aria-busy", busy ? "true" : "false")'));
assert(sidebar.includes('isError ? "alert" : "status"'));
assert(sidebar.includes("elements.shellLogViewer.focus()"));
assert(pickerSource.includes("use Tab or Shift+Tab to move, Enter or Space to select"));
assert(pickerSource.includes('document.addEventListener("focusin", onFocusIn, true)'));

const listeners = new Map();
const sent = [];
const activeElement = {
  nodeType: 1,
  tagName: "BUTTON",
  id: "keyboard-target",
  classList: [],
  parentElement: null,
  isConnected: true,
  closest() { return null; },
  getAttribute() { return null; },
  getBoundingClientRect() { return { left: 10, top: 40, right: 110, bottom: 72, width: 100, height: 32 }; },
  focus() {},
};
function uiElement() {
  return {
    nodeType: 1,
    style: {},
    isConnected: true,
    setAttribute() {},
    remove() { this.isConnected = false; },
  };
}
const documentStub = {
  activeElement,
  body: { nodeType: 1, append() {} },
  documentElement: { nodeType: 1, append() {} },
  createElement() { return uiElement(); },
  querySelectorAll(selector) { return selector.includes("keyboard-target") ? [activeElement] : []; },
  addEventListener(type, listener) { listeners.set(type, listener); },
  removeEventListener(type) { listeners.delete(type); },
};
const context = vm.createContext({
  console,
  document: documentStub,
  window: { addEventListener() {}, removeEventListener() {}, innerHeight: 800, innerWidth: 1200 },
  browser: {
    runtime: {
      onMessage: { addListener() {}, removeListener() {} },
      sendMessage(message) { sent.push(message); return Promise.resolve(); },
    },
  },
  CSS: { escape(value) { return String(value); } },
  FCI_PROTOCOL: { MESSAGE: { CONTENT_START_ELEMENT_PICKER: "start", CONTENT_CANCEL_ELEMENT_PICKER: "cancel", CONTENT_PICKER_RESULT: "result" } },
  globalThis: null,
});
context.globalThis = context;
vm.runInContext(pickerSource, context, { filename: "picker.js" });
assert(context.FCI_ELEMENT_PICKER.VERSION >= 3);
context.FCI_ELEMENT_PICKER.start("target");
assert(listeners.has("focusin"), "keyboard picker must track focused page elements");
assert(listeners.has("keydown"), "keyboard picker must listen for selection keys");
listeners.get("keydown")({ key: "Enter", preventDefault() {}, stopImmediatePropagation() {} });
assert.equal(sent.length, 1);
assert.equal(sent[0].type, "result");
assert.equal(sent[0].payload.cancelled, false);
assert.equal(sent[0].payload.selector.kind, "id");
assert.equal(sent[0].payload.selector.value, "keyboard-target");

console.log("PASS: Phase 39 accessibility focus, live regions, contrast modes, reduced motion and keyboard-only element picker");
