#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const manifest = JSON.parse(read("extension/manifest.json"));
const html = read("extension/sidebar/sidebar.html");
const css = read("extension/sidebar/sidebar.css");
const sidebar = read("extension/sidebar/sidebar.js");
const alertSource = read("extension/content/alert.js");

const background = read("extension/background/background.js");
assert(background.includes("const downloadCaptureExpiryTimers = new Map()"));
assert(background.includes("function scheduleDownloadCaptureExpiry(capture)"));
assert(background.includes("scheduleDownloadCaptureExpiry(capture);"));
assert(background.includes("scheduleDownloadCaptureExpiry(restoredCapture);"));
assert(background.includes("clearDownloadCaptureExpiryTimer(capture.tabId);"));
assert(background.includes("clearDownloadCaptureExpiryTimer(tabId);"));
assert(background.includes("Date.now() >= capture.expiresAtMs"));

assert.ok(manifest.version.localeCompare("0.41.7", undefined, { numeric: true }) >= 0);
assert(html.includes('id="downloadStatusIcon"'));
assert(html.includes('role="status"'));
assert(html.includes('aria-atomic="true"'));
assert(css.includes('.download-status-icon[data-state="error"]'));

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert(start >= 0, `Missing ${signature}`);
  const next = source.indexOf("\n  function ", start + signature.length);
  return source.slice(start, next >= 0 ? next : source.length);
}

const headerSandbox = { globalThis: null };
headerSandbox.globalThis = headerSandbox;
vm.createContext(headerSandbox);
vm.runInContext(`${extractFunction(sidebar, "function downloadHeaderNotice")}\nthis.notice = downloadHeaderNotice;`, headerSandbox);

assert.equal(headerSandbox.notice({ status: "armed" }).icon, "⇩");
assert.equal(headerSandbox.notice({ status: "armed" }).state, "running");
assert.match(headerSandbox.notice({ status: "armed" }).label, /armed/i);
assert.equal(headerSandbox.notice({ status: "downloading" }).icon, "⇩");
assert.equal(headerSandbox.notice({ status: "moving" }).icon, "⇩");
assert.equal(headerSandbox.notice({ status: "completed" }).icon, "✓");
assert.equal(headerSandbox.notice({ status: "error", error: "Move failed" }).icon, "!");
assert.equal(headerSandbox.notice({ status: "error", error: "Move failed" }).state, "error");
assert.equal(headerSandbox.notice({ status: "error", error: "Move failed" }).label, "Move failed");
assert.equal(headerSandbox.notice({ status: "expired" }).icon, "!");
assert.equal(headerSandbox.notice({ status: "expired" }).state, "error");
assert.equal(headerSandbox.notice({ status: "idle" }).visible, false);

// Phase 65 changed alert behavior but left engine VERSION=12. A rebound content
// runtime that already had v12 could therefore skip the compact-RD engine.
// Phase 66 must supersede that live module without requiring a page reload.
assert.match(alertSource, /FCI_ALERT_ENGINE\?\.VERSION >= 13/);
assert.match(alertSource, /VERSION:\s*13/);
const settingsSandbox = { console, crypto: webcrypto, URL, globalThis: null };
settingsSandbox.globalThis = settingsSandbox;
vm.createContext(settingsSandbox);
vm.runInContext(read("extension/shared/protocol.js"), settingsSandbox);
vm.runInContext(read("extension/shared/settings.js"), settingsSandbox);
Object.defineProperty(settingsSandbox, "FCI_ALERT_ENGINE", {
  configurable: true,
  enumerable: false,
  writable: false,
  value: Object.freeze({ VERSION: 12, compactReadyPrefix: (value) => value })
});
vm.runInContext(alertSource, settingsSandbox, { filename: "alert.js" });
assert.equal(settingsSandbox.FCI_ALERT_ENGINE.VERSION, 13);
assert.equal(settingsSandbox.FCI_ALERT_ENGINE.compactReadyPrefix("⚠ AI READY"), "⚠ RD");
assert.equal(settingsSandbox.FCI_ALERT_ENGINE.compactReadyPrefix("AI READY"), "RD");

console.log("PASS: Phase 66 v0.41.7 hardens the existing compact-ready/download-status feature without starting a new feature group");
