#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const background = read("extension/background/background.js");
const target = read("extension/content/target.js");
const activation = read("extension/content/activation.js");
const alertSource = read("extension/content/alert.js");
const settingsSource = read("extension/shared/settings.js");
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

function createDocument(title = "Project") {
  return {
    title,
    visibilityState: "visible",
    documentElement: {
      attrs: new Map(),
      getAttribute(name) { return this.attrs.get(name) || ""; },
      setAttribute(name, value) { this.attrs.set(name, String(value)); }
    },
    querySelector() { return null; },
    head: null,
    addEventListener() {},
    removeEventListener() {}
  };
}

async function main() {
  assert.ok(manifest.version.localeCompare("0.41.11", undefined, { numeric: true }) >= 0);
  assert.match(alertSource, /FCI_ALERT_ENGINE\?\.VERSION >= 15/);
  assert.match(alertSource, /VERSION:\s*15/);
  assert.match(target, /FCI_TARGET_ENGINE\?\.VERSION >= 5/);
  assert.match(target, /VERSION:\s*5/);
  assert.match(activation, /const RUNTIME_VERSION = 29;/);

  // Compact RD must not eat a legitimate page title that merely starts with
  // those two letters. Our own [RD] decoration still strips cleanly.
  const alertSandbox = {
    console,
    crypto: webcrypto,
    URL,
    document: createDocument(),
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout() { return 1; },
    clearTimeout() {},
    setInterval() { return 1; },
    clearInterval() {}
  };
  alertSandbox.globalThis = alertSandbox;
  vm.createContext(alertSandbox);
  vm.runInContext(read("extension/shared/protocol.js"), alertSandbox, { filename: "protocol.js" });
  vm.runInContext(settingsSource, alertSandbox, { filename: "settings.js" });
  vm.runInContext(alertSource, alertSandbox, { filename: "alert.js" });
  assert.equal(alertSandbox.FCI_ALERT_ENGINE.stripManagedTitleDecorations("[RD] Project", ["RD"]), "Project");
  assert.equal(alertSandbox.FCI_ALERT_ENGINE.stripManagedTitleDecorations("RD Station", ["RD"]), "RD Station");
  assert.equal(alertSandbox.FCI_ALERT_ENGINE.stripManagedTitleDecorations("RD - Research", ["RD"]), "RD - Research");
  assert.equal(alertSandbox.FCI_ALERT_ENGINE.stripManagedTitleDecorations("[⚠ RD] Project", ["RD"]), "Project");

  // A stale Native Host move response with the right tab but wrong moveId is ignored.
  {
    const sandbox = {
      downloadMoveToTab: new Map([["old-move", 7]]),
      downloadJobs: new Map([[7, { tabId: 7, moveId: "current-move", status: "moving", destinationPath: null }]]),
      sessions: new Map(),
      Number,
      String
    };
    vm.createContext(sandbox);
    vm.runInContext(`${extractFunction(background, "async function handleNativeDownloadMessage")}\nthis.handle = handleNativeDownloadMessage;`, sandbox);
    await sandbox.handle({ event: "download_moved", tabId: 7, moveId: "old-move", destinationPath: "/tmp/wrong.zip" });
    assert.equal(sandbox.downloadJobs.get(7).status, "moving");
    assert.equal(sandbox.downloadJobs.get(7).destinationPath, null);
    assert.equal(sandbox.downloadMoveToTab.has("old-move"), false);
  }

  // Completion survives a transient downloads.search() failure.
  {
    const sandbox = {
      downloadMoveToTab: new Map([[41, 7]]),
      managedDownloadIds: new Set([41]),
      downloadJobs: new Map([[7, { tabId: 7, downloadId: 41, status: "downloading", sourcePath: "/tmp/file.zip" }]]),
      browser: { downloads: { search: async () => { throw new Error("temporary search failure"); } } },
      cleanDownloadFilename(value) { return path.basename(String(value)); },
      clearDownloadRoutingKeys() {},
      persistDownloadState: async () => {},
      broadcast: async () => {},
      moveCompletedDownload: async (tabId, item) => { sandbox.moved = { tabId, item }; },
      Settings: { nowIso: () => "2026-08-08T00:00:00.000Z" },
      Number,
      String
    };
    vm.createContext(sandbox);
    vm.runInContext(`${extractFunction(background, "async function onBrowserDownloadChanged")}\nthis.changed = onBrowserDownloadChanged;`, sandbox);
    await sandbox.changed({ id: 41, state: { current: "complete" } });
    assert.equal(sandbox.moved.tabId, 7);
    assert.equal(sandbox.moved.item.id, 41);
    assert.equal(sandbox.moved.item.filename, "/tmp/file.zip");
  }

  // An obsolete browser downloadId cannot mutate a newer job for the same tab.
  {
    const sandbox = {
      downloadMoveToTab: new Map([[40, 7]]),
      managedDownloadIds: new Set([40]),
      downloadJobs: new Map([[7, { tabId: 7, downloadId: 41, status: "downloading", sourcePath: "/tmp/new.zip" }]]),
      browser: { downloads: { search: async () => [] } },
      cleanDownloadFilename(value) { return path.basename(String(value)); },
      clearDownloadRoutingKeys() {},
      persistDownloadState: async () => {},
      broadcast: async () => {},
      moveCompletedDownload: async () => { throw new Error("stale event must not move"); },
      Settings: { nowIso: () => "2026-08-08T00:00:00.000Z" },
      Number,
      String
    };
    vm.createContext(sandbox);
    vm.runInContext(`${extractFunction(background, "async function onBrowserDownloadChanged")}\nthis.changed = onBrowserDownloadChanged;`, sandbox);
    await sandbox.changed({ id: 40, state: { current: "complete" } });
    assert.equal(sandbox.downloadJobs.get(7).downloadId, 41);
    assert.equal(sandbox.downloadJobs.get(7).status, "downloading");
    assert.equal(sandbox.downloadMoveToTab.has(40), false);
    assert.equal(sandbox.managedDownloadIds.has(40), false);
  }

  // A second managed click while DL/MV is blocked and becomes safe dry-run.
  {
    const sandbox = {
      sessions: new Map([[7, { tabId: 7 }]]),
      downloadJobs: new Map([[7, { tabId: 7, captureId: "cap-old", status: "moving" }]]),
      loadLocalActionStore: async () => ({}),
      sessionLocalActionResolution: () => ({ config: { download: { enabled: true } } }),
      Number
    };
    vm.createContext(sandbox);
    vm.runInContext(`${extractFunction(background, "async function armDownloadCapture")}\nthis.arm = armDownloadCapture;`, sandbox);
    const result = await sandbox.arm(7, {});
    assert.equal(result.armed, false);
    assert.equal(result.blocked, true);
    assert.equal(result.status, "moving");

    const targetSandbox = {};
    vm.createContext(targetSandbox);
    vm.runInContext(`${extractFunction(target, "function effectiveDryRunForCapture")}\nthis.effective = effectiveDryRunForCapture;`, targetSandbox);
    assert.equal(targetSandbox.effective(false, { armed: false, blocked: true, status: "moving" }), true);
    assert.equal(targetSandbox.effective(false, { armed: true }), false);
  }

  // Once a response is positively identified as a download, CK becomes DL immediately.
  {
    const capture = { tabId: 7, captureId: "cap", claimed: false, intercepting: false };
    const sandbox = {
      activeDownloadCapture: () => capture,
      responseLooksDownload: () => true,
      clearDownloadCaptureExpiryTimer() {},
      downloadCaptures: new Map([[7, capture]]),
      downloadJobs: new Map([[7, { tabId: 7, status: "armed" }]]),
      emptyDownloadState: (tabId) => ({ tabId, status: "idle" }),
      persistDownloadState: async () => {},
      broadcast: async () => {},
      contentDispositionFilename: () => "file.zip",
      startManagedDownload: async () => {},
      Number,
      String
    };
    vm.createContext(sandbox);
    vm.runInContext(`${extractFunction(background, "function interceptDownloadResponse")}\nthis.intercept = interceptDownloadResponse;`, sandbox);
    const result = sandbox.intercept({ tabId: 7, method: "GET", url: "https://example.test/file.zip", responseHeaders: [] });
    assert.equal(result.cancel, true);
    assert.equal(sandbox.downloadJobs.get(7).status, "downloading");
  }

  console.log("PASS: Phase 70 v0.41.11 hardens RD title safety and download/move correlation without starting a new feature group");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
