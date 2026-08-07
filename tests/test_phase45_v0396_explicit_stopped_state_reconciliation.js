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

{
  const [major, minor, patch] = manifest.version.split(".").map(Number);
  assert(major > 0 || minor > 39 || (minor === 39 && patch >= 6), `Phase 45 requires version >= 0.39.6, got ${manifest.version}`);
}

for (const token of [
  "async function replaceStoppedTabLocalActionChoice",
  'localActionBinding: ["explicit-tab", "url-route", "default"].includes(source.localActionBinding)',
  'reason: "tab-explicitly-stopped"',
  "discardStoppedConfig = false",
  "message.discardStoppedConfig === true",
  "if (stoppedSnapshot) await clearStoppedTabConfigSnapshot(tab.id)",
  'replaceStoppedTabLocalActionChoice(numericTabId, profile, "explicit-tab")',
  "replaceStoppedTabLocalActionChoice(numericTabId, profile, binding)"
]) assert(background.includes(token), `Missing Phase 45 background contract: ${token}`);

for (const token of [
  "const stoppedConfigBypassTabs = new Set()",
  "discardStoppedConfig: Boolean(",
  "stoppedConfigBypassTabs.has(Number(activationTabId))",
  "const useStoppedConfig = Boolean(stoppedConfig)",
  "const stoppedLocalChoiceMatches = Boolean(stoppedConfig)"
]) assert(sidebar.includes(token), `Missing Phase 45 sidebar contract: ${token}`);

const activateSource = extractFunction(background, "async function activateTab");
assert.doesNotMatch(activateSource, /if \(stoppedSnapshot && !restoreStoppedSnapshot\)[\s\S]*clearStoppedTabConfigSnapshot/,
  "A stopped snapshot must not be deleted before activation succeeds.");
assert.match(activateSource, /sessions\.set\(tab\.id, session\);[\s\S]*persistSession\(session\);[\s\S]*if \(stoppedSnapshot\) await clearStoppedTabConfigSnapshot\(tab\.id\);/,
  "The stopped snapshot must be consumed only after successful activation persistence.");

const snapshot = {
  schema: 1,
  stoppedAt: "2026-08-06T10:00:00.000Z",
  url: "https://chat.example.test/thread/1",
  profileId: "config-1",
  configMode: "tab",
  tabConfig: { marker: "kept-config" },
  effectiveConfig: { marker: "kept-config" },
  localActionProfileId: "local-old",
  localActionBinding: "explicit-tab",
  localActionConfigMode: "tab",
  localActionTabConfig: { shell: { command: "old-tab" } },
  localActionWorkingConfig: { shell: { command: "old-draft" } },
  effectiveLocalActions: { shell: { command: "old-draft" } }
};
let savedSnapshot = null;
const replacementProfile = { id: "local-routed", config: { shell: { command: "routed-command" } } };
const replacementSandbox = {
  loadStoppedTabConfigSnapshot: async () => JSON.parse(JSON.stringify(snapshot)),
  saveStoppedTabConfigSnapshot: async (_tabId, value) => { savedSnapshot = JSON.parse(JSON.stringify(value)); return value; },
  CONFIG_MODE: { PROFILE: "profile" }
};
vm.createContext(replacementSandbox);
vm.runInContext(extractFunction(background, "async function replaceStoppedTabLocalActionChoice"), replacementSandbox);

let storeLoads = 0;
const autoSandbox = {
  Number,
  sessions: new Map(),
  isSupportedUrl: () => true,
  loadStoppedTabConfigSnapshot: async () => snapshot,
  autoActivationDecision: (_tab, status, detail) => ({ status, ...detail }),
  loadStore: async () => { storeLoads += 1; return {}; }
};
vm.createContext(autoSandbox);
vm.runInContext(extractFunction(background, "async function attemptAutoActivation"), autoSandbox);

(async () => {
  await replacementSandbox.replaceStoppedTabLocalActionChoice(77, replacementProfile, "url-route");
  assert.equal(savedSnapshot.profileId, "config-1", "Main configuration snapshot must remain untouched.");
  assert.equal(savedSnapshot.effectiveConfig.marker, "kept-config");
  assert.equal(savedSnapshot.localActionProfileId, "local-routed");
  assert.equal(savedSnapshot.localActionBinding, "url-route");
  assert.equal(savedSnapshot.localActionConfigMode, "profile");
  assert.equal(savedSnapshot.localActionTabConfig, null);
  assert.equal(savedSnapshot.localActionWorkingConfig, null);
  assert.equal(savedSnapshot.effectiveLocalActions.shell.command, "routed-command");

  const decision = await autoSandbox.attemptAutoActivation({ id: 77, url: snapshot.url }, "background-startup");
  assert.equal(decision.status, "skipped");
  assert.equal(decision.reason, "tab-explicitly-stopped");
  assert.equal(storeLoads, 0, "Stopped tabs must be rejected before URL routing/default activation is evaluated.");

  console.log("PASS: Phase 45 explicit stopped state blocks auto-activation, reconciles profile choices and consumes snapshots only after successful Start");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
