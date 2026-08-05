#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const bg = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
const sidebar = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
assert.ok(manifest.version.localeCompare("0.28.23", undefined, { numeric: true }) >= 0, `Expected v0.28.23 or newer, got ${manifest.version}`);

function extractFunction(source, name) {
  const asyncStart = source.indexOf(`async function ${name}(`);
  const plainStart = source.indexOf(`function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : plainStart;
  assert.ok(start >= 0, `Function ${name} must exist`);
  const signatureEnd = source.indexOf(") {", start);
  assert.ok(signatureEnd >= 0, `Function ${name} signature must end`);
  const brace = signatureEnd + 2;
  let depth = 0;
  let quote = null;
  let escape = false;
  for (let i = brace; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Unclosed function ${name}`);
}

for (const token of [
  "localActionWorkingConfig", "localActionWorkingContext", "sessionLocalActionResolution",
  "tab-working-draft", "tab-working-snapshot", "localActionContextMatches",
  "await persistSession(session)", "localActionFingerprint: resolution.fingerprint",
  "destinationDirectory: config.download.destinationDirectory"
]) assert(bg.includes(token), `Missing restart-safe local-action contract: ${token}`);
assert.match(bg, /if \(hasContext && !localActionContextMatches\(session, suppliedContext\)\)/);
assert.match(bg, /return \{ stale: true, session: publicSession/);
assert.match(bg, /volatileLocalActionDrafts\.set\(numericTabId, \{ config, context \}\)/);
assert.match(bg, /normalizeWorkingLocalActionSnapshot\(recovered\)/);
assert.ok(bg.indexOf("sessionLocalActionResolution(session, localStore)") < bg.indexOf("const configSnapshot = LocalActions.createExecutionSnapshot(config)"));

for (const token of [
  "function localActionSyncContext", "function cancelScheduledVolatileLocalActionSync",
  "function discardVolatileLocalActionDraft", "context, config, clear",
  "tabId: context.tabId", "if (response.stale)", "discardVolatileLocalActionDraft(previousTabId)"
]) assert(sidebar.includes(token), `Missing tab-bound sidebar sync contract: ${token}`);
assert.ok(sidebar.indexOf("const context = localActionSyncContext();") < sidebar.indexOf("volatileLocalActionSyncTimer = setTimeout"));
assert.doesNotMatch(sidebar, /setTimeout\(\(\) => \{\s*volatileLocalActionSyncTimer = null;\s*void syncVolatileLocalActionDraft\(\);/s);

const clone = (value) => JSON.parse(JSON.stringify(value));
const normalizeConfig = (raw = {}) => ({
  routing: { enabled: Boolean(raw.routing?.enabled) },
  download: {
    enabled: raw.download?.enabled !== false,
    destinationDirectory: String(raw.download?.destinationDirectory || "/tmp/default")
  },
  shell: { command: String(raw.shell?.command || "") }
});
const LocalActions = {
  normalizeConfig,
  clone,
  configFingerprint: (value) => JSON.stringify(normalizeConfig(value)),
  validateConfig: (value) => ({ ok: true, config: normalizeConfig(value), errors: [] }),
  profileById: (store, id) => store.profiles.find((item) => item.id === id) || null
};
const sessions = new Map();
const volatileLocalActionDrafts = new Map();
let persistedCount = 0;
const context = vm.createContext({
  console,
  CONFIG_MODE: { TAB: "tab", PROFILE: "profile" },
  LocalActions,
  Settings: { nowIso: () => "2026-08-05T04:00:00.000Z" },
  sessions,
  volatileLocalActionDrafts,
  loadStore: async () => ({}),
  loadLocalActionStore: async () => ({ defaultProfileId: "local-default", profiles: [{ id: "local-default", config: normalizeConfig({ download: { destinationDirectory: "/home/duongtc/BleToNfc/patchs" } }) }] }),
  publicSession: (session) => clone(session),
  persistSession: async () => { persistedCount += 1; },
  broadcast: async () => {},
  clone
});
context.globalThis = context;
for (const name of [
  "currentLocalActionContext", "localActionContextMatches", "clearWorkingLocalActionSnapshot",
  "normalizeWorkingLocalActionSnapshot", "sessionLocalActionResolution", "setVolatileLocalActionDraft"
]) vm.runInContext(extractFunction(bg, name), context, { filename: `background:${name}` });
vm.runInContext("globalThis.FCI_TEST = { currentLocalActionContext, localActionContextMatches, sessionLocalActionResolution, setVolatileLocalActionDraft };", context);

(async () => {
  const session = {
    tabId: 19,
    sessionToken: "session-naruto",
    localActionRevision: 1,
    localActionProfileId: "local-default",
    localActionConfigMode: "profile",
    localActionTabConfig: null,
    localActionWorkingConfig: null,
    localActionWorkingContext: null,
    url: "https://chatgpt.com/c/naruto"
  };
  sessions.set(19, session);
  const naruto = normalizeConfig({ download: { destinationDirectory: "/home/duongtc/568E/Naruto/server-dockerize/patchs" } });
  const originalContext = context.FCI_TEST.currentLocalActionContext(session);
  const accepted = await context.FCI_TEST.setVolatileLocalActionDraft(19, naruto, false, originalContext);
  assert.equal(accepted.stale, false);
  assert.equal(session.localActionWorkingConfig.download.destinationDirectory, naruto.download.destinationDirectory);
  assert.ok(persistedCount >= 1, "working snapshot must be mirrored to browser.sessions");

  // Simulate a background restart: the in-memory map disappears, persisted tab state remains.
  volatileLocalActionDrafts.clear();
  const store = await context.loadLocalActionStore();
  const recovered = context.FCI_TEST.sessionLocalActionResolution(session, store);
  assert.equal(recovered.source, "tab-working-snapshot");
  assert.equal(recovered.config.download.destinationDirectory, naruto.download.destinationDirectory);

  // A delayed message from another/older sidebar context must not overwrite Naruto with BleToNfc.
  session.sessionToken = "session-naruto-after-recovery";
  const staleBle = normalizeConfig({ download: { destinationDirectory: "/home/duongtc/BleToNfc/patchs" } });
  const rejected = await context.FCI_TEST.setVolatileLocalActionDraft(19, staleBle, false, originalContext);
  assert.equal(rejected.stale, true);
  assert.equal(session.localActionWorkingConfig.download.destinationDirectory, naruto.download.destinationDirectory);

  console.log("PASS: Phase 28 v0.28.23 tab-bound autosync rejects stale BleToNfc context and preserves Naruto destination across background recovery");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
