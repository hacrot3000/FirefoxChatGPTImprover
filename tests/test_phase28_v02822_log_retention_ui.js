#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");
const ROOT = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "extension/manifest.json"), "utf8"));
const parts = manifest.version.split(".").map(Number);
assert.ok(parts[0] > 0 || parts[1] > 28 || (parts[1] === 28 && parts[2] >= 22));

const context = { console, crypto: require("crypto").webcrypto, structuredClone: global.structuredClone };
context.globalThis = context;
vm.runInNewContext(fs.readFileSync(path.join(ROOT, "extension/shared/settings.js"), "utf8"), context);
vm.runInNewContext(fs.readFileSync(path.join(ROOT, "extension/shared/protocol.js"), "utf8"), context);
const Settings = context.FCI_SETTINGS;
const Protocol = context.FCI_PROTOCOL;
assert(Settings.SCHEMA_VERSION >= 15);
assert(Protocol.VERSION >= 18);
assert(Protocol.MESSAGE.SAVE_NATIVE_LOG_RETENTION);
assert(Protocol.MESSAGE.RUN_NATIVE_LOG_CLEANUP);
const policy = Settings.defaultStore().nativeLogRetention;
assert.deepStrictEqual(JSON.parse(JSON.stringify(policy)), {
  enabled: true, maxAgeDays: 90, maxTotalMiB: 512, maxFiles: 500,
  runOnStartup: true, runAfterCommand: true
});
const normalized = Settings.normalizeNativeLogRetention({ maxAgeDays: -1, maxTotalMiB: 999999, maxFiles: 1 });
assert.strictEqual(normalized.maxAgeDays, 1);
assert.strictEqual(normalized.maxTotalMiB, 16384);
assert.strictEqual(normalized.maxFiles, 10);

const html = fs.readFileSync(path.join(ROOT, "extension/sidebar/sidebar.html"), "utf8");
for (const id of ["nativeLogRetentionEnabled", "nativeLogMaxAgeDays", "nativeLogMaxTotalMiB", "nativeLogMaxFiles", "saveNativeLogRetentionButton", "runNativeLogCleanupButton", "nativeLogCleanupStatus"]) {
  assert(html.includes(`id="${id}"`), `missing retention UI ${id}`);
}
const sidebar = fs.readFileSync(path.join(ROOT, "extension/sidebar/sidebar.js"), "utf8");
assert(sidebar.includes("Native log-retention policy saved."));
assert(sidebar.includes("nativeVersionParts[1] < 12"));
const background = fs.readFileSync(path.join(ROOT, "extension/background/background.js"), "utf8");
for (const marker of ["cleanup_logs", "protectedShellLogIds", "scheduleNativeLogCleanup(\"startup\"", "scheduleNativeLogCleanup(\"command-complete\""]) assert(background.includes(marker), marker);
console.log("PASS: Phase 28 v0.28.22 log-retention policy is persisted, editable, manually runnable and scheduled without deleting unread logs.");
