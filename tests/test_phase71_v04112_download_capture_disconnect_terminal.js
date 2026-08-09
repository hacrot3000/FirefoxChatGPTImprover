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
  assert.ok(manifest.version.localeCompare("0.41.12", undefined, { numeric: true }) >= 0);

  // CK is an active managed-download state. A second click must not replace
  // the still-armed capture before Firefox has emitted its download event.
  {
    const sandbox = {
      sessions: new Map([[7, { tabId: 7 }]]),
      downloadJobs: new Map([[7, { tabId: 7, captureId: "cap-old", status: "armed" }]]),
      loadLocalActionStore: async () => ({}),
      sessionLocalActionResolution: () => ({ config: { download: { enabled: true } } }),
      Number
    };
    vm.createContext(sandbox);
    vm.runInContext(`${extractFunction(background, "async function armDownloadCapture")}\nthis.arm = armDownloadCapture;`, sandbox);
    const result = await sandbox.arm(7, {});
    assert.equal(result.armed, false);
    assert.equal(result.blocked, true);
    assert.equal(result.status, "armed");
  }

  // downloads.onCreated has no tabId. If multiple armed tabs from the same
  // origin match, fail closed instead of guessing by recency.
  {
    const captures = new Map([
      [7, { tabId: 7, captureId: "a", origin: "https://example.test", armedAtMs: 10, claimed: false }],
      [8, { tabId: 8, captureId: "b", origin: "https://example.test", armedAtMs: 20, claimed: false }]
    ]);
    const sandbox = {
      downloadCaptures: captures,
      activeDownloadCapture: (tabId) => captures.get(Number(tabId)) || null,
      Number,
      String
    };
    vm.createContext(sandbox);
    vm.runInContext(`${extractFunction(background, "function captureForDownloadItem")}\nthis.pick = captureForDownloadItem;`, sandbox);
    const picked = sandbox.pick({ referrer: "https://example.test/chat", url: "https://example.test/file.zip" });
    assert.equal(picked, null);
    captures.delete(8);
    assert.equal(sandbox.pick({ referrer: "https://example.test/chat", url: "https://example.test/file.zip" }).tabId, 7);
  }

  // Native disconnect is a real terminal shell event. Download-shell state,
  // automation runtime/statistics, history and persisted notices must converge.
  {
    const port = {};
    let rejected = "";
    const sessions = new Map([
      [7, { tabId: 7, runtime: {}, shellHistory: [] }],
      [8, { tabId: 8, runtime: {}, shellHistory: [] }]
    ]);
    const shellRuns = new Map([
      [7, { tabId: 7, runId: "run-download", source: "download", captureId: "cap", status: "running", output: [], logBytes: 12 }],
      [8, { tabId: 8, runId: "run-auto", source: "automation", ruleId: "rule-1", ruleName: "Rule 1", trigger: "match", cycle: 3, presetId: "preset-1", presetName: "Preset 1", status: "running", output: [] }]
    ]);
    const downloadJobs = new Map([[7, { tabId: 7, shellRunId: "run-download", shellStatus: "running", shellLogBytes: 4 }]]);
    const sandbox = {
      nativePort: port,
      nativeState: { connected: true },
      browser: { runtime: { lastError: { message: "Native link lost" } } },
      Settings: { nowIso: () => "2026-08-08T11:00:00.000Z" },
      loadLocalActionStore: async () => ({}),
      sessionLocalActionConfig: () => ({ shell: { rememberHistory: true, historyLimit: 20 } }),
      shellRuns,
      sessions,
      downloadJobs,
      runToTab: new Map([["run-download", 7], ["run-auto", 8]]),
      pendingNativeRequests: new Map([["pending", { timer: 1, reject: (error) => { rejected = error.message; } }]]),
      clearTimeout() {},
      appendShellOutput(run, _stream, text) { run.output.push({ text }); },
      syncShellHistory(session, run) { session.historySynced = run.status; },
      syncShellNoticeFromRun(session, run, event) { session.noticeSynced = `${run.runId}:${event}`; },
      publicDownloadState: (tabId) => ({ ...downloadJobs.get(Number(tabId)) }),
      recordRuleCommandStatistics(session, _run, event) { session.statEvent = event; },
      appendLog(session, _level, event) { session.lastLogEvent = event; },
      persistSession: async (session) => { session.persisted = true; },
      publishShellNotice: async (session, options) => { session.publishedReason = options.reason; },
      scheduleNativeLogCleanup: (reason) => { sandbox.cleanupReason = reason; },
      broadcast: async (reason) => { sandbox.broadcastReason = reason; },
      Number,
      String,
      Math
    };
    vm.createContext(sandbox);
    vm.runInContext(`${extractFunction(background, "async function handleNativeDisconnect")}\nthis.disconnect = handleNativeDisconnect;`, sandbox);
    await sandbox.disconnect(port);
    assert.equal(shellRuns.get(7).status, "error");
    assert.equal(downloadJobs.get(7).shellStatus, "error");
    assert.equal(downloadJobs.get(7).shellError, "Native link lost");
    assert.equal(sessions.get(7).historySynced, "error");
    assert.equal(sessions.get(7).persisted, true);
    assert.equal(sessions.get(8).runtime.automationCommandState, "failed");
    assert.equal(sessions.get(8).statEvent, "error");
    assert.equal(sessions.get(8).lastLogEvent, "shell-error");
    assert.equal(sandbox.runToTab.size, 0);
    assert.equal(sandbox.pendingNativeRequests.size, 0);
    assert.equal(rejected, "Native link lost");
    assert.equal(sandbox.cleanupReason, "native-disconnected");
    assert.equal(sandbox.broadcastReason, "native-disconnected");
  }

  assert.match(background, /port\.onDisconnect\.addListener\(\(\) => \{ void handleNativeDisconnect\(port\); \}\);/);
  console.log("PASS: Phase 71 v0.41.12 closes CK overlap, ambiguous same-origin capture attribution and Native Host disconnect terminal-state gaps");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
