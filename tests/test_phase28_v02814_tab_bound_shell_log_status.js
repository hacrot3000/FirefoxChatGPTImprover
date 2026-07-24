#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const context = vm.createContext({
  console,
  crypto: webcrypto,
  URL,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval
});
context.globalThis = context;
for (const relative of [
  "extension/shared/protocol.js",
  "extension/shared/settings.js",
  "extension/content/alert.js"
]) {
  vm.runInContext(fs.readFileSync(path.join(root, relative), "utf8"), context, { filename: relative });
}

const Protocol = context.FCI_PROTOCOL;
const Alert = context.FCI_ALERT_ENGINE;
assert(Protocol.VERSION >= 17);
assert.equal(Protocol.MESSAGE.ACKNOWLEDGE_SHELL_LOG, "FCI_ACKNOWLEDGE_SHELL_LOG");
assert.equal(Protocol.MESSAGE.CONTENT_SHELL_NOTICE, "FCI_CONTENT_SHELL_NOTICE");
assert(Alert.VERSION >= 7);
assert.equal(Alert.commandTitlePrefix({ shellCommandState: "running" }), "⌘ COMMAND RUNNING");
assert.equal(Alert.commandTitlePrefix({ shellCommandState: "unread" }), "✓ COMMAND LOG");
assert.equal(Alert.commandTitlePrefix({ shellCommandState: "idle" }), "");
assert.equal(
  Alert.combinedTitlePrefix("⚠ AI READY", { shellCommandState: "running" }, true),
  "⚠ AI READY · ⌘ COMMAND RUNNING"
);
assert.equal(
  Alert.stripManagedTitleDecorations("[✓ COMMAND LOG] Project", ["⚠ AI READY"]),
  "Project"
);

const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
const sidebar = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
const html = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
const css = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.css"), "utf8");
const activation = fs.readFileSync(path.join(root, "extension/content/activation.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));

assert.equal(manifest.version, "0.28.14");
assert(background.includes("function normalizeShellNotice(raw, tabId)"));
assert(background.includes('status: completed ? "unread" : "running"'));
assert(background.includes("await acknowledgeShellNotice(session"));
assert(background.includes('await applyBadge(session.tabId, "CMD"'));
assert(background.includes('await applyBadge(session.tabId, "LOG"'));
assert(background.includes('reason: "native-disconnected"'));
assert(sidebar.includes("let shellLogLoadEpoch = 0"));
assert(sidebar.includes("requestEpoch !== shellLogLoadEpoch"));
assert(sidebar.includes("syncOpenShellLogToSelectedTab()"));
assert(sidebar.includes('RuntimeGuard?.report("shell-log", error, { fatal: false })'));
assert(sidebar.includes("MESSAGE.ACKNOWLEDGE_SHELL_LOG"));
assert(sidebar.includes('status === "running" ? "⌘ "'));
assert(html.includes('id="commandNoticeText"'));
assert(css.includes('body[data-command="running"]'));
assert(css.includes('body[data-command="unread"]'));
assert(activation.includes("const RUNTIME_VERSION = 21"));
assert(activation.includes("case MESSAGE.CONTENT_SHELL_NOTICE"));
assert(activation.includes('"stop-shell-notice"'));

console.log("PASS: Phase 28 v0.28.14 tab-bound log viewer and persistent per-tab command notices");
