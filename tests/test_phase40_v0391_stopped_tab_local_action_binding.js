#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
const sidebar = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Missing function: ${signature}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Unclosed function: ${signature}`);
}

for (const token of [
  'TAB_LOCAL_ACTION_PROFILE_KEY = "firefoxChatImprover.localActionProfile.v1"',
  "loadTabLocalActionProfileId(tab.id, localStore)",
  'localActionRouting: boundLocalActionProfile ? "explicit-tab-binding"',
  "currentTabMeta.localActionProfileId = currentSession?.localActionProfileId || currentExplicitLocalActionProfileId",
  "replaceDeletedTabLocalActionBindings(profileId, saved)",
  "saveTabLocalActionProfileId(numericTabId, profile.id)"
]) assert(background.includes(token), `Missing stopped-tab binding contract: ${token}`);

assert.match(sidebar, /const currentTabSelected = Number\(dashboard\.currentTab\?\.tabId\) === Number\(selectedTabId\);/);
assert.match(sidebar, /const selectedTabExists = Boolean\(session\) \|\| currentTabSelected;/);
assert.doesNotMatch(sidebar, /assignLocalActionProfileButton\.disabled = busy \|\| !session;/);
assert.match(sidebar, /currentTabBindingId[\s\S]*dashboard\.currentTab\?\.localActionProfileId/);
assert(sidebar.includes("Local-action profile bound to this stopped tab and will be used on activation."));

const tabValues = new Map();
const broadcasts = [];
const customProfile = { id: "local-custom", name: "Custom", config: {} };
const localStore = { defaultProfileId: "local-default", profiles: [{ id: "local-default", name: "Default", config: {} }, customProfile] };
const sandbox = {
  Number,
  String,
  Promise,
  sessions: new Map(),
  TAB_LOCAL_ACTION_PROFILE_KEY: "firefoxChatImprover.localActionProfile.v1",
  loadLocalActionStore: async () => localStore,
  LocalActions: { profileById: (store, id) => store.profiles.find((item) => item.id === id) || null },
  browser: {
    tabs: { get: async (tabId) => ({ id: Number(tabId), url: "https://chat.example.test/" }) },
    sessions: {
      setTabValue: async (tabId, key, value) => tabValues.set(`${tabId}:${key}`, value),
      getTabValue: async (tabId, key) => tabValues.get(`${tabId}:${key}`),
      removeTabValue: async (tabId, key) => tabValues.delete(`${tabId}:${key}`)
    }
  },
  broadcast: async (event, tabId) => broadcasts.push([event, tabId]),
  clearWorkingLocalActionSnapshot() {},
  CONFIG_MODE: { PROFILE: "profile" },
  appendLog() {},
  persistSession: async () => {},
  replaceStoppedTabLocalActionChoice: async () => null
};
vm.createContext(sandbox);
vm.runInContext(extractFunction(background, "async function saveTabLocalActionProfileId"), sandbox);
vm.runInContext(extractFunction(background, "async function assignLocalActionProfile"), sandbox);

(async () => {
  const result = await sandbox.assignLocalActionProfile(77, customProfile.id);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { profileId: customProfile.id, pendingActivation: true });
  assert.equal(tabValues.get(`77:${sandbox.TAB_LOCAL_ACTION_PROFILE_KEY}`), customProfile.id);
  assert.deepEqual(broadcasts, [["local-action-profile-bound", 77]]);
  {
    const [major, minor, patch] = manifest.version.split(".").map(Number);
    assert(
      major > 0 || minor > 39 || (minor === 39 && patch >= 1),
      `Phase 40 contract requires version >= 0.39.1, got ${manifest.version}`
    );
  }
  console.log("PASS: Phase 40 v0.39.1 stopped-tab Local action profile binding, enabled Apply to tab and activation persistence");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
