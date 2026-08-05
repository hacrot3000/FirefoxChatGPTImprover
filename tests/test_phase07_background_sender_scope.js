#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const root = path.resolve(__dirname, "..");
let requestListener = null;
function event(listenerSink = null) {
  return { addListener(fn) { if (listenerSink) listenerSink(fn); }, removeListener() {} };
}
const browser = {
  runtime: {
    getURL(relative) { return `moz-extension://phase07/${relative}`; },
    onMessage: event((fn) => { requestListener = fn; }),
    lastError: null,
    connectNative() { throw new Error("native host must not be reached by rejected sender"); }
  },
  action: { onClicked: event(), setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  sidebarAction: { open: async () => {} },
  permissions: { contains: async () => false },
  storage: { local: { get: async () => ({}), set: async () => {} } },
  sessions: { getTabValue: async () => null, setTabValue: async () => {}, removeTabValue: async () => {} },
  tabs: {
    onUpdated: event(), onActivated: event(), onRemoved: event(),
    query: async () => [], get: async () => { throw new Error("not expected"); },
    sendMessage: async () => ({}), update: async () => {}
  },
  windows: { update: async () => {} },
  notifications: { onClicked: event(), clear: async () => {}, create: async () => {} },
  webRequest: { onHeadersReceived: event() },
  downloads: { onCreated: event(), onChanged: event(), erase: async () => [], search: async () => [] }
};
const context = vm.createContext({ console, crypto: webcrypto, URL, browser, setTimeout, clearTimeout });
context.globalThis = context;
for (const relative of [
  "extension/shared/protocol.js", "extension/shared/settings.js", "extension/shared/local_actions.js",
  "extension/shared/settings_snapshots.js", "extension/shared/working_session.js", "extension/shared/recovery.js",
  "extension/background/background.js"
]) {
  vm.runInContext(fs.readFileSync(path.join(root, relative), "utf8"), context, { filename: relative });
}
assert.equal(typeof requestListener, "function");
const Message = context.FCI_PROTOCOL.MESSAGE;

(async () => {
  const shellFromContent = await requestListener(
    { type: Message.RUN_SHELL, tabId: 1, cwd: "/tmp", command: "true" },
    { tab: { id: 1 }, url: "https://ai.example.local/chat" }
  );
  assert.equal(shellFromContent.ok, false);
  assert(shellFromContent.error.includes("only from the sidebar"));

  const runtimeFromSidebar = await requestListener(
    { type: Message.CONTENT_RUNTIME_EVENT, payload: { runtime: {} } },
    { url: "moz-extension://phase07/sidebar/sidebar.html" }
  );
  assert.equal(runtimeFromSidebar.ok, false);
  assert(runtimeFromSidebar.error.includes("only from a content script"));

  assert.equal(requestListener({ type: "UNKNOWN" }, {}), undefined);
  const source = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
  assert(source.includes("const sessions = new Map()"));
  assert(source.includes("const shellRuns = new Map()"));
  console.log("PASS: Phase 07 background sender scope and independent tab maps");
})().catch((error) => { console.error(error); process.exitCode = 1; });
