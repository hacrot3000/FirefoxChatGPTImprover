#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const background = read("extension/background/background.js");
const manifest = JSON.parse(read("extension/manifest.json"));

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert(start >= 0, `Missing ${signature}`);
  const closeParen = source.indexOf(")", start + signature.length);
  const brace = source.indexOf("{", closeParen >= 0 ? closeParen : start);
  assert(brace >= 0, `Missing body for ${signature}`);
  let depth = 0;
  let quote = null;
  let escaped = false;
  let templateDepth = 0;
  for (let i = brace; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (quote === "`" && ch === "$" && source[i + 1] === "{") { templateDepth += 1; i += 1; continue; }
      if (quote === "`" && ch === "}" && templateDepth > 0) { templateDepth -= 1; continue; }
      if (ch === quote && templateDepth === 0) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Unterminated function ${signature}`);
}

async function main() {
  assert.equal(manifest.version, "0.41.13");

  // An extension-created replacement can emit downloads.onCreated before
  // downloads.download() resolves. Its URL hint must suppress attribution to
  // another armed tab, including when Firefox exposes a redirected finalUrl.
  {
    const starts = new Map([
      ["cap-a", { captureId: "cap-a", tabId: 7, url: "https://example.test/file.zip", startedAtMs: 1000 }],
      ["stale", { captureId: "stale", tabId: 8, url: "https://old.test/file.zip", startedAtMs: -40000 }]
    ]);
    const sandbox = { managedDownloadStarts: starts, Date: { now: () => 1000 }, Number, String, Set };
    vm.createContext(sandbox);
    vm.runInContext(`${extractFunction(background, "function managedDownloadStartMatches")}\nthis.matches = managedDownloadStartMatches;`, sandbox);
    assert.equal(sandbox.matches({ url: "https://example.test/file.zip" }), true);
    assert.equal(sandbox.matches({ url: "https://redirect.test/one", finalUrl: "https://example.test/file.zip" }), true);
    assert.equal(starts.has("stale"), false);
  }

  // onCreated must fail closed while the exact extension-managed start is in
  // flight, rather than letting another capture cancel/restart that download.
  {
    let canceled = 0;
    const sandbox = {
      managedDownloadIds: new Set(),
      browser: { runtime: { id: "fci@test" } },
      managedDownloadStartMatches: () => true,
      captureForDownloadItem: () => ({ tabId: 9 }),
      cancelAndRestartCapturedDownload: async () => { canceled += 1; }
    };
    vm.createContext(sandbox);
    vm.runInContext(`${extractFunction(background, "async function onBrowserDownloadCreated")}\nthis.created = onBrowserDownloadCreated;`, sandbox);
    await sandbox.created({ id: 55, url: "https://example.test/file.zip" });
    assert.equal(canceled, 0);
  }

  // Navigation recovery must never resurrect an older persisted downloading
  // snapshot over a newer terminal in-memory state for the same capture.
  {
    let searches = 0;
    let cleared = 0;
    const inMemory = { tabId: 7, captureId: "cap-1", status: "error", error: "move failed", downloadId: 77 };
    const session = {
      tabId: 7,
      sessionToken: "session-new",
      downloadJob: { tabId: 7, captureId: "cap-1", status: "downloading", downloadId: 77 }
    };
    const sandbox = {
      downloadJobs: new Map([[7, inMemory]]),
      normalizeDownloadState: (raw, tabId) => ({ ...raw, tabId }),
      restoreArmedDownloadCapture: () => { throw new Error("must not restore armed"); },
      resumeInterruptedDownloadMove: async () => { throw new Error("must not resume move"); },
      browser: { downloads: { search: async () => { searches += 1; return []; } } },
      clearDownloadRoutingKeys: () => { cleared += 1; },
      publicDownloadState: (tabId) => ({ ...sandbox.downloadJobs.get(Number(tabId)) }),
      persistSession: async () => {},
      Settings: { nowIso: () => "2026-08-08T12:00:00.000Z" },
      Number, Boolean, String
    };
    vm.createContext(sandbox);
    vm.runInContext(`${extractFunction(background, "async function recoverDownloadJob")}\nthis.recover = recoverDownloadJob;`, sandbox);
    await sandbox.recover(session);
    assert.equal(sandbox.downloadJobs.get(7), inMemory);
    assert.equal(inMemory.status, "error");
    assert.equal(searches, 0);
    assert.equal(cleared, 1);
  }

  // Synchronous postMessage failure must reject immediately and remove the
  // pending request/timer instead of leaking it until timeout.
  {
    let cleared = 0;
    let disconnectReason = null;
    const pending = new Map();
    const port = { postMessage() { throw new Error("dead native port"); } };
    const sandbox = {
      pendingNativeRequests: pending,
      crypto: { randomUUID: () => "req-1" },
      ensureNativePort: () => port,
      handleNativeDisconnect: async (_port, reason) => { disconnectReason = reason; },
      setTimeout: () => 123,
      clearTimeout: () => { cleared += 1; },
      Error, String
    };
    vm.createContext(sandbox);
    vm.runInContext(`${extractFunction(background, "function nativeRequest")}\nthis.request = nativeRequest;`, sandbox);
    await assert.rejects(() => sandbox.request("move_download", {}, 5000), /dead native port/);
    assert.equal(pending.size, 0);
    assert.equal(cleared, 1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(disconnectReason, "dead native port");
  }

  // A failed initial ping must not leave nativePort pointing at an unusable
  // object; the next call must attempt a fresh connection.
  {
    let connects = 0;
    let disconnected = 0;
    const badPort = {
      onMessage: { addListener() {} },
      onDisconnect: { addListener() {} },
      postMessage() { throw new Error("ping failed"); },
      disconnect() { disconnected += 1; }
    };
    const goodPort = {
      onMessage: { addListener() {} },
      onDisconnect: { addListener() {} },
      postMessage() {},
      disconnect() {}
    };
    const sandbox = {
      nativePort: null,
      nativeState: { connected: false },
      NATIVE_HOST_NAME: "host.test",
      browser: { runtime: { connectNative() { connects += 1; return connects === 1 ? badPort : goodPort; } } },
      Settings: { nowIso: () => "2026-08-08T12:00:00.000Z" },
      handleNativeMessage() {},
      handleNativeDisconnect() {},
      Error, String
    };
    vm.createContext(sandbox);
    vm.runInContext(`${extractFunction(background, "function ensureNativePort")}\nthis.ensure = ensureNativePort; this.getPort = () => nativePort;`, sandbox);
    assert.throws(() => sandbox.ensure(), /ping failed/);
    assert.equal(sandbox.getPort(), null);
    assert.equal(disconnected, 1);
    assert.equal(sandbox.ensure(), goodPort);
    assert.equal(connects, 2);
  }


  // Stop-command send failure must converge through disconnect handling rather
  // than leaving the run stuck at `stopping`.
  {
    const run = { tabId: 7, runId: "run-stop", status: "running" };
    const port = { postMessage() { throw new Error("stop send failed"); } };
    let disconnectReason = null;
    let broadcasts = 0;
    const sandbox = {
      assertSidebarSender() {},
      shellRuns: new Map([[7, run]]),
      ensureNativePort: () => port,
      handleNativeDisconnect: async (_port, reason) => { disconnectReason = reason; run.status = "error"; },
      broadcast: async () => { broadcasts += 1; },
      publicShellRun: () => ({ ...run }),
      Number, Error, String
    };
    vm.createContext(sandbox);
    vm.runInContext(`${extractFunction(background, "async function stopShell")}\nthis.stop = stopShell;`, sandbox);
    await assert.rejects(() => sandbox.stop({ tabId: 7 }, {}), /stop send failed/);
    assert.equal(disconnectReason, "stop send failed");
    assert.equal(run.status, "error");
    assert.equal(broadcasts, 0);
  }

  // Automation command state must converge to failed if the Native Host cannot
  // start the command at all; it must not remain stuck at "starting".
  {
    const session = {
      tabId: 7,
      runtime: { ruleRuntimes: { "rule-1": { cycle: 3 } } },
      automationCommandRequestIds: []
    };
    const failedRun = {
      tabId: 7,
      runId: "run-1",
      source: "automation",
      ruleId: "rule-1",
      ruleName: "Rule 1",
      trigger: "match",
      cycle: 3,
      presetId: "preset-1",
      presetName: "Preset 1",
      status: "error",
      returnCode: null,
      endedAt: "2026-08-08T12:00:00.000Z"
    };
    let statEvent = null;
    let broadcastReason = null;
    const sandbox = {
      sessionConfig: () => ({ rules: [{ id: "rule-1", name: "Rule 1", enabled: true, commandAction: { enabled: true, presetId: "preset-1", trigger: "match" } }] }),
      loadLocalActionStore: async () => ({}),
      sessionLocalActionConfig: () => ({ shell: { presets: [{ id: "preset-1", name: "Preset 1", enabled: true, confirmBeforeRun: false, workingDirectory: "/tmp", command: "echo ok", mode: "background" }] } }),
      shellRunForTab: () => failedRun,
      startShellRunForSession: async () => { throw new Error("native unavailable"); },
      recordRuleCommandStatistics: (_session, _run, event) => { statEvent = event; },
      appendLog: () => {},
      persistSession: async () => {},
      broadcast: async (reason) => { broadcastReason = reason; },
      clone: (value) => JSON.parse(JSON.stringify(value)),
      Settings: { nowIso: () => "2026-08-08T12:00:00.000Z" },
      Array, Number, String, Boolean, Error
    };
    vm.createContext(sandbox);
    vm.runInContext(`${extractFunction(background, "async function processAutomationCommandRequest")}\nthis.process = processAutomationCommandRequest;`, sandbox);
    await assert.rejects(() => sandbox.process(session, { requestId: "req-a", ruleId: "rule-1", presetId: "preset-1", trigger: "match", cycle: 3 }, {}), /native unavailable/);
    assert.equal(session.runtime.automationCommandState, "failed");
    assert.equal(session.runtime.lastAutomationCommandError, "native unavailable");
    assert.equal(session.runtime.lastAutomationCommandRun.runId, "run-1");
    assert.equal(statEvent, "error");
    assert.equal(broadcastReason, "automation-command-error");
  }

  assert.match(background, /const managedDownloadStarts = new Map\(\);/);
  assert.match(background, /const job = sameCapture \? inMemoryJob : storedJob;/);
  console.log("PASS: Phase 72 v0.41.13 closes managed replacement, stale recovery, native request/port/stop and automation start races");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
