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

assert.ok(manifest.version.localeCompare("0.41.6", undefined, { numeric: true }) >= 0);
assert(html.includes('id="downloadStatusIcon"'));
assert(html.includes('placeholder="RD"'));
assert(!html.includes('placeholder="⚠ AI READY"'));
assert(css.includes('.download-status-icon[data-state="completed"]'));
assert(css.includes('.download-status-icon[data-state="downloading"]'));
assert(sidebar.includes('runtime.monitorState === "matched"'));
assert(sidebar.includes('? "RD"'));

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert(start >= 0, `Missing ${signature}`);
  const next = source.indexOf("\n  function ", start + signature.length);
  return source.slice(start, next >= 0 ? next : source.length);
}
const sandbox = { globalThis: null };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(`${extractFunction(sidebar, "function downloadHeaderNotice")}\nthis.notice = downloadHeaderNotice;`, sandbox);
assert.deepEqual(JSON.parse(JSON.stringify(sandbox.notice({ status: "idle" }))), { visible: false, icon: "", state: "idle", label: "No active managed download notification." });
assert.equal(sandbox.notice({ status: "downloading" }).visible, true);
assert.notEqual(sandbox.notice({ status: "downloading" }).state, "idle");
assert.equal(sandbox.notice({ status: "moving" }).visible, true);
assert.notEqual(sandbox.notice({ status: "moving" }).state, "idle");
assert.equal(sandbox.notice({ status: "completed", destinationPath: "/tmp/a.zip" }).icon, "✓");
assert.equal(sandbox.notice({ status: "completed" }).state, "completed");
assert.equal(sandbox.notice({ status: "error" }).visible, true);
assert.equal(sandbox.notice({ status: "error" }).state, "error");

const settingsSandbox = { console, crypto: webcrypto, URL, globalThis: null };
settingsSandbox.globalThis = settingsSandbox;
vm.createContext(settingsSandbox);
vm.runInContext(read("extension/shared/protocol.js"), settingsSandbox);
vm.runInContext(read("extension/shared/settings.js"), settingsSandbox);
vm.runInContext(read("extension/content/alert.js"), settingsSandbox);
assert.equal(settingsSandbox.FCI_SETTINGS.defaultConfig().alerts.titlePrefix, "RD");
assert.equal(settingsSandbox.FCI_ALERT_ENGINE.compactReadyPrefix("⚠ AI READY"), "RD");
assert.equal(settingsSandbox.FCI_ALERT_ENGINE.compactReadyPrefix("AI READY"), "RD");
assert.equal(settingsSandbox.FCI_ALERT_ENGINE.compactReadyPrefix("CUSTOM"), "CUSTOM");
assert.equal(settingsSandbox.FCI_ALERT_ENGINE.alertTitle("⚠ AI READY", "Project"), "[RD] Project");


const collectGuide = read("tools/_patch_lib/docs/CODE_COLLECTION_GUIDE.md");
const standardPrompt = read("tools/_patch_lib/docs/PYTHON_PATCH_STANDARD_PROMPT.md");
assert(collectGuide.includes("Python Patch Tool v6.7.9"));
assert(collectGuide.includes("CODE_COLLECTION_REQUEST_<purpose>_<timestamp>.zip"));
assert(!collectGuide.includes("./tools/run_python_patches.sh collect "));
assert(standardPrompt.includes("v6.7.9"));
assert(standardPrompt.includes("zero-argument"));

console.log("PASS: Phase 65 v0.41.6 compact RD, managed-download header indicators and v6.7.9 public Patch Tool contract");
