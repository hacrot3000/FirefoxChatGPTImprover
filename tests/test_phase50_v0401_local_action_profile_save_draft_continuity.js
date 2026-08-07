"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
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
  const end = source.indexOf(`  async function ${nextName}`, start + 1);
  assert(end > start, `Could not bound ${name}`);
  return source.slice(start, end);
}

assert(versionAtLeast(manifest.version, "0.40.1"));
assert(background.includes("function captureWorkingLocalActionDraft(session)"));
assert(background.includes("function restoreWorkingLocalActionDraft(session, rawConfig)"));

const saveBlock = functionBlock(background, "saveLocalActionProfile", "deleteLocalActionProfile");
assert(saveBlock.includes("const preservedDraft = captureWorkingLocalActionDraft(session);"));
assert(saveBlock.includes("if (preservedDraft) restoreWorkingLocalActionDraft(session, preservedDraft);"));
assert(!saveBlock.includes("clearWorkingLocalActionSnapshot(session);\n      session.localActionRevision"));

const sandbox = {
  LocalActions: {
    normalizeConfig: (config) => JSON.parse(JSON.stringify(config)),
    clone: (config) => JSON.parse(JSON.stringify(config)),
    configFingerprint: (config) => JSON.stringify(config)
  },
  Settings: { nowIso: () => "2026-08-07T10:00:00.000Z" },
  volatileLocalActionDrafts: new Map(),
  currentLocalActionContext(session) {
    return {
      sessionToken: session.sessionToken,
      localActionRevision: session.localActionRevision,
      localActionProfileId: session.localActionProfileId,
      localActionConfigMode: session.localActionConfigMode,
      pageUrl: session.url
    };
  }
};
sandbox.localActionContextMatches = (session, context) => {
  const current = sandbox.currentLocalActionContext(session);
  return String(context.sessionToken || "") === current.sessionToken &&
    Number(context.localActionRevision || 0) === current.localActionRevision &&
    String(context.localActionProfileId || "") === current.localActionProfileId &&
    String(context.localActionConfigMode || "profile") === current.localActionConfigMode;
};
vm.createContext(sandbox);
vm.runInContext(extractFunction(background, "function captureWorkingLocalActionDraft"), sandbox);
vm.runInContext(extractFunction(background, "function restoreWorkingLocalActionDraft"), sandbox);

const session = {
  tabId: 44,
  url: "https://example.test/chat",
  sessionToken: "session-44",
  localActionRevision: 8,
  localActionProfileId: "local-profile-a",
  localActionConfigMode: "profile",
  localActionWorkingConfig: { download: { destination: "/keep" }, shell: { command: "keep-current" } },
  localActionWorkingContext: {
    sessionToken: "session-44",
    localActionRevision: 8,
    localActionProfileId: "local-profile-a",
    localActionConfigMode: "profile"
  }
};
const captured = sandbox.captureWorkingLocalActionDraft(session);
assert.equal(captured.shell.command, "keep-current");
session.localActionRevision += 1;
assert.equal(sandbox.restoreWorkingLocalActionDraft(session, captured), true);
assert.equal(session.localActionWorkingConfig.shell.command, "keep-current");
assert.equal(session.localActionWorkingContext.localActionRevision, 9);
assert.equal(sandbox.volatileLocalActionDrafts.get(44).config.download.destination, "/keep");
assert.equal(sandbox.volatileLocalActionDrafts.get(44).context.localActionRevision, 9);

console.log("PASS: Phase 50 Local action profile saves preserve and rebase per-tab working drafts instead of deleting unsaved path/command values");
