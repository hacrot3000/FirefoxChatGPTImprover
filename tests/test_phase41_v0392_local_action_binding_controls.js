"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.resolve(__dirname, "..");
const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
const sidebar = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
const html = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
const protocol = fs.readFileSync(path.join(root, "extension/shared/protocol.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));

function extractFunction(source, declaration) {
  const start = source.indexOf(declaration);
  assert(start >= 0, `Missing ${declaration}`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Unterminated ${declaration}`);
}

{
  const [major, minor, patch] = manifest.version.split(".").map(Number);
  assert(
    major > 0 || minor > 39 || (minor === 39 && patch >= 2),
    `Phase 41 contract requires version >= 0.39.2, got ${manifest.version}`
  );
}
assert.match(protocol, /VERSION: 26/);
assert(protocol.includes('CLEAR_LOCAL_ACTION_PROFILE_BINDING: "FCI_CLEAR_LOCAL_ACTION_PROFILE_BINDING"'));
assert(html.includes('id="clearLocalActionProfileBindingButton"'));
assert(sidebar.includes('effectiveBinding === "explicit-tab"'));
assert(sidebar.includes('"URL-routed profile"'));
assert(sidebar.includes('"Default profile"'));
assert(sidebar.includes('MESSAGE.CLEAR_LOCAL_ACTION_PROFILE_BINDING'));
assert(background.includes('async function clearTabLocalActionProfileId'));
assert(background.includes('async function clearLocalActionProfileBinding'));
assert(background.includes('currentExplicitLocalActionProfileId'));
assert(background.includes('publicValue.localActionProfileBinding = explicitProfileId'));

const tabValues = new Map([["7:binding", "explicit"]]);
const sessions = new Map();
const broadcasts = [];
const persisted = [];
const profiles = [
  { id: "default", name: "Default", config: {} },
  { id: "routed", name: "Routed", config: {} },
  { id: "explicit", name: "Explicit", config: {} }
];
const localStore = { defaultProfileId: "default", profiles };
const sandbox = {
  Number, String, Promise,
  sessions,
  TAB_LOCAL_ACTION_PROFILE_KEY: "binding",
  loadLocalActionStore: async () => localStore,
  LocalActions: {
    routeProfile: (_store, url) => url.includes("route") ? { matched: true, profile: profiles[1] } : { matched: false, profile: null },
    profileById: (store, id) => store.profiles.find((item) => item.id === id) || null
  },
  browser: {
    tabs: { get: async (tabId) => ({ id: Number(tabId), url: Number(tabId) === 7 ? "https://route.test/" : "https://plain.test/" }) },
    sessions: { removeTabValue: async (tabId, key) => tabValues.delete(`${tabId}:${key}`) }
  },
  broadcast: async (...args) => broadcasts.push(args),
  clearWorkingLocalActionSnapshot(session) { session.localActionWorkingConfig = null; },
  CONFIG_MODE: { PROFILE: "profile" },
  appendLog() {},
  persistSession: async (session) => persisted.push(session.localActionProfileId)
};
vm.createContext(sandbox);
vm.runInContext(extractFunction(background, "async function clearTabLocalActionProfileId"), sandbox);
vm.runInContext(extractFunction(background, "async function clearLocalActionProfileBinding"), sandbox);

(async () => {
  const stopped = await sandbox.clearLocalActionProfileBinding(7);
  assert.deepEqual(JSON.parse(JSON.stringify(stopped)), { profileId: "routed", binding: "url-route", pendingActivation: true });
  assert.equal(tabValues.has("7:binding"), false);

  sessions.set(8, {
    tabId: 8,
    localActionProfileId: "explicit",
    localActionConfigMode: "tab",
    localActionTabConfig: { any: true },
    localActionRevision: 2,
    localActionWorkingConfig: { draft: true }
  });
  tabValues.set("8:binding", "explicit");
  const active = await sandbox.clearLocalActionProfileBinding(8);
  assert.deepEqual(JSON.parse(JSON.stringify(active)), { profileId: "default", binding: "default", pendingActivation: false });
  const session = sessions.get(8);
  assert.equal(session.localActionProfileId, "default");
  assert.equal(session.localActionConfigMode, "profile");
  assert.equal(session.localActionTabConfig, null);
  assert.equal(session.localActionRevision, 3);
  assert.deepEqual(persisted, ["default"]);
  assert.deepEqual(broadcasts, [
    ["local-action-profile-binding-cleared", 7],
    ["local-action-profile-binding-cleared", 8]
  ]);
  console.log("PASS: Phase 41 v0.39.2 Local action binding source summary and explicit binding clear behavior");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
