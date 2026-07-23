#!/usr/bin/env node
"use strict";
const fs = require("fs");
const vm = require("vm");
const assert = require("assert");
const path = require("path");
const root = path.resolve(__dirname, "..");
const sandbox = { globalThis: null };
sandbox.globalThis = sandbox;
vm.runInNewContext(fs.readFileSync(path.join(root, "extension/shared/recovery.js"), "utf8"), sandbox);
const R = sandbox.FCI_RECOVERY;
assert.strictEqual(R.VERSION, 1);
assert.strictEqual(R.decision({ supportedUrl: true, urlAllowed: true, hostPermission: true }), "attached");
assert.strictEqual(R.decision({ supportedUrl: true, urlAllowed: true, hostPermission: false }), "permission-required");
assert.strictEqual(R.decision({ supportedUrl: true, urlAllowed: false, hostPermission: true }), "url-blocked");
const runtime = R.prepareRuntime({ cycle: 7, clickedCount: 3, alertActive: true, pipelineBusy: true, pendingMonitorState: "matched", recoveryAttempts: 2 }, "active", "test", "2026-07-23T00:00:00Z");
assert.strictEqual(runtime.cycle, 7);
assert.strictEqual(runtime.clickedCount, 3);
assert.strictEqual(runtime.alertActive, false);
assert.strictEqual(runtime.pipelineBusy, false);
assert.strictEqual(runtime.pendingMonitorState, null);
assert.strictEqual(runtime.baselineCount, 0);
assert.strictEqual(runtime.recoveryAttempts, 3);
const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
for (const marker of ["reattachSession", "Recovery.STATE.NAVIGATION_PENDING", "Recovery.STATE.PERMISSION_REQUIRED", "void recoverAll()", "session-recovered"]) {
  assert(background.includes(marker), `missing background marker ${marker}`);
}
const activation = fs.readFileSync(path.join(root, "extension/content/activation.js"), "utf8");
assert(/const RUNTIME_VERSION = (1[1-9]|[2-9][0-9]);/.test(activation));
const sidebar = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
assert(sidebar.includes("Recover current tab"));
console.log("PASS: Phase 14 restart-safe multi-tab session recovery");
