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
    id: "phase28-v02813",
    getURL(relative) { return `moz-extension://phase28-v02813/${relative}`; },
    onMessage: event((fn) => { requestListener = fn; }),
    lastError: null,
    connectNative() { throw new Error("Native Host must not be needed for dashboard bootstrap"); },
    sendMessage: async () => ({})
  },
  action: { onClicked: event(), setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  sidebarAction: { open: async () => {} },
  permissions: { contains: async () => false, request: async () => false },
  storage: { local: { get: async () => ({}), set: async () => {} } },
  sessions: { getTabValue: async () => null, setTabValue: async () => {}, removeTabValue: async () => {} },
  tabs: {
    onUpdated: event(), onActivated: event(), onRemoved: event(),
    query: async () => [], get: async () => { throw new Error("Unexpected tab lookup"); },
    sendMessage: async () => ({}), update: async () => {}, create: async () => ({ id: 2 })
  },
  windows: { update: async () => {} },
  notifications: { onClicked: event(), clear: async () => {}, create: async () => {} },
  webRequest: { onHeadersReceived: event() },
  downloads: {
    onCreated: event(), onChanged: event(), erase: async () => [], search: async () => [],
    download: async () => 1, cancel: async () => {}
  },
  scripting: { executeScript: async () => [], insertCSS: async () => {} }
};
const context = vm.createContext({
  console, crypto: webcrypto, URL, browser, setTimeout, clearTimeout, TextEncoder, TextDecoder, Blob
});
context.globalThis = context;
for (const relative of [
  "extension/shared/protocol.js", "extension/shared/settings.js", "extension/shared/local_actions.js",
  "extension/shared/settings_snapshots.js", "extension/shared/working_session.js", "extension/shared/recovery.js",
  "extension/shared/support_bundle.js", "extension/background/background.js"
]) {
  vm.runInContext(fs.readFileSync(path.join(root, relative), "utf8"), context, { filename: relative });
}
assert.equal(typeof requestListener, "function", "background request listener was not registered");
const Message = context.FCI_PROTOCOL.MESSAGE;

(async () => {
  const response = await requestListener(
    { type: Message.GET_DASHBOARD },
    { url: "moz-extension://phase28-v02813/sidebar/sidebar.html" }
  );
  assert.equal(response?.ok, true, response?.error || "GET_DASHBOARD failed");
  assert.ok(response.dashboard, "GET_DASHBOARD returned no dashboard");
  assert.equal(response.dashboard.protocolVersion, context.FCI_PROTOCOL.VERSION);
  assert.deepEqual(Array.from(response.dashboard.sessions), []);
  assert.equal(response.dashboard.currentTab.tabId, null);
  assert.equal(response.dashboard.nativeHost.connected, false);

  const invalidSender = await requestListener(
    { type: Message.GET_DASHBOARD },
    { url: "https://example.invalid/not-sidebar" }
  );
  assert.equal(invalidSender?.ok, false);
  assert.match(invalidSender.error, /valid sidebar/i);

  const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
  const parts = String(manifest.version).split(".").map(Number);
  assert.ok(parts[0] > 0 || parts[1] > 28 || (parts[1] === 28 && parts[2] >= 13));
  console.log("PASS: Phase 28 v0.28.13 background loads and serves a fresh sidebar dashboard after browser restart");
})().catch((error) => { console.error(error); process.exitCode = 1; });
