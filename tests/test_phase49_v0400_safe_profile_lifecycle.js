"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
const sidebar = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));

function versionAtLeast(actual, minimum) {
  const a = String(actual).split(".").map(Number);
  const b = String(minimum).split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index] || 0;
    const right = b[index] || 0;
    if (left !== right) return left > right;
  }
  return true;
}


function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert(start >= 0, `Missing function: ${signature}`);
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
    if (char === '"' || char === "'" || char === "`") { quote = char; continue; }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Unclosed function: ${signature}`);
}

function functionBlock(source, name, nextName) {
  const start = source.indexOf(`  async function ${name}`);
  assert(start >= 0, `Missing ${name}`);
  const end = nextName ? source.indexOf(`  async function ${nextName}`, start + 1) : source.length;
  assert(end > start, `Could not bound ${name}`);
  return source.slice(start, end);
}

assert(versionAtLeast(manifest.version, "0.40.0"));
assert(background.includes("async function reconcileDeletedAutomationProfileTabs"));
assert(background.includes("async function reconcileDeletedLocalActionProfileTabs"));
assert(background.includes('session.configMode = CONFIG_MODE.TAB;'));
assert(background.includes('session.localActionConfigMode = CONFIG_MODE.TAB;'));
assert(background.includes('"profile-deleted-config-preserved"'));
assert(background.includes('"local-action-profile-deleted-config-preserved"'));
assert(background.includes("await clearTabLocalActionProfileId(tab.id);"));
assert(!background.includes("async function replaceDeletedTabLocalActionBindings"));

const deleteAutomation = functionBlock(background, "deleteProfile", "refreshSessionsForStore");
assert(deleteAutomation.includes("reconcileDeletedAutomationProfileTabs(profileToDelete, saved)"));
assert(!deleteAutomation.includes("session.profileId = saved.defaultProfileId"));
assert(!deleteAutomation.includes("session.tabConfig = null"));

const deleteLocal = functionBlock(background, "deleteLocalActionProfile", "updateProfileSessions");
assert(deleteLocal.includes("const previousStore = LocalActions.clone(store);"));
assert(deleteLocal.includes("reconcileDeletedLocalActionProfileTabs(profileToDelete, previousStore, saved)"));
assert(!deleteLocal.includes("replaceDeletedTabLocalActionBindings"));

const importStart = background.indexOf('if (type === "local-action") {', background.indexOf("async function importProfileBundle"));
const importEnd = background.indexOf("    const store = await loadStore();", importStart);
const localImport = background.slice(importStart, importEnd);
assert(localImport.includes("Imported profile data must not erase per-tab working drafts"));
assert(!localImport.includes("clearWorkingLocalActionSnapshot(session)"));
assert(!localImport.includes("localActionRevision"));

assert(sidebar.includes("async function deleteSelectedAutomationProfile()"));
assert(sidebar.includes("async function deleteSelectedLocalActionProfile()"));
assert(sidebar.includes("Their current values will be preserved as tab-specific overrides."));
assert(sidebar.includes("Their download and shell values will be preserved as tab-specific overrides."));
assert(sidebar.includes('elements.deleteProfileButton.addEventListener("click", () => void deleteSelectedAutomationProfile())'));
assert(sidebar.includes('elements.deleteLocalActionProfileButton.addEventListener("click", () => void deleteSelectedLocalActionProfile())'));
assert(sidebar.includes("tab override preserved"));

(async () => {
  const automationSession = {
    tabId: 7, url: "https://example.test/chat", profileId: "deleted-auto",
    configMode: "profile", tabConfig: null, configRevision: 1, mode: "active"
  };
  const automationSandbox = {
    Settings: {
      routeProfile: (store) => ({ profile: store.profiles[0] }),
      profileById: (store, id) => store.profiles.find((profile) => profile.id === id) || null,
      normalizeConfig: (config) => JSON.parse(JSON.stringify(config))
    },
    sessions: new Map([[7, automationSession]]),
    browser: { tabs: { query: async () => [{ id: 7, url: automationSession.url }] } },
    CONFIG_MODE: { TAB: "tab" }, MODE: { ERROR: "error" },
    appendLog() {}, applySessionToContent: async () => {}, persistSession: async () => {}, updateBadge: async () => {},
    loadStoppedTabConfigSnapshot: async () => null, saveStoppedTabConfigSnapshot: async () => {}
  };
  vm.createContext(automationSandbox);
  vm.runInContext(extractFunction(background, "function replacementAutomationProfile"), automationSandbox);
  vm.runInContext(extractFunction(background, "async function reconcileDeletedAutomationProfileTabs"), automationSandbox);
  const autoPreserved = await automationSandbox.reconcileDeletedAutomationProfileTabs(
    { id: "deleted-auto", name: "Deleted", config: { marker: "keep-auto" } },
    { defaultProfileId: "replacement-auto", profiles: [{ id: "replacement-auto", name: "Replacement", config: {} }] }
  );
  assert.equal(autoPreserved, 1);
  assert.equal(automationSession.profileId, "replacement-auto");
  assert.equal(automationSession.configMode, "tab");
  assert.equal(automationSession.tabConfig.marker, "keep-auto");

  const localSession = {
    tabId: 9, url: "https://example.test/chat", localActionProfileId: "deleted-local",
    localActionConfigMode: "profile", localActionTabConfig: null, localActionRevision: 2
  };
  let bindingCleared = false;
  const localSandbox = {
    LocalActions: {
      routeProfile: (store) => ({ matched: true, profile: store.profiles[0] }),
      profileById: (store, id) => store.profiles.find((profile) => profile.id === id) || null,
      normalizeConfig: (config) => JSON.parse(JSON.stringify(config))
    },
    sessions: new Map([[9, localSession]]),
    browser: {
      tabs: { query: async () => [{ id: 9, url: localSession.url }] },
      sessions: { getTabValue: async () => "deleted-local" }
    },
    TAB_LOCAL_ACTION_PROFILE_KEY: "binding", CONFIG_MODE: { TAB: "tab" },
    clearTabLocalActionProfileId: async () => { bindingCleared = true; },
    sessionLocalActionConfig: () => ({ shell: { command: "keep-command" } }),
    clearWorkingLocalActionSnapshot() {}, appendLog() {}, persistSession: async () => {},
    loadStoppedTabConfigSnapshot: async () => null, saveStoppedTabConfigSnapshot: async () => {}
  };
  vm.createContext(localSandbox);
  vm.runInContext(extractFunction(background, "function replacementLocalActionProfile"), localSandbox);
  vm.runInContext(extractFunction(background, "async function reconcileDeletedLocalActionProfileTabs"), localSandbox);
  const localPreserved = await localSandbox.reconcileDeletedLocalActionProfileTabs(
    { id: "deleted-local", name: "Deleted local", config: {} },
    { defaultProfileId: "deleted-local", profiles: [{ id: "deleted-local", config: {} }] },
    { defaultProfileId: "replacement-local", profiles: [{ id: "replacement-local", name: "Replacement local", config: {} }] }
  );
  assert.equal(localPreserved, 1);
  assert.equal(bindingCleared, true);
  assert.equal(localSession.localActionProfileId, "replacement-local");
  assert.equal(localSession.localActionConfigMode, "tab");
  assert.equal(localSession.localActionTabConfig.shell.command, "keep-command");

  console.log("PASS: Phase 49 safe profile lifecycle preserves active and stopped tab values during profile deletion and keeps Local action drafts across bundle import");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
