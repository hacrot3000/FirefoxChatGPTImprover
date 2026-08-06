#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
assert.equal(manifest.version, "0.34.0");
const expected = [
  "_execute_sidebar_action",
  "fci-toggle-current-tab",
  "fci-acknowledge-current-alert",
  "fci-run-current-target-action",
  "fci-open-current-command-log",
  "fci-stop-current-tab"
];
assert.deepEqual(Object.keys(manifest.commands), expected);
for (const name of expected.slice(0, 4)) assert(manifest.commands[name].suggested_key?.default, `${name} needs a default shortcut`);
for (const name of expected.slice(4)) assert(!manifest.commands[name].suggested_key, `${name} must remain unassigned by default`);
const context = vm.createContext({ console }); context.globalThis = context;
vm.runInContext(fs.readFileSync(path.join(root, "extension/shared/protocol.js"), "utf8"), context);
assert.equal(context.FCI_PROTOCOL.VERSION, 23);
assert.equal(context.FCI_PROTOCOL.MESSAGE.ACK_SHORTCUT_ACTION, "FCI_ACK_SHORTCUT_ACTION");
assert.equal(context.FCI_PROTOCOL.MESSAGE.CONTENT_ACKNOWLEDGE_ALERT, "FCI_CONTENT_ACKNOWLEDGE_ALERT");
const background = fs.readFileSync(path.join(root, "extension/background/background.js"), "utf8");
for (const pattern of [
  /browser\.commands\.onCommand\.addListener/,
  /browser\.commands\.getAll\(\)/,
  /browser\.sidebarAction\.open\(\)/,
  /pendingShortcutAction/,
  /ACK_SHORTCUT_ACTION/,
  /testTargetAction\(tabId, sessionConfig\(session, store\), true\)/,
  /fci-open-current-command-log/,
  /fci-stop-current-tab/
]) assert.match(background, pattern);
const activation = fs.readFileSync(path.join(root, "extension/content/activation.js"), "utf8");
assert.match(activation, /CONTENT_ACKNOWLEDGE_ALERT/);
assert.match(activation, /alertController\.acknowledge\("keyboard-shortcut"\)/);
const html = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.html"), "utf8");
for (const id of ["shortcutOpenSidebar", "shortcutToggleCurrentTab", "shortcutAcknowledgeAlert", "shortcutRunTargetAction", "shortcutOpenCommandLog", "shortcutStopCurrentTab", "manageShortcutsButton", "resetShortcutsButton"]) assert(html.includes(`id="${id}"`), id);
const sidebar = fs.readFileSync(path.join(root, "extension/sidebar/sidebar.js"), "utf8");
assert.match(sidebar, /browser\.commands\.openShortcutSettings\(\)/);
assert.match(sidebar, /browser\.commands\.reset\(item\.name\)/);
assert.match(sidebar, /Not assigned/);
assert.match(sidebar, /consumePendingShortcutAction/);
console.log("PASS: Phase 34 keyboard shortcuts, conflict visibility, Firefox settings and tab-bound actions");
