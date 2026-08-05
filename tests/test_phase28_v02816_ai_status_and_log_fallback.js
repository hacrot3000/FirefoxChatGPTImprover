#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const background = read("extension/background/background.js");
const sidebar = read("extension/sidebar/sidebar.js");
const activation = read("extension/content/activation.js");
const manifest = JSON.parse(read("extension/manifest.json"));

assert.ok(manifest.version.localeCompare("0.28.16", undefined, { numeric: true }) >= 0);
assert.match(activation, /const RUNTIME_VERSION = (?:2[3-9]|[3-9][0-9])/);
assert.match(background, /SHELL_HISTORY_INLINE_CHAR_LIMIT = 65536/);
assert.match(background, /inlineOutput: shellRunInlineText\(run\)/);
assert.match(background, /status: activeTabMatches \? "idle" : "viewed"/);
assert.match(background, /clearViewedShellNoticeForActiveTab/);
assert.match(background, /if \(session\.mode === MODE\.ACTIVE\) \{\s*await applyBadge\(session\.tabId, "ON"/s);
assert.match(sidebar, /function shellHistoryFallbackText\(entry\)/);
assert.match(sidebar, /Stored complete log unavailable; showing the persisted per-run fallback/);
assert.doesNotMatch(sidebar, /reportShellLogFailure\(error\);\s*\}\s*if \(displayed/s);

const protocol = { MODE: { ACTIVE: "active", INACTIVE: "inactive" }, MONITOR_STATE: { WAITING: "waiting", MATCHED: "matched" } };
const document = {
  title: "Project",
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
const sandbox = {
  globalThis: null,
  document,
  MutationObserver: class { observe() {} disconnect() {} },
  setTimeout, clearTimeout, setInterval, clearInterval,
  FCI_PROTOCOL: protocol,
  FCI_SETTINGS: {
    normalizeConfig(value) { return value; },
    defaultConfig() { return { alerts: { titleBlink: false, badge: true, sidebar: true, notification: false, titlePrefix: "AI READY", activeTabTimeoutSeconds: 0, blinkIntervalMs: 500, dismissOnUserActivity: false } }; }
  }
};
sandbox.globalThis = sandbox;
vm.runInNewContext(read("extension/content/alert.js"), sandbox, { filename: "alert.js" });
const Alert = sandbox.FCI_ALERT_ENGINE;
const clock = {
  now: () => Date.now(),
  setTimeout, clearTimeout,
  setInterval(callback) { clock.callback = callback; return 1; },
  clearInterval() {}
};
const controller = Alert.createAlertController({ clock });
controller.apply({ alerts: { titleBlink: false, badge: true, sidebar: true, notification: false, titlePrefix: "AI READY", activeTabTimeoutSeconds: 0, blinkIntervalMs: 500, dismissOnUserActivity: false } }, { monitorState: "waiting", shellCommandState: "unread" }, "active", "test");
assert.match(document.title, /^⠋ \[✓\] Project$/, "AI monitor spinner must coexist with, and not be replaced by, the unread command icon");

console.log("PASS: Phase 28 v0.28.16 independent AI status and restart-safe shell-log fallback");
