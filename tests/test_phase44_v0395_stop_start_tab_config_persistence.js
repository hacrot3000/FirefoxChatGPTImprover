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
  'TAB_STOPPED_CONFIG_KEY = "firefoxChatImprover.stoppedTabConfig.v1"',
  "saveStoppedTabConfigSnapshot(tabId, snapshot)",
  "loadStoppedTabConfigSnapshot(tab.id)",
  "applyStoppedTabConfigSnapshot(session, stoppedSnapshot, store, localStore)",
  'broadcast("stopped-config-preserved", tabId)',
  'broadcast(restoreStoppedSnapshot ? "stopped-config-restored" : "activated", tab.id)',
  "currentTabMeta.stoppedConfig = currentStoppedConfig ? clone(currentStoppedConfig) : null",
  "await stopTab(Number(message.tabId), null, message.drafts || null)"
]) assert(background.includes(token), `Missing stopped-tab snapshot contract: ${token}`);

for (const token of [
  "function stopSelectedTab()",
  "config: readConfig()",
  "localActions: readLocalActionConfig()",
  "dashboard.currentTab?.stoppedConfig",
  "stoppedConfig?.effectiveConfig",
  "stoppedConfig?.effectiveLocalActions",
  "restoreStoppedConfig: Boolean("
]) assert(sidebar.includes(token), `Missing sidebar Stop/Start preservation contract: ${token}`);

assert.match(background, /saveStoppedTabConfigSnapshot\(tabId, snapshot\)[\s\S]*browser\.tabs\.sendMessage\(tabId, \{ type: MESSAGE\.CONTENT_STOP \}\)[\s\S]*removePersistedSession\(tabId\)/);
assert.match(sidebar, /tabStopQuickButton\.addEventListener\("click", stopSelectedTab\)/);
assert.match(sidebar, /stopButton\.addEventListener\("click", stopSelectedTab\)/);

const clone = (value) => JSON.parse(JSON.stringify(value));
const normalizeConfig = (value = {}) => ({
  activation: { urlPatterns: ["https://chat.example.test/*"], ...(value.activation || {}) },
  rules: Array.isArray(value.rules) ? clone(value.rules) : [],
  marker: value.marker || "base"
});
const normalizeLocal = (value = {}) => ({
  routing: value.routing || {},
  download: value.download || {},
  shell: { command: "", workingDirectory: "", ...(value.shell || {}) }
});
const fingerprint = (value) => JSON.stringify(value);
const store = {
  defaultProfileId: "profile-default",
  profiles: [
    { id: "profile-default", config: normalizeConfig({ marker: "default" }) },
    { id: "profile-tab", config: normalizeConfig({ marker: "profile-original" }) }
  ]
};
const localStore = {
  defaultProfileId: "local-default",
  profiles: [
    { id: "local-default", config: normalizeLocal({ shell: { command: "default" } }) },
    { id: "local-tab", config: normalizeLocal({ shell: { command: "profile-command" } }) }
  ]
};

const sandbox = {
  CONFIG_MODE: { PROFILE: "profile", TAB: "tab" },
  Settings: {
    nowIso: () => "2026-08-06T10:00:00.000Z",
    normalizeConfig,
    defaultConfig: () => normalizeConfig(),
    validateConfig: (raw) => ({ ok: true, config: normalizeConfig(raw), errors: [] }),
    urlAllowed: (_config, url) => String(url).startsWith("https://chat.example.test/"),
    profileById: (candidateStore, id) => candidateStore.profiles.find((item) => item.id === id) || null
  },
  WorkingSession: { configFingerprint: (raw) => fingerprint(normalizeConfig(raw)) },
  LocalActions: {
    normalizeConfig: normalizeLocal,
    defaultConfig: () => normalizeLocal(),
    validateConfig: (raw) => ({ ok: true, config: normalizeLocal(raw), errors: [] }),
    configFingerprint: (raw) => fingerprint(normalizeLocal(raw)),
    profileById: (candidateStore, id) => candidateStore.profiles.find((item) => item.id === id) || null
  },
  sessionConfig: (session, candidateStore) => session.configMode === "tab" && session.tabConfig
    ? normalizeConfig(session.tabConfig)
    : normalizeConfig(candidateStore.profiles.find((item) => item.id === session.profileId).config),
  sessionLocalActionConfig: (session, candidateStore) => session.localActionWorkingConfig
    ? normalizeLocal(session.localActionWorkingConfig)
    : (session.localActionConfigMode === "tab" && session.localActionTabConfig
      ? normalizeLocal(session.localActionTabConfig)
      : normalizeLocal(candidateStore.profiles.find((item) => item.id === session.localActionProfileId).config)),
  normalizeWorkingLocalActionSnapshot: (session) => session.localActionWorkingConfig ? normalizeLocal(session.localActionWorkingConfig) : null,
  currentLocalActionContext: (session) => ({
    sessionToken: session.sessionToken,
    localActionRevision: session.localActionRevision,
    localActionProfileId: session.localActionProfileId,
    localActionConfigMode: session.localActionConfigMode,
    pageUrl: session.url
  })
};
vm.createContext(sandbox);
for (const signature of [
  "function configFingerprint",
  "function normalizeStoppedTabConfigSnapshot",
  "function stoppedTabConfigSnapshot",
  "function applyStoppedTabConfigSnapshot"
]) vm.runInContext(extractFunction(background, signature), sandbox);

const running = {
  tabId: 77,
  url: "https://chat.example.test/thread/1",
  profileId: "profile-tab",
  configMode: "profile",
  tabConfig: null,
  configRevision: 8,
  localActionProfileId: "local-tab",
  localActionConfigMode: "profile",
  localActionTabConfig: null,
  localActionRevision: 9,
  localActionWorkingConfig: normalizeLocal({ shell: { command: "draft-command", workingDirectory: "/tmp/work" } }),
  localActionWorkingContext: {},
  sessionToken: "old-session"
};
const monitorDraft = normalizeConfig({ marker: "unsaved-tab-draft", rules: [{ id: "rule-1" }] });
const localDraft = normalizeLocal({ shell: { command: "draft-command", workingDirectory: "/tmp/work" }, download: { destinationDirectory: "/tmp/download" } });
const snapshot = sandbox.stoppedTabConfigSnapshot(running, store, localStore, {
  config: monitorDraft,
  localActions: localDraft
});
assert.equal(snapshot.configMode, "tab");
assert.equal(snapshot.effectiveConfig.marker, "unsaved-tab-draft");
assert.equal(snapshot.localActionProfileId, "local-tab");
assert.equal(snapshot.localActionWorkingConfig.shell.command, "draft-command");
assert.equal(snapshot.effectiveLocalActions.download.destinationDirectory, "/tmp/download");

const restarted = {
  tabId: 77,
  url: running.url,
  profileId: "profile-default",
  configMode: "profile",
  tabConfig: null,
  configRevision: 1,
  localActionProfileId: "local-default",
  localActionConfigMode: "profile",
  localActionTabConfig: null,
  localActionRevision: 1,
  localActionWorkingConfig: null,
  localActionWorkingContext: null,
  sessionToken: "new-session"
};
sandbox.applyStoppedTabConfigSnapshot(restarted, snapshot, store, localStore);
assert.equal(restarted.profileId, "profile-tab");
assert.equal(restarted.configMode, "tab");
assert.equal(restarted.tabConfig.marker, "unsaved-tab-draft");
assert.equal(restarted.localActionProfileId, "local-tab");
assert.equal(restarted.localActionWorkingConfig.shell.command, "draft-command");
assert.equal(restarted.localActionWorkingContext.sessionToken, "new-session");
assert.equal(restarted.localActionWorkingContext.localActionProfileId, "local-tab");

const profileSnapshot = sandbox.stoppedTabConfigSnapshot({
  ...running,
  localActionWorkingConfig: null,
  localActionWorkingContext: null
}, store, localStore, null);
const sameProfiles = { ...store, profiles: clone(store.profiles) };
const sameLocalProfiles = { ...localStore, profiles: clone(localStore.profiles) };
const restartedProfileMode = { ...restarted, sessionToken: "profile-session" };
sandbox.applyStoppedTabConfigSnapshot(restartedProfileMode, profileSnapshot, sameProfiles, sameLocalProfiles);
assert.equal(restartedProfileMode.configMode, "profile");
assert.equal(restartedProfileMode.tabConfig, null);
assert.equal(restartedProfileMode.localActionConfigMode, "profile");
assert.equal(restartedProfileMode.localActionTabConfig, null);

const changedProfiles = clone(store);
changedProfiles.profiles.find((item) => item.id === "profile-tab").config.marker = "profile-changed-while-stopped";
const changedLocalProfiles = clone(localStore);
changedLocalProfiles.profiles.find((item) => item.id === "local-tab").config.shell.command = "profile-command-changed";
const frozen = { ...restarted, sessionToken: "frozen-session", localActionWorkingConfig: null, localActionWorkingContext: null };
sandbox.applyStoppedTabConfigSnapshot(frozen, profileSnapshot, changedProfiles, changedLocalProfiles);
assert.equal(frozen.configMode, "tab");
assert.equal(frozen.tabConfig.marker, "profile-original");
assert.equal(frozen.localActionConfigMode, "tab");
assert.equal(frozen.localActionTabConfig.shell.command, "profile-command");

{
  const [major, minor, patch] = manifest.version.split(".").map(Number);
  assert(major > 0 || minor > 39 || (minor === 39 && patch >= 5));
}

console.log("PASS: Phase 44 Stop/Start preserves per-tab configuration, tab drafts and Local action working state without default fallback");
